import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ToolError } from '@sparksocial/shared';

/**
 * `genome.consent.*` — likeness consent for cloning (§10): *"store explicit
 * consent record with timestamp and scope."*
 *
 * `guardrails/src/rights.ts` has refused a likeness-cloning format without
 * `avatarEnabled` since P2 — these tools are what makes that flag correspond
 * to a real fact instead of an onboarding self-report. `gather.ts` reads
 * `ctx.db.consent.hasActive(genomeId, orgId, 'avatar_clone')` for every
 * `rights` evaluation; nothing else in the engine touches this table.
 *
 * ── `human_only`, on both writes ────────────────────────────────────────
 *
 * Consent is an attestation by a person that a real person consented to
 * being cloned. SPARK proposing "I'll go ahead and grant consent" on nobody's
 * behalf is exactly the failure §10 exists to block — the same reasoning
 * `human.answer` uses for why an agent may not answer its own question.
 * `grant`/`revoke` require `ctx.userId`, same as `human.answer`.
 */

const ConsentRecordOutput = z.object({
  id: z.string(),
  genomeId: z.string(),
  kind: z.string(),
  subject: z.string(),
  evidenceUrl: z.string().optional(),
  grantedBy: z.string(),
  grantedAt: z.string(),
  revokedBy: z.string().optional(),
  revokedAt: z.string().optional(),
});

function toOutput(r: {
  id: string;
  genomeId: string;
  kind: string;
  subject: string;
  evidenceUrl?: string;
  grantedBy: string;
  grantedAt: Date;
  revokedBy?: string;
  revokedAt?: Date;
}): z.infer<typeof ConsentRecordOutput> {
  return {
    id: r.id,
    genomeId: r.genomeId,
    kind: r.kind,
    subject: r.subject,
    grantedBy: r.grantedBy,
    grantedAt: r.grantedAt.toISOString(),
    ...(r.evidenceUrl ? { evidenceUrl: r.evidenceUrl } : {}),
    ...(r.revokedBy ? { revokedBy: r.revokedBy } : {}),
    ...(r.revokedAt ? { revokedAt: r.revokedAt.toISOString() } : {}),
  };
}

function requireGenome(genomeId: string | undefined): string {
  if (!genomeId) throw new ToolError('INVALID_INPUT', 'A genome must be selected.');
  return genomeId;
}

function requireUser(userId: string | undefined): string {
  if (!userId) throw new ToolError('FORBIDDEN', 'Granting or revoking consent must be attributable to a person.');
  return userId;
}

/* ── genome.consent.grant ────────────────────────────────────────────── */

export const consentGrant = defineTool({
  name: 'genome.consent.grant',
  version: 1,

  summary:
    'Record that a named person has consented to their likeness or voice being cloned for this brand. ' +
    'Required before any avatar/voice-cloning format can pass the rights guardrail.',

  input: z.object({
    kind: z.string().min(1).max(40), // 'avatar_clone' | 'voice_clone' — free text, invariant 5
    subject: z.string().min(1).max(120),
    evidenceUrl: z.string().url().optional(),
  }),
  output: ConsentRecordOutput,

  // `write`, not `external`: this stays inside the workspace and reaches
  // nobody outside it — only the ledger changes.
  effect: 'write',
  // A legal attestation on someone's behalf is not a decision SPARK gets to
  // make well or badly; it is one only a person on the account can make.
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  idempotent: false,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const genomeId = requireGenome(ctx.genomeId);
    const grantedBy = requireUser(ctx.userId);

    const record = await ctx.db.consent.grant({
      genomeId,
      orgId: ctx.orgId,
      kind: input.kind,
      subject: input.subject,
      grantedBy,
      ...(input.evidenceUrl ? { evidenceUrl: input.evidenceUrl } : {}),
    });

    ctx.trace.event('genome.consent.grant', { genomeId, kind: input.kind, subject: input.subject });
    ctx.logger.info('consent granted', { genomeId, kind: input.kind, consentId: record.id });

    return toOutput(record);
  },
});

/* ── genome.consent.revoke ───────────────────────────────────────────── */

export const consentRevoke = defineTool({
  name: 'genome.consent.revoke',
  version: 1,

  summary: 'Revoke a previously granted consent record. Any format requiring it stops clearing the rights guardrail immediately.',

  input: z.object({ consentId: z.string().min(1) }),
  output: ConsentRecordOutput,

  effect: 'write',
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  // True: revoking the same record twice is the same fact, not a new one —
  // unlike `grant`, where two calls are two distinct attestations.
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const revokedBy = requireUser(ctx.userId);

    const record = await ctx.db.consent.revoke({
      id: input.consentId,
      orgId: ctx.orgId,
      revokedBy,
    });

    if (!record) {
      // One error for "no such record" and "already revoked" — an id is not
      // something to let a caller fish for the difference on.
      throw new ToolError('NOT_FOUND', 'That consent record is not active.', { consentId: input.consentId });
    }

    ctx.trace.event('genome.consent.revoke', { consentId: record.id, kind: record.kind });
    ctx.logger.info('consent revoked', { consentId: record.id, revokedBy });

    return toOutput(record);
  },
});

/* ── genome.consent.list ─────────────────────────────────────────────── */

export const consentList = defineTool({
  name: 'genome.consent.list',
  version: 1,

  summary: 'List every consent record on file for this genome, newest first — what the rights guardrail checks against.',

  input: z.object({}),
  output: z.object({ records: z.array(ConsentRecordOutput) }),

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(_input, ctx) {
    const genomeId = requireGenome(ctx.genomeId);
    const records = await ctx.db.consent.list(genomeId, ctx.orgId);
    return { records: records.map(toOutput) };
  },
});
