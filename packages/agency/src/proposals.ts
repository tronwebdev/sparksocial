import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import {
  Currency,
  PROPOSAL_SERVICE_LABELS,
  ProposalLineItem,
  ProposalStatus,
  canTransitionProposal,
  proposalTotals,
} from '@sparksocial/shared/agencyPipeline';

/**
 * `proposal.*` — the priced offer an agency sends a lead.
 *
 * ── What this does, and the one thing it refuses to do ────────────────────
 *
 * It assembles, prices, versions and delivers a proposal. It does **not**
 * invent the prices. Every line's amount is a required input, because a number
 * this tool made up would be the single most expensive fiction in the product:
 * a proposal is a contractual offer, and an agency that sent one carrying a
 * model's guess at their own rate card would be bound by it.
 *
 * What it adds over a form is therefore not the numbers but everything around
 * them: the term arithmetic nobody gets right by hand, a document frozen at the
 * moment it was sent, a status lifecycle that cannot go backwards, an
 * unauthenticated share link with a real expiry, and an `Explanation` that says
 * what the total is made of.
 *
 * ── Why the totals are stored and not computed on read ────────────────────
 *
 * `proposalTotals` runs once, at write. A proposal is a record of what was
 * offered; recomputing it later means a change to the arithmetic — or to a line
 * item's shape — silently restates a contract somebody already accepted. Same
 * reasoning keeps `line_items` a `jsonb` document rather than rows joined to a
 * live service catalogue.
 *
 * ── Delivery, honestly ───────────────────────────────────────────────────
 *
 * There is no email transport in this product. `proposal.send` would therefore
 * be a lie, so it does not exist. `proposal.share` mints an expiring
 * unauthenticated link — the same credential discipline as
 * `whitelabel.link.create` — which the agency pastes into whatever they already
 * send mail with, and `proposal.decide` records the answer. That is the whole
 * of what can be delivered today, and it is genuinely useful.
 */

/* ── shared shapes ─────────────────────────────────────────────────── */

/**
 * Twelve lines.
 *
 * Not a storage limit — it is the point past which a proposal stops being an
 * offer and becomes an invoice, and the `jsonb` document stops being reviewable
 * by the person signing it.
 */
const MAX_LINES = 12;

/**
 * One to sixty months.
 *
 * A zero-month term would make `totalContractCents` equal the one-offs and
 * quietly erase every recurring line from the contract value, which is the
 * arithmetic mistake this whole module exists to prevent.
 */
const TermMonths = z.number().int().min(1).max(60);

const LineItems = z
  .array(ProposalLineItem)
  .min(1)
  .max(MAX_LINES)
  .superRefine((items, ctx) => {
    items.forEach((li, i) => {
      /**
       * `other` with no description is a line that says nothing. The enum
       * carries the meaning for every other service; for this one the
       * description *is* the meaning, so it is required rather than optional.
       */
      if (li.service === 'other' && !li.description?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'description'],
          message: 'A line with service "other" needs a description saying what it is.',
        });
      }
    });
  });

const ProposalOut = z.object({
  id: z.string(),
  leadId: z.string(),
  title: z.string(),
  currency: z.string(),
  status: ProposalStatus,
  termMonths: z.number().int(),
  lineItems: z.array(ProposalLineItem),
  monthlyCents: z.number().int(),
  oneOffCents: z.number().int(),
  totalContractCents: z.number().int(),
  notes: z.string().optional(),
  /** Present only while a live share link exists. Never the token itself. */
  shareExpiresAt: z.string().optional(),
  sentAt: z.string().optional(),
  decidedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

interface StoredProposal {
  id: string;
  leadId: string;
  title: string;
  currency: string;
  status: z.infer<typeof ProposalStatus>;
  termMonths: number;
  lineItems: z.infer<typeof ProposalLineItem>[];
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
  shareToken?: string;
  shareExpiresAt?: Date;
  shareRevokedAt?: Date;
  sentAt?: Date;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const serialise = (p: StoredProposal): z.infer<typeof ProposalOut> => ({
  id: p.id,
  leadId: p.leadId,
  title: p.title,
  currency: p.currency,
  status: p.status,
  termMonths: p.termMonths,
  lineItems: p.lineItems,
  monthlyCents: p.monthlyCents,
  oneOffCents: p.oneOffCents,
  totalContractCents: p.totalContractCents,
  notes: p.notes,
  /**
   * The token is deliberately absent from every output but `proposal.share`'s
   * own. A list read that carried live credentials for forty proposals would
   * put them in every log and every client-side cache that touched the list.
   */
  shareExpiresAt: p.shareRevokedAt ? undefined : p.shareExpiresAt?.toISOString(),
  sentAt: p.sentAt?.toISOString(),
  decidedAt: p.decidedAt?.toISOString(),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Money, for an `Explanation` a human reads. Minor units → major, no locale games. */
const money = (cents: number, currency: string): string =>
  `${currency} ${(cents / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── proposal.draft ────────────────────────────────────────────────── */

export const ProposalDraftInput = z.object({
  leadId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  currency: Currency.default('USD'),
  termMonths: TermMonths,
  lineItems: LineItems,
  notes: z.string().trim().max(4000).optional(),
});

export const ProposalDraftOutput = z.object({ proposal: ProposalOut, why: Explanation });

export const proposalDraft = defineTool({
  name: 'proposal.draft',
  version: 1,

  summary:
    'Assemble a priced proposal for a lead from service lines you supply, and work out what the contract ' +
    'is worth over its term. Prices are never invented. Free.',

  input: ProposalDraftInput,
  output: ProposalDraftOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-PROP-01'],

  async handler(input, ctx) {
    const lead = await ctx.db.leads.get({ orgId: ctx.orgId, id: input.leadId });
    if (!lead) throw new ToolError('NOT_FOUND', 'No such lead in this workspace.', { leadId: input.leadId });

    /**
     * A lost lead can be re-proposed to — that is frequently the point of
     * reopening one. A *won* lead cannot: they are a client, and what they pay
     * is a billing question rather than a sales one.
     */
    if (lead.status === 'won') {
      throw new ToolError(
        'INVALID_INPUT',
        `${lead.businessName} is already a client. Change what a client pays in their workspace, not in a proposal.`,
        { reason: 'lead_is_client', leadId: lead.id, brandId: lead.convertedBrandId },
      );
    }

    const totals = proposalTotals(input.lineItems, input.termMonths);

    const proposal = await ctx.db.proposals.create({
      orgId: ctx.orgId,
      leadId: input.leadId,
      title: input.title,
      currency: input.currency,
      termMonths: input.termMonths,
      lineItems: input.lineItems,
      ...totals,
      notes: input.notes,
      createdBy: ctx.userId ?? 'spark',
    });

    ctx.logger.info('proposal.drafted', { proposalId: proposal.id, leadId: lead.id });

    const recurring = input.lineItems.filter((l) => l.recurrence === 'monthly');
    const oneOffs = input.lineItems.filter((l) => l.recurrence === 'one_off');

    return {
      proposal: serialise(proposal),
      why: {
        summary:
          `${money(totals.totalContractCents, input.currency)} over ${input.termMonths} months — ` +
          `${money(totals.monthlyCents, input.currency)} a month` +
          (totals.oneOffCents > 0 ? ` plus ${money(totals.oneOffCents, input.currency)} once.` : '.'),
        factors: [
          {
            label: 'recurring lines',
            detail:
              recurring.length === 0
                ? 'None — this is a one-off engagement.'
                : recurring.map((l) => PROPOSAL_SERVICE_LABELS[l.service]).join(', '),
          },
          {
            label: 'one-off lines',
            detail: oneOffs.length === 0 ? 'None.' : oneOffs.map((l) => PROPOSAL_SERVICE_LABELS[l.service]).join(', '),
          },
          {
            /**
             * Spelled out because it is the number people get wrong, and because
             * a reader checking a total against their own arithmetic needs to
             * know the rule that produced it.
             */
            label: 'contract value',
            detail: `monthly × ${input.termMonths} + one-offs. One-off lines are not multiplied by the term.`,
          },
          {
            label: 'prices are yours',
            detail: 'Every amount came from the request. Nothing here estimates or suggests a rate.',
          },
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Suggest prices from what similar agencies charge',
            rejectedBecause:
              'A proposal is a contractual offer. An invented rate would bind the agency to a number it ' +
              'never chose.',
          },
        ],
      },
    };
  },
});

/* ── proposal.list ─────────────────────────────────────────────────── */

export const ProposalListInput = z.object({
  leadId: z.string().min(1).optional(),
  status: z.array(ProposalStatus).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const ProposalListOutput = z.object({
  proposals: z.array(ProposalOut),
  total: z.number().int(),
  /**
   * What is out and undecided, and what has been won — the two numbers an
   * agency actually asks a proposal list for. Summed over every proposal
   * matching the filters, not just the page.
   */
  pipeline: z.object({
    outstandingCents: z.number().int(),
    acceptedCents: z.number().int(),
    currency: z.string().optional(),
  }),
});

export const proposalList = defineTool({
  name: 'proposal.list',
  version: 1,

  summary:
    'Proposals for a lead or across the agency, with what is still out and what has been accepted. ' +
    'Read-only, free.',

  input: ProposalListInput,
  output: ProposalListOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-PROP-02'],

  async handler(input, ctx) {
    const page = await ctx.db.proposals.list({
      orgId: ctx.orgId,
      leadId: input.leadId,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });

    /**
     * Totalled over the page, and the output says so by carrying a currency
     * only when there is exactly one.
     *
     * Two proposals in different currencies cannot be added, and an agency
     * quoting in both is ordinary. Rather than silently summing NGN into USD,
     * the currency is omitted when they disagree — a caller can then show the
     * rows without a meaningless headline figure.
     */
    const currencies = new Set(page.rows.map((p) => p.currency));
    const single = currencies.size === 1 ? [...currencies][0] : undefined;

    let outstandingCents = 0;
    let acceptedCents = 0;
    if (single) {
      for (const p of page.rows) {
        if (p.status === 'sent') outstandingCents += p.totalContractCents;
        if (p.status === 'accepted') acceptedCents += p.totalContractCents;
      }
    }

    return {
      proposals: page.rows.map(serialise),
      total: page.total,
      pipeline: { outstandingCents, acceptedCents, currency: single },
    };
  },
});

/* ── proposal.update ──────────────────────────────────────────────── */

export const ProposalUpdateInput = z
  .object({
    proposalId: z.string().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    currency: Currency.optional(),
    termMonths: TermMonths.optional(),
    lineItems: LineItems.optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((v) => Object.keys(v).length > 1, {
    message: 'Nothing to update — pass at least one field besides proposalId.',
  });

export const ProposalUpdateOutput = z.object({ proposal: ProposalOut });

export const proposalUpdate = defineTool({
  name: 'proposal.update',
  version: 1,

  summary:
    'Revise a proposal that has not been sent — its lines, term, currency or title. Totals are ' +
    'recalculated. Refuses once the proposal has left the building. Free.',

  input: ProposalUpdateInput,
  output: ProposalUpdateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-PROP-01'],

  async handler(input, ctx) {
    const current = await ctx.db.proposals.get({ orgId: ctx.orgId, id: input.proposalId });
    if (!current) throw new ToolError('NOT_FOUND', 'No such proposal in this workspace.', { proposalId: input.proposalId });

    /**
     * Only a draft is editable, and this is the rule that makes the whole
     * module trustworthy: once a client has seen a price, changing that record
     * in place would leave the agency unable to say what it actually offered.
     * A revised offer is a new proposal, and `proposal.list` shows both.
     */
    if (current.status !== 'draft') {
      throw new ToolError(
        'INVALID_INPUT',
        `This proposal is ${current.status} and cannot be edited. Draft a new one to change the offer.`,
        { reason: 'not_editable', status: current.status },
      );
    }

    const { proposalId, ...patch } = input;

    /**
     * Recompute whenever either input to the arithmetic moved. Both are read
     * from the incoming patch or the stored row, so changing only the term
     * still reprices the whole contract.
     */
    const lineItems = patch.lineItems ?? current.lineItems;
    const termMonths = patch.termMonths ?? current.termMonths;
    const totals = proposalTotals(lineItems, termMonths);

    const proposal = await ctx.db.proposals.update({
      orgId: ctx.orgId,
      id: proposalId,
      patch: { ...patch, ...totals },
    });

    return { proposal: serialise(proposal) };
  },
});

/* ── proposal.share ───────────────────────────────────────────────── */

/**
 * Fourteen days, capped at ninety — the same window
 * `whitelabel.link.create` uses, for the same reason: an unauthenticated URL
 * that grants sight of a priced offer should stop working on its own, because
 * the link outlives the deal and ends up in a forwarded email thread.
 */
const ShareDays = z.number().int().min(1).max(90).default(14);

export const ProposalShareInput = z.object({
  proposalId: z.string().min(1),
  expiresInDays: ShareDays,
  /**
   * Marks the proposal sent as well as minting the link. On by default because
   * sharing *is* sending in this flow, and a proposal the client can read while
   * the pipeline still calls it a draft is how "what is outstanding" goes wrong.
   */
  markSent: z.boolean().default(true),
});

export const ProposalShareOutput = z.object({
  /** The credential. Returned exactly once, by this tool, and never stored in an output again. */
  token: z.string(),
  expiresAt: z.string(),
  proposal: ProposalOut,
});

export const proposalShare = defineTool({
  name: 'proposal.share',
  version: 1,

  summary:
    'Mint an expiring link that lets a prospect read a proposal without an account, and mark it sent. ' +
    'Paste the link into your own email. Free.',

  input: ProposalShareInput,
  output: ProposalShareOutput,

  effect: 'write',
  autonomy: 'auto',
  /**
   * The narrower pair. A share link is an unauthenticated credential to a
   * priced offer leaving the workspace — the one act in this family with a
   * blast radius outside it.
   */
  scopes: ['owner', 'admin'],
  /**
   * `false`. Each call mints a *new* credential and invalidates nothing, so a
   * retried request without a key would scatter several live tokens for one
   * proposal, each independently forwardable.
   */
  idempotent: false,
  surfaces: ['AG-PROP-03'],

  async handler(input, ctx) {
    const current = await ctx.db.proposals.get({ orgId: ctx.orgId, id: input.proposalId });
    if (!current) throw new ToolError('NOT_FOUND', 'No such proposal in this workspace.', { proposalId: input.proposalId });

    if (current.status === 'accepted' || current.status === 'declined' || current.status === 'withdrawn') {
      throw new ToolError('INVALID_INPUT', `This proposal is ${current.status}. Draft a new one to make a new offer.`, {
        reason: 'already_decided',
        status: current.status,
      });
    }

    /**
     * Minted here rather than in the repository so the token never has to be a
     * return value of a read. `randomBytes` via the store's own helper keeps
     * the 256-bit discipline in one place.
     */
    const token = mintToken();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);

    const proposal = await ctx.db.proposals.update({
      orgId: ctx.orgId,
      id: input.proposalId,
      patch: {
        shareToken: token,
        shareExpiresAt: expiresAt,
        /** A fresh link un-revokes: the agency is deliberately re-sharing. */
        shareRevokedAt: null,
        ...(input.markSent && current.status === 'draft'
          ? { status: 'sent' as const, sentAt: new Date() }
          : {}),
      },
    });

    ctx.logger.info('proposal.shared', { proposalId: proposal.id, expiresAt: expiresAt.toISOString() });

    return { token, expiresAt: expiresAt.toISOString(), proposal: serialise(proposal) };
  },
});

/**
 * 256 bits, hex.
 *
 * `randomBytes` rather than `Math.random`, and 32 bytes rather than a uuid,
 * because this string is the entire credential for an unauthenticated reader —
 * the same reasoning, and the same size, as `review_links.token`. A uuid would
 * be 122 bits of which several are structural, and it *looks* like an id, which
 * invites somebody to log it.
 */
const mintToken = (): string => randomBytes(32).toString('hex');

/* ── proposal.decide ─────────────────────────────────────────────── */

export const ProposalDecideInput = z.object({
  proposalId: z.string().min(1),
  outcome: z.enum(['accepted', 'declined', 'withdrawn']),
  notes: z.string().trim().max(4000).optional(),
});

export const ProposalDecideOutput = z.object({ proposal: ProposalOut, why: Explanation });

export const proposalDecide = defineTool({
  name: 'proposal.decide',
  version: 1,

  summary:
    'Record the answer to a proposal — accepted, declined, or withdrawn by the agency. Terminal, and it ' +
    'revokes any share link. Free.',

  input: ProposalDecideInput,
  output: ProposalDecideOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-PROP-02'],

  async handler(input, ctx) {
    const current = await ctx.db.proposals.get({ orgId: ctx.orgId, id: input.proposalId });
    if (!current) throw new ToolError('NOT_FOUND', 'No such proposal in this workspace.', { proposalId: input.proposalId });

    /** Recording the same outcome twice is the success case. */
    if (current.status === input.outcome) {
      return {
        proposal: serialise(current),
        why: {
          summary: `Already ${input.outcome}. Nothing changed.`,
          factors: [{ label: 'idempotent', detail: 'Repeating a decision is not a conflict.' }],
          evidence: [],
          alternatives: [],
        },
      };
    }

    if (!canTransitionProposal(current.status, input.outcome)) {
      throw new ToolError(
        'INVALID_INPUT',
        current.status === 'draft'
          ? 'This proposal has not been sent, so there is no answer to record. Share it first.'
          : `A ${current.status} proposal cannot become ${input.outcome}.`,
        { reason: 'bad_transition', from: current.status, to: input.outcome },
      );
    }

    const proposal = await ctx.db.proposals.update({
      orgId: ctx.orgId,
      id: input.proposalId,
      patch: {
        status: input.outcome,
        decidedAt: new Date(),
        notes: input.notes ?? current.notes,
        /**
         * A decided proposal's link stops working.
         *
         * The offer is settled, and a live URL to it is a priced document
         * circulating with nothing left to authorise. Revoking is cheap here and
         * impossible to remember later.
         */
        shareRevokedAt: new Date(),
      },
    });

    ctx.logger.info('proposal.decided', { proposalId: proposal.id, outcome: input.outcome });

    const won = input.outcome === 'accepted';

    return {
      proposal: serialise(proposal),
      why: {
        summary: won
          ? `Accepted — ${money(proposal.totalContractCents, proposal.currency)} over ${proposal.termMonths} months.`
          : `Recorded as ${input.outcome}. The share link no longer works.`,
        factors: [
          { label: 'was', detail: current.status },
          { label: 'share link', detail: 'Revoked, because the offer is settled.' },
          ...(won
            ? [
                {
                  label: 'next',
                  detail:
                    'Create the client workspace with brand.create, then lead.convert to link the lead to it.',
                },
              ]
            : []),
        ],
        evidence: [],
        alternatives: won
          ? [
              {
                option: 'Convert the lead automatically',
                rejectedBecause:
                  'Creating a client workspace is a separate, billable act with its own scopes. Accepting a ' +
                  'price should not silently provision one.',
              },
            ]
          : [],
      },
    };
  },
});
