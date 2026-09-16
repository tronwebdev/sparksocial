import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import {
  Explanation,
  Objective,
  Platform,
  ToolError,
  genomeRequirement,
  type AssetRole,
} from '@sparksocial/shared';
import { resolve, type AssetInventory } from '@sparksocial/playbooks';
import { planCampaign } from './plan.js';

/**
 * `campaign.readiness` — what would stop this campaign working, asked *before*
 * it is made.
 *
 * ── The order this exists to reverse ──────────────────────────────────────
 *
 * Every fact here was already computable, and every one of them was only
 * surfaced afterwards. A brand created a campaign, the wizard called
 * `calendar.generate`, it placed zero slots and *succeeded*, and the calendar
 * said "Nothing scheduled yet." `EmptyCalendarReason` then explained why —
 * accurately, and one screen and one decision too late. The question "what do I
 * need before this will work" had no answer anywhere, so the only way to learn
 * it was to create a campaign and be disappointed by it.
 *
 * This is that panel, moved in front of the decision, and widened to the things
 * it never covered.
 *
 * ── Blockers and warnings are different, and the split is the point ───────
 *
 * A blocker means the campaign produces **nothing**: no format resolves, or
 * there is nowhere to publish. A warning means it produces *less* than it could.
 * Collapsing the two would make this a wall of yellow that people learn to click
 * past — which is what happens to a checklist that cannot distinguish "this will
 * not work" from "this could be better".
 *
 * Nothing here blocks creation. A brand may legitimately want the campaign now
 * and the assets on Friday, and refusing would be the product deciding something
 * that is not its to decide. It states the consequence and lets a person choose,
 * which is the same rule the rest of this codebase follows about honest
 * degradation.
 *
 * ── Why a tool and not a screen calling three tools ───────────────────────
 *
 * The arithmetic — how many formats resolve now, how many after an upload, how
 * many after filming — is `planCampaign`'s, and it is the same arithmetic
 * `campaign.propose_plan` and `calendar.generate` already run. A screen that
 * recomputed it from `asset.gaps` plus `genome.get` plus `integration.health`
 * would be a fourth opinion about the same question, free to disagree with the
 * three that decide what actually gets built. SPARK needs the same answer, and
 * CLAUDE.md invariant 1 is the rest of the reason.
 */

const Severity = z.enum(['blocker', 'warning']);

const ReadinessItem = z.object({
  /** Stable id, so a UI can key and test against it without matching prose. */
  id: z.string(),
  severity: Severity,
  /** What is missing, in the brand's language — never a schema path. */
  label: z.string(),
  /** What SPARK does with it, so the ask does not read as bureaucracy. */
  hint: z.string(),
  /** Where it gets fixed. A message naming a gap and not its screen is a dead end. */
  fixWith: z.string(),
  /**
   * How many more posts this window supports once this is closed.
   *
   * The whole reason a person acts on one of these rather than another, and the
   * number no screen was showing. Zero when it cannot be attributed to a count —
   * a missing connection blocks publishing, not planning.
   */
  unlocksPosts: z.number().int().min(0),
});

export const CampaignReadinessInput = z.object({
  genomeId: z.string().min(1),
  objective: Objective,
  windowDays: z.number().int().min(7).max(90).default(30),
});

export const CampaignReadinessOutput = z.object({
  ready: z.boolean(),
  /**
   * Progress, as a fraction of the formats this window could hold.
   *
   * `buildableNow / potentialWithCapture`, which is the gap `EmptyCalendarReason`
   * was written to explain: the plan is sized to what filming or an upload
   * *would* unlock, and the calendar can only hold what is buildable today.
   */
  buildableNow: z.number().int().min(0),
  potentialTotal: z.number().int().min(0),
  items: z.array(ReadinessItem),
  why: Explanation,
});

export interface CampaignReadinessDeps {
  /** Which platforms any configured adapter can actually reach. */
  supportedPlatforms: () => Platform[];
}

export function makeCampaignReadiness(deps: CampaignReadinessDeps) {
  return defineTool({
    name: 'campaign.readiness',
    version: 1,

    summary:
      'What would stop a campaign for this brand producing anything — missing answers, missing files, ' +
      'nothing to film with, nowhere to publish — with how many more posts each one unlocks. Read this ' +
      'before campaign.create, not after. Free.',

    input: CampaignReadinessInput,
    output: CampaignReadinessOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
    idempotent: true,
    surfaces: ['CMP-01'],

    async handler(input, ctx) {
      if (ctx.genomeId && input.genomeId !== ctx.genomeId) {
        throw new ToolError('ISOLATION_VIOLATION', 'That genome is not the one selected.', {
          claimed: input.genomeId,
          selected: ctx.genomeId,
        });
      }

      const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
      if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

      const inventory = (await ctx.db.assets.inventory(input.genomeId, ctx.orgId)) as AssetInventory;

      // The same call `campaign.propose_plan` and `calendar.generate` make, so
      // this cannot disagree with what they will actually build.
      const plan = planCampaign({
        genome,
        inventory,
        objective: input.objective,
        windowDays: input.windowDays,
      });

      // The library parameter defaults to PLAYBOOKS; the objective is the fourth.
      const { ranked } = resolve(genome, inventory, undefined, input.objective);
      const items: z.infer<typeof ReadinessItem>[] = [];

      /* ── 1. Facts the brand has not told us ──────────────────────────── */

      /*
       * First, deliberately. These are the cheapest to close — a sentence in a
       * settings field, not an afternoon with a camera — and `planCampaign`
       * already counts what they unlock. Listing an upload above a question that
       * takes ten seconds would be sorting the checklist by our convenience.
       */
      if (plan.answers) {
        for (const path of plan.answers.missingPaths) {
          const req = genomeRequirement(path);
          items.push({
            id: `answer:${path}`,
            severity: 'warning',
            label: req.label,
            hint: req.hint,
            fixWith: req.fixWith,
            unlocksPosts: plan.answers.unlocksPosts,
          });
        }
      }

      /* ── 2. Files, and things to film ────────────────────────────────── */

      /*
       * Grouped by role and counted by how many formats each blocks, rather than
       * listed per playbook. "Social proof — unlocks 4 posts" is a decision
       * somebody can make; the same fact spread across four format names is a
       * list to read.
       */
      const byRole = new Map<AssetRole, { upload: boolean; blocks: number }>();
      for (const r of ranked) {
        for (const role of r.missingRoles) {
          const cur = byRole.get(role) ?? { upload: r.unlockedBy !== 'capture', blocks: 0 };
          cur.blocks += 1;
          // `upload` wins if any format can be unlocked without filming: asking
          // for a camera when a file would do is the mistake worth not making.
          cur.upload = cur.upload || r.unlockedBy !== 'capture';
          byRole.set(role, cur);
        }
      }

      for (const [role, info] of [...byRole.entries()].sort((a, b) => b[1].blocks - a[1].blocks)) {
        const words = role.replace(/_/g, ' ');
        items.push({
          id: `asset:${role}`,
          severity: plan.buildableNow === 0 ? 'blocker' : 'warning',
          label: info.upload ? `a ${words} file` : `${words} — needs filming`,
          hint: info.upload
            ? `A file you probably already have. Unlocks ${info.blocks} format${info.blocks === 1 ? '' : 's'}.`
            : `An afternoon with a camera, guided by a capture brief. Unlocks ${info.blocks} format${info.blocks === 1 ? '' : 's'}.`,
          fixWith: info.upload ? 'Assets Library → Upload' : 'Capture → Start a session',
          unlocksPosts: info.blocks,
        });
      }

      /* ── 3. Somewhere to publish ─────────────────────────────────────── */

      /*
       * The blocker nothing checked, and the most expensive one to discover
       * late: a campaign with no connected account plans a month, drafts every
       * post, holds them all at the scheduler, and looks like it is working. The
       * calendar fills. Nothing goes out. Every other item here costs output;
       * this one costs the entire point.
       */
      const supported = new Set(deps.supportedPlatforms());
      const connected = (
        await Promise.all(
          [...supported].map(async (p) => ((await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, p)) ? p : null)),
        )
      ).filter((p): p is Platform => p !== null);

      if (connected.length === 0) {
        items.push({
          id: 'connection:none',
          severity: 'blocker',
          label: 'an account to publish to',
          hint: 'Without one, SPARK plans and drafts the whole month and every post stops at the scheduler.',
          fixWith: 'Settings → Account Connection',
          unlocksPosts: 0,
        });
      }

      const blockers = items.filter((i) => i.severity === 'blocker');
      const ready = blockers.length === 0 && plan.buildableNow > 0;

      return {
        ready,
        buildableNow: plan.buildableNow,
        potentialTotal: Math.max(plan.potentialWithCapture, plan.buildableNow),
        items,
        why: {
          summary: ready
            ? `Ready — ${plan.buildableNow} of ${Math.max(plan.potentialWithCapture, plan.buildableNow)} formats can be built today.`
            : blockers.length > 0
              ? `${blockers.length} thing${blockers.length === 1 ? '' : 's'} would stop this campaign producing anything.`
              : `${plan.buildableNow} of ${plan.potentialWithCapture} formats can be built today; the rest are waiting on something.`,
          factors: [
            { label: 'Buildable today', detail: `${plan.buildableNow} formats resolve against the assets that exist`, weight: 1 },
            {
              label: 'Ceiling for this window',
              detail: `${plan.potentialWithCapture} formats once every upload and capture is closed`,
            },
            { label: 'Connected accounts', detail: connected.length ? connected.join(', ') : 'none — nothing can be published' },
          ],
          evidence: ranked
            .slice(0, 3)
            .map((r) => ({ kind: 'rule' as const, id: r.playbook.playbook_id, note: r.playbook.name })),
          alternatives: [],
        },
      };
    },
  });
}
