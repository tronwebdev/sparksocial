import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type {
  Lead,
  LeadStore,
  Proposal,
  ProposalStore,
} from '@sparksocial/tools/defineTool';
import type {
  LeadSource,
  LeadStatus,
  ProposalLineItem,
  ProposalStatus,
} from '@sparksocial/shared/agencyPipeline';
import type { Database } from './client.js';
import { leads, proposals } from './schema.js';

/**
 * `leads` and `proposals` backed by Postgres — the agency's own sales pipeline.
 *
 * Not routed through `scoped.ts`, and that is a decision rather than an
 * omission: `scoped.ts` exists to require a `genomeId` on everything carrying a
 * client's material, and a lead has no genome because a lead is not a client.
 * There is nothing here to isolate *between* clients. What there is to isolate
 * is one agency's pipeline from another's, so every query below filters on
 * `orgId`, with exactly one deliberate exception documented at
 * `getByShareToken`.
 */

/* ── leads ─────────────────────────────────────────────────────────── */

export function createLeadRepository(db: Database): LeadStore {
  return {
    async create({ orgId, source, dedupeKey, createdBy, ...fields }) {
      const [row] = await db
        .insert(leads)
        .values({ orgId, source, dedupeKey, createdBy, ...fields })
        .returning();
      return toLead(row!);
    },

    async importMany({ orgId, source, createdBy, rows }) {
      if (rows.length === 0) return { inserted: [], skippedKeys: [] };

      /**
       * One statement, and the conflict target is the dedupe index.
       *
       * `DO NOTHING` rather than `DO UPDATE` because an import must never
       * overwrite a lead somebody has since worked — the sheet is a snapshot of
       * what the agency knew when they exported it, and the row in here may
       * already carry a call outcome and a status. Re-importing is therefore
       * safe to do repeatedly, which is the property that lets the tool be
       * retried.
       */
      const inserted = await db
        .insert(leads)
        .values(rows.map((r) => ({ orgId, source, createdBy, ...r })))
        .onConflictDoNothing({ target: [leads.orgId, leads.dedupeKey] })
        .returning();

      /**
       * Postgres returns only the rows it actually wrote, so what was skipped is
       * the difference. Derived rather than queried: a second read would race
       * another importer running at the same time and could report a key as
       * skipped that this call had in fact inserted.
       */
      const landed = new Set(inserted.map((r) => r.dedupeKey));
      const skippedKeys = [...new Set(rows.map((r) => r.dedupeKey))].filter((k) => !landed.has(k));

      return { inserted: inserted.map(toLead), skippedKeys };
    },

    async get({ orgId, id }) {
      const [row] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.orgId, orgId), eq(leads.id, id)))
        .limit(1);
      return row ? toLead(row) : undefined;
    },

    async getByDedupeKey({ orgId, dedupeKey }) {
      const [row] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.orgId, orgId), eq(leads.dedupeKey, dedupeKey)))
        .limit(1);
      return row ? toLead(row) : undefined;
    },

    async list({ orgId, status, source, search, limit, offset }) {
      const filters = [eq(leads.orgId, orgId)];
      if (status?.length) filters.push(inArray(leads.status, status));
      if (source?.length) filters.push(inArray(leads.source, source));

      if (search?.trim()) {
        /**
         * `ilike` over the three columns somebody actually types into a search
         * box. The wildcards are added here and the term is a bound parameter,
         * so a `%` inside the user's text is matched literally rather than
         * widening their own search.
         */
        const term = `%${search.trim()}%`;
        filters.push(
          or(
            ilike(leads.businessName, term),
            ilike(leads.contactName, term),
            ilike(leads.email, term),
          )!,
        );
      }

      const where = and(...filters);

      /**
       * The page and its total in parallel. The total is what the table's "N
       * Results" and its pager need, and it has to be the count *under the same
       * filters* — counting the org's whole pipeline would tell the reader a
       * number that does not match the rows in front of them.
       */
      const [rows, [counted]] = await Promise.all([
        db
          .select()
          .from(leads)
          .where(where)
          .orderBy(desc(leads.createdAt), asc(leads.id))
          .limit(limit)
          .offset(offset),
        db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where),
      ]);

      return { rows: rows.map(toLead), total: counted?.n ?? 0 };
    },

    async countsByStatus(orgId) {
      const rows = await db
        .select({ status: leads.status, n: sql<number>`count(*)::int` })
        .from(leads)
        .where(eq(leads.orgId, orgId))
        .groupBy(leads.status);

      /**
       * Every status present, including the zeroes. A header that renders
       * `counts.qualified` must not have to distinguish "none" from "absent",
       * and `GROUP BY` returns no row for a status nobody is in.
       */
      const out: Record<LeadStatus, number> = { new: 0, contacted: 0, qualified: 0, won: 0, lost: 0 };
      for (const r of rows) {
        if (r.status in out) out[r.status as LeadStatus] = r.n;
      }
      return out;
    },

    async update({ orgId, id, patch }) {
      const [row] = await db
        .update(leads)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(leads.orgId, orgId), eq(leads.id, id)))
        .returning();
      /**
       * Undefined means no row matched *within this org*, which the tool turns
       * into NOT_FOUND. Returning it rather than throwing here keeps the
       * repository free of tool-level error vocabulary.
       */
      return row ? toLead(row) : (undefined as unknown as Lead);
    },
  };
}

function toLead(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    orgId: row.orgId,
    businessName: row.businessName,
    contactName: row.contactName ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    location: row.location ?? undefined,
    website: row.website ?? undefined,
    interest: row.interest ?? undefined,
    notes: row.notes ?? undefined,
    rating: row.rating ?? undefined,
    source: row.source as LeadSource,
    status: row.status as LeadStatus,
    dedupeKey: row.dedupeKey,
    convertedBrandId: row.convertedBrandId ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ── proposals ─────────────────────────────────────────────────────── */

/** 256 bits, hex — the same credential discipline as `review_links.token`. */
export const mintShareToken = (): string => randomBytes(32).toString('hex');

export function createProposalRepository(db: Database): ProposalStore {
  return {
    async create(args) {
      const [row] = await db.insert(proposals).values(args).returning();
      return toProposal(row!);
    },

    async get({ orgId, id }) {
      const [row] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.orgId, orgId), eq(proposals.id, id)))
        .limit(1);
      return row ? toProposal(row) : undefined;
    },

    async list({ orgId, leadId, status, limit, offset }) {
      const filters = [eq(proposals.orgId, orgId)];
      if (leadId) filters.push(eq(proposals.leadId, leadId));
      if (status?.length) filters.push(inArray(proposals.status, status));
      const where = and(...filters);

      const [rows, [counted]] = await Promise.all([
        db
          .select()
          .from(proposals)
          .where(where)
          .orderBy(desc(proposals.createdAt), asc(proposals.id))
          .limit(limit)
          .offset(offset),
        db.select({ n: sql<number>`count(*)::int` }).from(proposals).where(where),
      ]);

      return { rows: rows.map(toProposal), total: counted?.n ?? 0 };
    },

    async update({ orgId, id, patch }) {
      const [row] = await db
        .update(proposals)
        .set({
          ...patch,
          /** `null` clears a revocation; `undefined` leaves it alone. */
          shareRevokedAt: patch.shareRevokedAt === null ? null : patch.shareRevokedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(proposals.orgId, orgId), eq(proposals.id, id)))
        .returning();
      return row ? toProposal(row) : (undefined as unknown as Proposal);
    },

    async getByShareToken(token) {
      /**
       * THE ONE READ WITH NO `orgId` PREDICATE.
       *
       * A prospect opening a shared proposal has no session and no org — the
       * token is the entire credential, which is why it is 256 random bits and
       * why the expiry and revocation are checked here rather than by whatever
       * route serves the page. Same posture, and the same reasoning, as
       * `ReviewLinkStore.getByToken`.
       */
      const [row] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.shareToken, token),
            isNull(proposals.shareRevokedAt),
            gt(proposals.shareExpiresAt, new Date()),
          ),
        )
        .limit(1);
      return row ? toProposal(row) : undefined;
    },
  };
}

function toProposal(row: typeof proposals.$inferSelect): Proposal {
  return {
    id: row.id,
    orgId: row.orgId,
    leadId: row.leadId,
    title: row.title,
    currency: row.currency,
    status: row.status as ProposalStatus,
    termMonths: row.termMonths,
    lineItems: row.lineItems as ProposalLineItem[],
    monthlyCents: row.monthlyCents,
    oneOffCents: row.oneOffCents,
    totalContractCents: row.totalContractCents,
    notes: row.notes ?? undefined,
    shareToken: row.shareToken ?? undefined,
    shareExpiresAt: row.shareExpiresAt ?? undefined,
    shareRevokedAt: row.shareRevokedAt ?? undefined,
    sentAt: row.sentAt ?? undefined,
    decidedAt: row.decidedAt ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
