import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentPillar, Explanation, GenerationMode, Objective, ToolError } from '@sparksocial/shared';
import { byId, type AssetInventory, type Playbook } from '@sparksocial/playbooks';
import { planCampaign } from './plan.js';
import { placeCalendar } from './calendar.js';

/**
 * CALENDAR TOOLS — engine spec §6.8 Step 4; PRD `CAL-01`→`CAL-06`.
 *
 * Four tools, one loop:
 *
 *   `campaign.list`      — which campaigns exist for this genome, so a caller
 *                          that only knows the genome can find the active one
 *   `campaign.create`  — commit to an outcome, snapshotting the approved plan
 *   `calendar.generate` — lay that plan out as dated slots
 *   `calendar.get`      — read the month at mix level
 *
 * `calendar.generate` is idempotent by *replacement*, not by key: regenerating
 * is the normal path — the user says "less offer, more craft" and asks again —
 * so running it twice must produce one calendar, not two.
 */

const MIX_OVERRIDE_MAX = 1;

export const CampaignCreateInput = z.object({
  genomeId: z.string().min(1),
  name: z.string().min(1).max(120),
  objective: Objective,
  windowDays: z.number().int().min(7).max(90).default(30),
  /** Defaults to now. Explicit so a plan can be laid out for next month. */
  startAt: z.string().datetime().optional(),
  /**
   * §6.8 Step 1's "target & window" follow-up. Optional — not every objective
   * has a natural count ("grow audience" often doesn't) — but without it,
   * `campaign.report_vs_outcome` has nothing to compare progress against.
   */
  targetCount: z.number().int().positive().optional(),
  /** What targetCount counts, in the owner's own words — "bookings", "trials", "signups". */
  targetLabel: z.string().min(1).max(60).optional(),
});

export const CampaignCreateOutput = z.object({
  campaignId: z.string(),
  name: z.string(),
  objective: Objective,
  windowDays: z.number(),
  startAt: z.string(),
  targetCount: z.number().optional(),
  targetLabel: z.string().optional(),
});

export const campaignCreate = defineTool({
  name: 'campaign.create',
  version: 1,

  summary:
    'Commit to a campaign: an outcome over a window. Snapshots the plan the owner approved. ' +
    'Call campaign.propose_plan first to show them the numbers. Free.',

  input: CampaignCreateInput,
  output: CampaignCreateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  idempotent: false,
  surfaces: ['CMP-01.1'],

  async handler(input, ctx) {
    const genome = await ctx.db.genomes.get(input.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: input.genomeId });

    const inventory = (await ctx.db.assets.inventory(input.genomeId, ctx.orgId)) as AssetInventory;
    const startAt = input.startAt ? new Date(input.startAt) : new Date();

    // The plan is snapshotted at creation, not recomputed on read: the resolver
    // and the Asset Graph both move underneath a live campaign, and reopening
    // it in week three must show the numbers the owner actually agreed to.
    const plan = planCampaign({
      genome,
      inventory,
      objective: input.objective,
      windowDays: input.windowDays,
    });

    const { id } = await ctx.db.campaigns.create({
      orgId: ctx.orgId,
      genomeId: input.genomeId,
      name: input.name,
      objective: input.objective,
      windowDays: input.windowDays,
      startAt,
      plan,
      ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
      ...(input.targetLabel !== undefined ? { targetLabel: input.targetLabel } : {}),
    });

    ctx.logger.info('campaign created', {
      campaignId: id,
      genomeId: input.genomeId,
      objective: input.objective,
      ...(input.targetCount !== undefined ? { targetCount: input.targetCount, targetLabel: input.targetLabel } : {}),
    });

    return {
      campaignId: id,
      name: input.name,
      objective: input.objective,
      windowDays: input.windowDays,
      startAt: startAt.toISOString(),
      ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
      ...(input.targetLabel !== undefined ? { targetLabel: input.targetLabel } : {}),
    };
  },
});

export const CampaignListInput = z.object({
  genomeId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

export const CampaignListOutput = z.object({
  campaigns: z.array(
    z.object({
      campaignId: z.string(),
      name: z.string(),
      objective: z.string(),
      windowDays: z.number(),
      startAt: z.string(),
      status: z.string(),
    }),
  ),
});

export const campaignList = defineTool({
  name: 'campaign.list',
  version: 1,

  summary:
    'Every campaign for a genome, most recently started first — the Command Center\'s way of finding ' +
    'the active one without already knowing its id. Free.',

  input: CampaignListInput,
  output: CampaignListOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CC-01'],

  async handler(input, ctx) {
    const rows = await ctx.db.campaigns.listForGenome(input.genomeId, ctx.orgId, input.limit);
    return {
      campaigns: rows.map((c) => ({
        campaignId: c.id,
        name: c.name,
        objective: c.objective,
        windowDays: c.windowDays,
        startAt: c.startAt.toISOString(),
        status: c.status,
      })),
    };
  },
});

/**
 * §6.8 Step 4's adjustment surface: *"Adjust with 'less offer, more craft' and
 * regenerate."*
 *
 * Overrides are relative weights on top of the derived mix, not absolute counts.
 * The user is expressing a preference about balance, not doing arithmetic — and
 * absolute counts would let them set a mix the promotional ceiling forbids.
 */
export const CalendarGenerateInput = z.object({
  campaignId: z.string().min(1),
  mixOverride: z.record(ContentPillar, z.number().min(0).max(MIX_OVERRIDE_MAX)).optional(),
});

export const CalendarGenerateOutput = z.object({
  campaignId: z.string(),
  slotCount: z.number(),
  slots: z.array(
    z.object({
      scheduledAt: z.string(),
      pillar: ContentPillar,
      playbookId: z.string(),
      playbookName: z.string(),
      mode: GenerationMode,
    }),
  ),
  unfilledPillars: z.array(z.object({ pillar: ContentPillar, count: z.number() })),
  why: Explanation,
});

export const calendarGenerate = defineTool({
  name: 'calendar.generate',
  version: 1,

  summary:
    'Lay a campaign out as a dated calendar, spread across the window and balanced across pillars. ' +
    'Replaces any previous unpublished slots, so it is safe to regenerate after a mix adjustment. Free.',

  input: CalendarGenerateInput,
  output: CalendarGenerateOutput,

  effect: 'write',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor'],
  // Replacement makes repeat calls converge on one calendar rather than
  // stacking months, so no key is needed.
  idempotent: true,
  surfaces: ['CAL-01', 'CAL-04'],

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });

    const genome = await ctx.db.genomes.get(campaign.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: campaign.genomeId });

    const inventory = (await ctx.db.assets.inventory(campaign.genomeId, ctx.orgId)) as AssetInventory;

    // Re-planned rather than read from the snapshot when a mix override is
    // given: the override changes the pillar split, and the ceiling and
    // normalisation have to run over it. Without an override this reproduces
    // the snapshot's numbers from the same inputs.
    const plan = planCampaign({
      genome: input.mixOverride ? withMixOverride(genome, input.mixOverride) : genome,
      inventory,
      objective: campaign.objective as z.infer<typeof Objective>,
      windowDays: campaign.windowDays,
    });

    const playbooks = plan.readyPlaybookIds
      .map((id) => byId(id))
      .filter((p): p is Playbook => p !== undefined);

    const placed = placeCalendar({
      mix: plan.mix,
      playbooks,
      windowDays: campaign.windowDays,
      startAt: campaign.startAt,
    });

    const written = await ctx.db.campaigns.replaceSlots({
      campaignId: campaign.id,
      orgId: ctx.orgId,
      genomeId: campaign.genomeId,
      slots: placed.slots.map((s) => ({
        playbookId: s.playbookId,
        mode: s.mode,
        pillar: s.pillar,
        scheduledAt: s.scheduledAt,
      })),
    });

    ctx.logger.info('calendar generated', {
      campaignId: campaign.id,
      slots: written,
      unfilled: placed.unfilledPillars.length,
    });

    return {
      campaignId: campaign.id,
      slotCount: written,
      slots: placed.slots.map((s) => ({
        scheduledAt: s.scheduledAt.toISOString(),
        pillar: s.pillar,
        playbookId: s.playbookId,
        playbookName: byId(s.playbookId)?.name ?? s.playbookId,
        mode: s.mode,
      })),
      unfilledPillars: placed.unfilledPillars,
      why: explainCalendar(placed.slots.length, placed.unfilledPillars, plan.mixWhy, Boolean(input.mixOverride)),
    };
  },
});

/**
 * `calendar.impact_preview` — the dry-run `calendar.generate` never had.
 * `calendar.generate` replaces every unpublished slot the moment it's
 * called, so "less offer, more craft" committed sight-unseen — the caller
 * only found out what changed by reading the calendar back afterward. This
 * runs the identical planning/placement pipeline `calendar.generate` does
 * (same `withMixOverride`, same `planCampaign`, same `placeCalendar`) and
 * diffs the result against the campaign's current slots, without calling
 * `replaceSlots` — nothing is written.
 */
export const CalendarImpactPreviewInput = z.object({
  campaignId: z.string().min(1),
  mixOverride: z.record(ContentPillar, z.number().min(0).max(MIX_OVERRIDE_MAX)).optional(),
});

const PillarCount = z.object({ pillar: z.string(), count: z.number() });

export const CalendarImpactPreviewOutput = z.object({
  campaignId: z.string(),
  currentSlotCount: z.number(),
  proposedSlotCount: z.number(),
  mixBefore: z.array(PillarCount),
  mixAfter: z.array(PillarCount),
  unfilledPillars: z.array(z.object({ pillar: ContentPillar, count: z.number() })),
  wouldChange: z.boolean(),
  why: Explanation,
});

function countByPillar(slots: Array<{ pillar: string | null }>): Array<{ pillar: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of slots) {
    if (!s.pillar) continue;
    counts.set(s.pillar, (counts.get(s.pillar) ?? 0) + 1);
  }
  return [...counts.entries()].map(([pillar, count]) => ({ pillar, count })).sort((a, b) => a.pillar.localeCompare(b.pillar));
}

export const calendarImpactPreview = defineTool({
  name: 'calendar.impact_preview',
  version: 1,

  summary:
    'Show what calendar.generate (with the same mixOverride) would change before committing — current vs. ' +
    'proposed slot count and pillar mix. Nothing is written; call calendar.generate to actually apply it.',

  input: CalendarImpactPreviewInput,
  output: CalendarImpactPreviewOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer'],
  idempotent: true,
  surfaces: ['CAL-06'],

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });

    const genome = await ctx.db.genomes.get(campaign.genomeId, ctx.orgId);
    if (!genome) throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: campaign.genomeId });

    const [inventory, currentSlots] = await Promise.all([
      ctx.db.assets.inventory(campaign.genomeId, ctx.orgId) as Promise<AssetInventory>,
      ctx.db.campaigns.slots(campaign.id, ctx.orgId, campaign.genomeId),
    ]);

    const plan = planCampaign({
      genome: input.mixOverride ? withMixOverride(genome, input.mixOverride) : genome,
      inventory,
      objective: campaign.objective as z.infer<typeof Objective>,
      windowDays: campaign.windowDays,
    });

    const playbooks = plan.readyPlaybookIds.map((id) => byId(id)).filter((p): p is Playbook => p !== undefined);

    const placed = placeCalendar({
      mix: plan.mix,
      playbooks,
      windowDays: campaign.windowDays,
      startAt: campaign.startAt,
    });

    const mixBefore = countByPillar(currentSlots);
    const mixAfter = countByPillar(placed.slots);
    const wouldChange =
      currentSlots.length !== placed.slots.length || JSON.stringify(mixBefore) !== JSON.stringify(mixAfter);

    return {
      campaignId: campaign.id,
      currentSlotCount: currentSlots.length,
      proposedSlotCount: placed.slots.length,
      mixBefore,
      mixAfter,
      unfilledPillars: placed.unfilledPillars,
      wouldChange,
      why: {
        ...explainCalendar(placed.slots.length, placed.unfilledPillars, plan.mixWhy, Boolean(input.mixOverride)),
        summary: wouldChange
          ? `Regenerating would go from ${currentSlots.length} to ${placed.slots.length} posts, with the pillar mix rebalanced. Nothing has been written — call calendar.generate to apply this.`
          : `Regenerating would produce the same ${placed.slots.length} posts and mix already scheduled — no real change.`,
      },
    };
  },
});

export const CalendarGetInput = z.object({ campaignId: z.string().min(1) });

export const CalendarGetOutput = z.object({
  campaignId: z.string(),
  name: z.string(),
  objective: z.string(),
  status: z.string(),
  /** Counts by pillar — the level §6.8 Step 4 says the user reviews at. */
  mixActual: z.array(z.object({ pillar: z.string(), count: z.number() })),
  slots: z.array(
    z.object({
      id: z.string(),
      scheduledAt: z.string().nullable(),
      pillar: z.string().nullable(),
      playbookId: z.string().nullable(),
      playbookName: z.string().nullable(),
      mode: z.string().nullable(),
      status: z.string(),
    }),
  ),
});

export const calendarGet = defineTool({
  name: 'calendar.get',
  version: 1,

  summary:
    'Read a campaign’s calendar: every slot with its date, pillar and format, plus the actual pillar mix. ' +
    'Free.',

  input: CalendarGetInput,
  output: CalendarGetOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver', 'viewer', 'client'],
  idempotent: true,
  surfaces: ['CAL-01'],

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });

    const slots = await ctx.db.campaigns.slots(campaign.id, ctx.orgId, campaign.genomeId);

    const counts = new Map<string, number>();
    for (const s of slots) {
      if (!s.pillar) continue;
      counts.set(s.pillar, (counts.get(s.pillar) ?? 0) + 1);
    }

    return {
      campaignId: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      mixActual: [...counts.entries()]
        .map(([pillar, count]) => ({ pillar, count }))
        .sort((a, b) => b.count - a.count),
      slots: slots.map((s) => ({
        id: s.id,
        scheduledAt: s.scheduledAt?.toISOString() ?? null,
        pillar: s.pillar,
        playbookId: s.playbookId,
        playbookName: s.playbookId ? (byId(s.playbookId)?.name ?? null) : null,
        mode: s.mode,
        status: s.status,
      })),
    };
  },
});

/**
 * Applies a relative mix override by writing it into the genome's `learned`
 * overrides, so it flows through `deriveMix` — which normalises and re-caps.
 *
 * Routing it through the same path as learned weights rather than mutating the
 * counts directly is what stops "more offer" from producing an account that is
 * 80% promotional: the ceiling is applied in one place, and a user preference
 * is not allowed to bypass what the learning loop cannot.
 */
function withMixOverride(
  genome: Parameters<typeof planCampaign>[0]['genome'],
  override: Partial<Record<z.infer<typeof ContentPillar>, number>>,
): Parameters<typeof planCampaign>[0]['genome'] {
  return {
    ...genome,
    learned: {
      ...genome.learned,
      // Above the 0.4 threshold so `deriveMix` uses the override path; the
      // weights themselves are still normalised and capped there.
      confidence: 1,
      mix_weights_override: { ...(genome.learned.mix_weights_override ?? {}), ...override },
    },
  };
}

function explainCalendar(
  slotCount: number,
  unfilled: Array<{ pillar: string; count: number }>,
  mixWhy: string,
  adjusted: boolean,
): Explanation {
  return {
    summary:
      `${slotCount} posts scheduled across the window, spaced so no format or pillar runs back to back` +
      `${adjusted ? ', with your mix adjustment applied' : ''}.`,
    factors: [
      { label: 'slots', detail: String(slotCount) },
      { label: 'mix', detail: adjusted ? 'adjusted by you, then re-capped' : 'derived' },
      ...(unfilled.length
        ? [{ label: 'unfilled', detail: unfilled.map((u) => `${u.pillar} ${u.count}`).join(', ') }]
        : []),
    ],
    evidence: [{ kind: 'rule', id: 'mix.derive', note: mixWhy }],
    // Naming what could not be scheduled, and why, beats a calendar with a
    // silent hole in it.
    alternatives: unfilled.map((u) => ({
      option: `${u.count} more ${u.pillar} posts`,
      rejectedBecause: 'no format this brand can make serves that pillar',
    })),
  };
}
