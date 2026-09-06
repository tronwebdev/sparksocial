import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import {
  LeadSource,
  LeadStatus,
  canTransitionLead,
  leadDedupeKey,
} from '@sparksocial/shared/agencyPipeline';

/**
 * `lead.*` — LEAD CAPTURE for the Agency Portal's Client Finder.
 *
 * ── What capture is, and the thing this deliberately is not ───────────────
 *
 * These five tools bring in a list the agency **already has**: a CRM export, a
 * name taken on a call, a referral, a form submission. That is what "lead
 * capture" means, and it is the whole of what is built here.
 *
 * It is not prospecting. Nothing in this file harvests businesses out of a maps
 * listing, a directory, or anybody's followers. That is a different capability
 * with a different risk profile — platform terms of service, and personal data
 * collected with no lawful basis under GDPR/CCPA — and it is not something to
 * ship as a side effect of building a pipeline. The Agency Portal's "Find
 * Clients" button therefore stays unavailable and says why, rather than being
 * quietly wired to a scraper.
 *
 * ── Why `lead.import` takes rows and not a CSV ────────────────────────────
 *
 * The tool's job is the import: validate, dedupe, insert, and explain what
 * happened. Parsing text is a different job, it already happens client-side to
 * render the preview the design shows before anyone commits, and `packages/
 * agency` cannot reach `packages/recipes`' parser without taking a dependency on
 * the automation package for a comma splitter. So the boundary is typed rows,
 * which also means Zod rejects a malformed sheet field by field instead of the
 * handler discovering it halfway through a 2,000-row insert.
 *
 * ── Untrusted input ──────────────────────────────────────────────────────
 *
 * Every text field on a lead came from outside the workspace. A business name
 * is a place a prompt injection arrives, exactly as a crawled page is. Nothing
 * in this file puts a lead into a model prompt, so nothing here needs
 * `untrusted()` — but anything that later does must wrap it first, and the
 * table comment in `schema.ts` says so at the point of storage.
 *
 * ── Scopes ───────────────────────────────────────────────────────────────
 *
 * `owner`, `admin` and `editor`. Wider than `agency.roster`'s two because
 * selling is not administration: the person working a pipeline is frequently
 * not the person who administers the workspace, and forcing an admin role on a
 * salesperson would hand them every brand's settings to get them a lead form.
 * `lead.convert` is the exception and takes the narrower pair — see its header.
 */

/* ── shared field vocabulary ───────────────────────────────────────── */

/**
 * `.trim().min(1)` rather than `.min(1)`: a CSV cell holding a single space is
 * the common shape of "missing" in an exported sheet, and it must fail the same
 * way an empty one does rather than creating a lead named " ".
 */
const BusinessName = z.string().trim().min(1).max(200);

const LeadFields = z.object({
  businessName: BusinessName,
  contactName: z.string().trim().max(200).optional(),
  /**
   * Lowercased on the way in, because it is half of the dedupe key and a sheet
   * that spells the same address two ways must not become two leads.
   */
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  /** Free text: international formats vary too much to validate without rejecting real numbers. */
  phone: z.string().trim().max(50).optional(),
  location: z.string().trim().max(200).optional(),
  website: z.string().trim().url().max(500).optional(),
  interest: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(4000).optional(),
  /** The agency's own 0–5 score. Never inferred — see the column comment. */
  rating: z.number().min(0).max(5).optional(),
});

const LeadOut = z.object({
  id: z.string(),
  businessName: z.string(),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  interest: z.string().optional(),
  notes: z.string().optional(),
  rating: z.number().optional(),
  source: LeadSource,
  status: LeadStatus,
  convertedBrandId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type LeadRow = z.infer<typeof LeadOut>;

const serialise = (l: {
  id: string;
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  interest?: string;
  notes?: string;
  rating?: number;
  source: z.infer<typeof LeadSource>;
  status: z.infer<typeof LeadStatus>;
  convertedBrandId?: string;
  createdAt: Date;
  updatedAt: Date;
}): LeadRow => ({
  id: l.id,
  businessName: l.businessName,
  contactName: l.contactName,
  email: l.email,
  phone: l.phone,
  location: l.location,
  website: l.website,
  interest: l.interest,
  notes: l.notes,
  rating: l.rating,
  source: l.source,
  status: l.status,
  convertedBrandId: l.convertedBrandId,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

/* ── lead.create ───────────────────────────────────────────────────── */

export const LeadCreateInput = LeadFields.extend({
  source: LeadSource.default('manual'),
});

export const LeadCreateOutput = z.object({ lead: LeadOut });

export const leadCreate = defineTool({
  name: 'lead.create',
  version: 1,

  summary:
    'Add one prospective client to the agency pipeline — a name taken on a call, a referral, a form ' +
    'submission. Refuses a business already in the pipeline. Free.',

  input: LeadCreateInput,
  output: LeadCreateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /**
   * Idempotent on the dedupe key rather than on a caller-supplied token: the
   * unique index makes a repeated create a conflict, which this turns into a
   * pointer at the existing row. A retried call therefore cannot produce a
   * second lead, which is the property the flag is claiming.
   */
  idempotent: true,
  surfaces: ['AG-CF-01'],

  async handler(input, ctx) {
    const dedupeKey = leadDedupeKey(input);

    /**
     * Checked before inserting so the error can name the existing lead. The
     * unique index is still the guarantee — this read only buys a better
     * message, and a race between the two ends at the index, not here.
     */
    const existing = await ctx.db.leads.getByDedupeKey({ orgId: ctx.orgId, dedupeKey });
    if (existing) {
      throw new ToolError('INVALID_INPUT', `${existing.businessName} is already in the pipeline.`, {
        reason: 'duplicate',
        leadId: existing.id,
        status: existing.status,
      });
    }

    const lead = await ctx.db.leads.create({
      orgId: ctx.orgId,
      source: input.source,
      dedupeKey,
      createdBy: ctx.userId ?? 'spark',
      businessName: input.businessName,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      location: input.location,
      website: input.website,
      interest: input.interest,
      notes: input.notes,
      rating: input.rating,
    });

    ctx.logger.info('lead.created', { leadId: lead.id, source: lead.source });
    return { lead: serialise(lead) };
  },
});

/* ── lead.import ───────────────────────────────────────────────────── */

/**
 * 2,000 rows a call.
 *
 * Chosen because it is one `INSERT` Postgres is comfortable with and one HTTP
 * body that does not need streaming, and because a sheet larger than this is a
 * migration rather than an import — it should be paged by the caller so a
 * failure costs one page instead of the whole file.
 */
const IMPORT_LIMIT = 2000;

export const LeadImportInput = z.object({
  rows: z.array(LeadFields).min(1).max(IMPORT_LIMIT),
  source: LeadSource.default('import'),
});

export const LeadImportOutput = z.object({
  imported: z.number().int(),
  /** Rows that matched a lead already in the pipeline. */
  duplicatesSkipped: z.number().int(),
  /** Rows that collided with another row **inside this same upload**. */
  duplicatesWithinUpload: z.number().int(),
  leads: z.array(LeadOut),
  why: Explanation,
});

export const leadImport = defineTool({
  name: 'lead.import',
  version: 1,

  summary:
    'Bulk-add prospective clients the agency already has — a CRM export or a spreadsheet, already parsed ' +
    'into rows. Skips businesses already in the pipeline and reports what it skipped. Safe to re-run. Free.',

  input: LeadImportInput,
  output: LeadImportOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  /**
   * `false`, so a caller must supply an idempotency key.
   *
   * The dedupe index already makes a re-run harmless in the database. The key is
   * for the *answer*: without it a retried upload returns "0 imported, 400
   * duplicates", which is indistinguishable from having uploaded the wrong file
   * and is how somebody concludes the import failed and does it a third time.
   */
  idempotent: false,
  surfaces: ['AG-CF-02'],

  async handler(input, ctx) {
    /**
     * Collapse duplicates inside the upload first.
     *
     * A single sheet listing the same business twice is ordinary. Sending both
     * to `ON CONFLICT DO NOTHING` would silently drop the second and report it
     * as an existing-pipeline duplicate, which is a different and more alarming
     * fact than "your file repeats itself". First occurrence wins because it is
     * the one the reader saw at the top of their preview.
     */
    const seen = new Map<string, z.infer<typeof LeadFields>>();
    let duplicatesWithinUpload = 0;
    for (const row of input.rows) {
      const key = leadDedupeKey(row);
      if (seen.has(key)) {
        duplicatesWithinUpload += 1;
        continue;
      }
      seen.set(key, row);
    }

    const rows = [...seen.entries()].map(([dedupeKey, r]) => ({ ...r, dedupeKey }));

    const { inserted, skippedKeys } = await ctx.db.leads.importMany({
      orgId: ctx.orgId,
      source: input.source,
      createdBy: ctx.userId ?? 'spark',
      rows,
    });

    ctx.logger.info('lead.imported', {
      offered: input.rows.length,
      inserted: inserted.length,
      skipped: skippedKeys.length,
    });

    const parts = [`${inserted.length} of ${input.rows.length} rows added.`];
    if (skippedKeys.length > 0) parts.push(`${skippedKeys.length} were already in the pipeline.`);
    if (duplicatesWithinUpload > 0) parts.push(`${duplicatesWithinUpload} repeated within the file.`);

    return {
      imported: inserted.length,
      duplicatesSkipped: skippedKeys.length,
      duplicatesWithinUpload,
      leads: inserted.map(serialise),
      why: {
        summary: parts.join(' '),
        factors: [
          { label: 'rows offered', detail: String(input.rows.length) },
          { label: 'added', detail: String(inserted.length) },
          {
            label: 'matched on',
            detail:
              'Email if present, otherwise phone, otherwise business name paired with location. ' +
              'A row with none of those beyond a name matches any other row for the same name.',
          },
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Update the existing lead from the sheet',
            rejectedBecause:
              'The sheet is a snapshot of what was known at export. Overwriting would discard a call ' +
              'outcome or a status somebody set here since.',
          },
        ],
      },
    };
  },
});

/* ── lead.list ─────────────────────────────────────────────────────── */

export const LeadListInput = z.object({
  status: z.array(LeadStatus).optional(),
  source: z.array(LeadSource).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const LeadListOutput = z.object({
  leads: z.array(LeadOut),
  /** Under the same filters as the page, so the pager and the rows agree. */
  total: z.number().int(),
  /** Whole-pipeline counts per stage, for the header. Unaffected by filters. */
  counts: z.object({
    new: z.number().int(),
    contacted: z.number().int(),
    qualified: z.number().int(),
    won: z.number().int(),
    lost: z.number().int(),
  }),
});

export const leadList = defineTool({
  name: 'lead.list',
  version: 1,

  summary:
    'The agency pipeline: prospective clients with their stage, filterable by stage, source and a search ' +
    'term, plus per-stage totals. Read-only, free.',

  input: LeadListInput,
  output: LeadListOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-CF-01'],

  async handler(input, ctx) {
    const [page, counts] = await Promise.all([
      ctx.db.leads.list({
        orgId: ctx.orgId,
        status: input.status,
        source: input.source,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      }),
      ctx.db.leads.countsByStatus(ctx.orgId),
    ]);

    return { leads: page.rows.map(serialise), total: page.total, counts };
  },
});

/* ── lead.update ───────────────────────────────────────────────────── */

export const LeadUpdateInput = z
  .object({
    leadId: z.string().min(1),
    status: LeadStatus.optional(),
  })
  .merge(LeadFields.partial())
  .refine((v) => Object.keys(v).length > 1, {
    message: 'Nothing to update — pass at least one field besides leadId.',
  });

export const LeadUpdateOutput = z.object({ lead: LeadOut });

export const leadUpdate = defineTool({
  name: 'lead.update',
  version: 1,

  summary:
    'Move a lead along the pipeline or correct its details. Stages run new → contacted → qualified → ' +
    'won or lost; a lost lead can be reopened. Free.',

  input: LeadUpdateInput,
  output: LeadUpdateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: true,
  surfaces: ['AG-CF-01'],

  async handler(input, ctx) {
    const current = await ctx.db.leads.get({ orgId: ctx.orgId, id: input.leadId });
    if (!current) throw new ToolError('NOT_FOUND', 'No such lead in this workspace.', { leadId: input.leadId });

    const { leadId, status, ...fields } = input;

    if (status && !canTransitionLead(current.status, status)) {
      /**
       * The refusal that matters is `won → anything`. A won lead has a brand;
       * un-winning it would leave a workspace whose client's own lead says they
       * were never sold. Reopening a former client is a new lead, which is
       * honest — they are a new sale.
       */
      throw new ToolError(
        'INVALID_INPUT',
        current.status === 'won'
          ? 'This lead was won and a client workspace was created for it. Add a new lead for a new sale.'
          : `A lead cannot go from ${current.status} to ${status}.`,
        { reason: 'bad_transition', from: current.status, to: status },
      );
    }

    /**
     * Recompute the dedupe key whenever an identifying field is touched, so a
     * lead whose email is corrected starts colliding with the right rows. Left
     * alone otherwise: rewriting it on a notes-only edit would churn the index
     * for nothing.
     */
    const identityTouched =
      'email' in fields || 'phone' in fields || 'businessName' in fields || 'location' in fields;

    const dedupeKey = identityTouched
      ? leadDedupeKey({
          email: fields.email ?? current.email,
          phone: fields.phone ?? current.phone,
          businessName: fields.businessName ?? current.businessName,
          location: fields.location ?? current.location,
        })
      : undefined;

    if (dedupeKey && dedupeKey !== current.dedupeKey) {
      const clash = await ctx.db.leads.getByDedupeKey({ orgId: ctx.orgId, dedupeKey });
      if (clash && clash.id !== current.id) {
        throw new ToolError('INVALID_INPUT', `Those details match ${clash.businessName}, already in the pipeline.`, {
          reason: 'duplicate',
          leadId: clash.id,
        });
      }
    }

    const lead = await ctx.db.leads.update({
      orgId: ctx.orgId,
      id: leadId,
      patch: { ...fields, status, dedupeKey },
    });

    return { lead: serialise(lead) };
  },
});

/* ── lead.convert ──────────────────────────────────────────────────── */

export const LeadConvertInput = z.object({
  leadId: z.string().min(1),
  /**
   * An existing brand, created by `brand.create` first.
   *
   * This tool does not create the brand itself. A tool that called another tool
   * would sit outside the registry's own audit trail for the inner call, and
   * `brand.create` has its own scopes, its own cost and its own `why`. So the
   * flow is two calls, and this one records the linkage — which is the fact the
   * pipeline is missing, not the brand.
   */
  brandId: z.string().min(1),
});

export const LeadConvertOutput = z.object({ lead: LeadOut, why: Explanation });

export const leadConvert = defineTool({
  name: 'lead.convert',
  version: 1,

  summary:
    'Mark a lead won and link it to the client workspace created for it. Call brand.create first and pass ' +
    'that brand. Terminal — a won lead cannot be moved again. Free.',

  input: LeadConvertInput,
  output: LeadConvertOutput,

  effect: 'write',
  autonomy: 'auto',
  /**
   * Narrower than the rest of the family. Winning a lead attaches it to a brand
   * — a billable client workspace — and that is the administrative act in this
   * file, not the selling.
   */
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['AG-CF-03'],

  async handler(input, ctx) {
    const current = await ctx.db.leads.get({ orgId: ctx.orgId, id: input.leadId });
    if (!current) throw new ToolError('NOT_FOUND', 'No such lead in this workspace.', { leadId: input.leadId });

    /** A repeat of the same conversion is the success case, not a conflict. */
    if (current.convertedBrandId === input.brandId && current.status === 'won') {
      return { lead: serialise(current), why: alreadyConverted(current.businessName) };
    }

    if (current.status === 'won') {
      throw new ToolError('INVALID_INPUT', `${current.businessName} was already converted to another workspace.`, {
        reason: 'already_converted',
        brandId: current.convertedBrandId,
      });
    }

    /**
     * The brand must exist and be in this org. Checked because the whole value
     * of the link is that it resolves — a lead pointing at a brand id somebody
     * mistyped is worse than a lead with no link, since the pipeline would
     * report a win nobody can open.
     */
    const brands = await ctx.db.genomes.listForOrg(ctx.orgId);
    const brand = brands.find((b) => b.brandId === input.brandId || b.id === input.brandId);
    if (!brand) {
      throw new ToolError('NOT_FOUND', 'No such client workspace in this organisation.', { brandId: input.brandId });
    }

    const lead = await ctx.db.leads.update({
      orgId: ctx.orgId,
      id: input.leadId,
      patch: { status: 'won', convertedBrandId: input.brandId },
    });

    ctx.logger.info('lead.converted', { leadId: lead.id, brandId: input.brandId });

    return {
      lead: serialise(lead),
      why: {
        summary: `${lead.businessName} is now a client, working in ${brand.name}.`,
        factors: [
          { label: 'was', detail: current.status },
          { label: 'workspace', detail: brand.name },
          {
            label: 'terminal',
            detail: 'A won lead cannot be moved again, because a client workspace now depends on it.',
          },
        ],
        evidence: [],
        alternatives: [
          {
            option: 'Create the workspace from inside this tool',
            rejectedBecause:
              'brand.create has its own scopes and its own audit entry. Nesting it would hide that call ' +
              'from the record of what happened.',
          },
        ],
      },
    };
  },
});

const alreadyConverted = (name: string): z.infer<typeof Explanation> => ({
  summary: `${name} was already converted to this workspace. Nothing changed.`,
  factors: [{ label: 'idempotent', detail: 'Repeating a conversion is the success case, not a conflict.' }],
  evidence: [],
  alternatives: [],
});
