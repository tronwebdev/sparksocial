import { z } from 'zod';

/**
 * THE AGENCY'S OWN SALES PIPELINE — leads and the proposals sent to them.
 *
 * ── Why this is a separate vocabulary from everything else ────────────────
 *
 * Every other record in this product belongs to a *brand*: a genome, its
 * assets, its content, its metrics. A lead is the one thing that does not,
 * because a lead is a business that is **not a client yet**. It has no genome,
 * no brand row, and nothing to isolate — which is exactly why `leads` and
 * `proposals` are org-scoped rather than genome-scoped, and why neither is in
 * `SCOPED_TABLE_NAMES`. There is no client material in them to leak between
 * clients.
 *
 * The bridge back to the rest of the product is `lead.convert`: a lead that
 * becomes a client gets a brand, and from that moment everything about them is
 * genome-scoped like any other client. The lead row keeps the `brandId` so the
 * pipeline can show where its wins went, and stops being the system of record.
 *
 * ── What "lead capture" means here, and what it does not ──────────────────
 *
 * Capture is bringing a list the agency **already has** into the product:
 * a CSV exported from their CRM, a name taken on a call, a referral. That is
 * `lead.import` and `lead.create`.
 *
 * It is *not* prospecting — no tool here harvests businesses out of a maps
 * listing or a directory. That is a different capability with a different risk
 * profile (platform terms, and personal data collected without a lawful basis
 * under GDPR/CCPA), and it is not something to add as a side effect of building
 * a pipeline. The Agency Portal's "Find Clients" button stays unavailable and
 * says so, rather than being quietly wired to a scraper.
 */

/* ── Leads ─────────────────────────────────────────────────────────── */

/**
 * Where a lead came from. Recorded because it changes what the row is worth and
 * what may be done with it: a `referral` was volunteered, an `import` came off
 * a list the agency vouches for, and `inbound` filled in a form themselves.
 */
export const LeadSource = z.enum(['manual', 'import', 'referral', 'inbound']);
export type LeadSource = z.infer<typeof LeadSource>;

/**
 * The pipeline, ordered. `won` is terminal-and-good, `lost` terminal-and-not;
 * everything before them is live.
 *
 * Deliberately five states and not a configurable funnel. A per-org pipeline
 * builder is a product in itself, and the moment stages are user-defined,
 * "which leads are live" stops being answerable by the database and starts
 * needing a join against a config table nobody keeps current.
 */
export const LeadStatus = z.enum(['new', 'contacted', 'qualified', 'won', 'lost']);
export type LeadStatus = z.infer<typeof LeadStatus>;

/** The states a lead can still be worked. */
export const LEAD_OPEN_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'qualified'];

/** Whether a status means the lead is still in play. */
export const isLeadOpen = (status: LeadStatus): boolean => LEAD_OPEN_STATUSES.includes(status);

/**
 * The transitions the pipeline permits.
 *
 * A lead may move forward, be lost from any live stage, and be reopened from
 * `lost` — that last one because "lost" is frequently a timing answer rather
 * than a final one, and re-entering the pipeline should not mean retyping the
 * record.
 *
 * `won` is the one state with no way out. It exists because a brand was created
 * for this lead, and un-winning it would leave a brand whose lead says it was
 * never a client. Reopening a former client is a new lead, which is honest:
 * they are a new sale.
 */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['contacted', 'qualified', 'won', 'lost'],
  contacted: ['qualified', 'won', 'lost'],
  qualified: ['contacted', 'won', 'lost'],
  won: [],
  lost: ['new', 'contacted', 'qualified'],
};

export const canTransitionLead = (from: LeadStatus, to: LeadStatus): boolean =>
  from === to || LEAD_TRANSITIONS[from].includes(to);

/**
 * The key two rows must share to be the same lead.
 *
 * Email first, then phone, then the business name paired with its location.
 * The fallback matters more than it looks: a CSV of local businesses often has
 * no email at all, and without the name+location pair every re-import would
 * double the list. Pairing with location rather than using the name alone is
 * what stops two genuinely different "Joe's Garage" rows from collapsing into
 * one.
 *
 * Normalisation is aggressive on purpose — case, surrounding space, and in
 * phone numbers every non-digit — because the whole value of a dedupe key is
 * that two humans typing the same business agree on it.
 */
export function leadDedupeKey(lead: {
  email?: string | null;
  phone?: string | null;
  businessName: string;
  location?: string | null;
}): string {
  const email = lead.email?.trim().toLowerCase();
  if (email) return `email:${email}`;

  const digits = lead.phone?.replace(/\D/g, '');
  /**
   * Seven digits is the shortest a real subscriber number gets. Below that it is
   * an extension or a typo, and keying on it would merge unrelated businesses —
   * worse than not deduping, because the loser is silently dropped.
   */
  if (digits && digits.length >= 7) return `phone:${digits}`;

  const name = lead.businessName.trim().toLowerCase().replace(/\s+/g, ' ');
  const where = lead.location?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  return `name:${name}|${where}`;
}

/* ── Proposals ─────────────────────────────────────────────────────── */

/**
 * The services an agency sells, matching the Agency Portal wizard's own
 * "Select services" list so a proposal and the website offer the same things.
 *
 * A closed enum rather than free text because the totals are grouped by it and
 * because two spellings of "content creation" make a pipeline report useless.
 * `other` carries its own description for the case the list does not cover.
 */
export const ProposalService = z.enum([
  'content_creation',
  'social_media_management',
  'paid_ads',
  'strategy_consulting',
  'community_management',
  'other',
]);
export type ProposalService = z.infer<typeof ProposalService>;

export const PROPOSAL_SERVICE_LABELS: Record<ProposalService, string> = {
  content_creation: 'Content creation',
  social_media_management: 'Social media management',
  paid_ads: 'Paid ads',
  strategy_consulting: 'Strategy & consulting',
  community_management: 'Community management',
  other: 'Other',
};

/**
 * Whether a line is billed every month for the term, or once.
 *
 * This is the only arithmetic in a proposal that anyone gets wrong, so it is a
 * field rather than a convention: a £2,000 setup fee and £2,000/month are the
 * same number and a twelve-fold difference in contract value.
 */
export const LineRecurrence = z.enum(['monthly', 'one_off']);
export type LineRecurrence = z.infer<typeof LineRecurrence>;

export const ProposalLineItem = z.object({
  service: ProposalService,
  /** Required for `other`, where the enum says nothing. Free text otherwise. */
  description: z.string().max(300).optional(),
  /**
   * Minor units (cents/pence), integer. Money is never a float here for the
   * usual reason, and the field is named for it so nobody passes 19.99.
   */
  unitCents: z.number().int().min(0).max(100_000_000),
  quantity: z.number().int().min(1).max(1000).default(1),
  recurrence: LineRecurrence,
});
export type ProposalLineItem = z.infer<typeof ProposalLineItem>;

/**
 * `draft` → `sent` → decided. `withdrawn` is the agency changing its mind
 * before an answer, which is a different fact from the client declining and is
 * worth telling apart when someone asks why a deal died.
 */
export const ProposalStatus = z.enum(['draft', 'sent', 'accepted', 'declined', 'withdrawn']);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  /** A draft can be revised, sent, or abandoned. */
  draft: ['sent', 'withdrawn'],
  sent: ['accepted', 'declined', 'withdrawn'],
  /** Decided proposals are history. A changed mind is a new proposal, and the
   *  old one stays as the record of what was actually offered and when. */
  accepted: [],
  declined: [],
  withdrawn: [],
};

export const canTransitionProposal = (from: ProposalStatus, to: ProposalStatus): boolean =>
  from === to || PROPOSAL_TRANSITIONS[from].includes(to);

/**
 * What a proposal is worth, split the way a contract actually bills.
 *
 * `totalContractCents` is the number both parties argue about, and it is the one
 * a naive sum gets wrong — it is the monthly total multiplied by the term, plus
 * the one-offs. Computed in one place so that the API, the screen and any future
 * report cannot disagree about it.
 */
export function proposalTotals(
  lineItems: readonly ProposalLineItem[],
  termMonths: number,
): { monthlyCents: number; oneOffCents: number; totalContractCents: number } {
  let monthlyCents = 0;
  let oneOffCents = 0;

  for (const li of lineItems) {
    const line = li.unitCents * li.quantity;
    if (li.recurrence === 'monthly') monthlyCents += line;
    else oneOffCents += line;
  }

  return { monthlyCents, oneOffCents, totalContractCents: monthlyCents * termMonths + oneOffCents };
}

/**
 * ISO-4217, uppercase, three letters.
 *
 * Not an enum of the currencies we happen to have thought of: an agency in Lagos
 * quoting NGN is not an edge case, and a closed list would silently reject them.
 * The format is checked because it is the part that breaks formatting downstream.
 */
export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO-4217 code, e.g. USD.');
