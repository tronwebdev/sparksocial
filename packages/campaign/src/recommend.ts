import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { ContentStatus, Explanation, Objective, Platform, ToolError } from '@sparksocial/shared';
import { resolve, type AssetInventory, type ResolvedPlaybook } from '@sparksocial/playbooks';

/**
 * `calendar.recommend_slot` — `CAL-04`, the thing behind F9's "Ask Agent to
 * plan" and "Move existing post".
 *
 * ── What was missing ───────────────────────────────────────────────────────
 *
 * The calendar rendered a plan and offered no way to argue with it. Clicking an
 * empty day opened the draft panel's trigger phase, which asks *you* what the
 * post should be — the exact inverse of the design, where the agent proposes and
 * you accept, adjust or ask for another.
 *
 * Nothing in the registry could answer "what should go here". `playbook.resolve`
 * ranks formats for a brand, and `calendar.generate` places a whole month, and
 * neither answers the question for one date. This does, and it returns **two**
 * kinds of answer because the design's modal set offers two:
 *
 *   - `create` — the format that best fits this campaign, with what it is for.
 *   - `move` — an existing scheduled post that would sit better here.
 *
 * ── Why it carries a `why` and what it deliberately will not say ──────────
 *
 * Invariant 4: this is a decision the owner watches SPARK make, so both answers
 * are `Explanation`-bearing rather than bare picks.
 *
 * What it will not do is invent a hook. The prototype's preview shows one, and
 * showing a hook here would mean either spending a model call on copy the owner
 * has not yet accepted, or showing a line that the subsequent draft then
 * contradicts. Both are worse than naming the format and what it is designed to
 * do, which is knowable without writing anything. The hook arrives with the
 * draft, from the draft.
 *
 * Free and read-only — a recommendation that cost money would be a recommendation
 * nobody asked for twice.
 */

/** How many alternatives are worth cycling through before the list is honestly exhausted. */
const MAX_SUGGESTIONS = 8;

const Readiness = z.enum(['ready', 'needs_upload', 'needs_capture']);

export const CalendarRecommendSlotInput = z.object({
  campaignId: z.string().min(1),
  /** `YYYY-MM-DD`. The day the owner clicked. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'),
  /**
   * Playbook ids already offered and declined — "Try another suggestion".
   *
   * Sent by the caller rather than tracked server-side, because a recommendation
   * is not a session: two people looking at the same day should each see the
   * best answer, not each other's rejections.
   */
  excludePlaybookIds: z.array(z.string().min(1)).max(MAX_SUGGESTIONS).default([]),
  /** Content items already offered and declined, for the move suggestion. */
  excludeContentItemIds: z.array(z.string().min(1)).max(MAX_SUGGESTIONS).default([]),
});

export const CalendarRecommendSlotOutput = z.object({
  date: z.string(),
  /** What to make. Absent when no format this brand can run fits the campaign. */
  create: z
    .object({
      playbookId: z.string(),
      playbookName: z.string(),
      description: z.string(),
      mediaType: z.string(),
      /**
       * `direct_finish` | `generate` | `hybrid` — how this format gets made.
       *
       * Added because the calendar's Accept action called `content.draft` on
       * whatever came back, and `content.draft` refuses a `direct_finish`
       * playbook: it is filmed through the capture loop, not written. So a
       * perfectly good recommendation produced an error message naming a tool.
       * The recommendation is still right; the caller needed to know which of two
       * paths it opens.
       */
      mode: z.string(),
      platforms: z.array(Platform),
      pillar: z.string(),
      /** The campaign's objective, in its own words — what this post is chasing. */
      goal: z.string(),
      /** Where it will point people, when the campaign or the brand has said. */
      cta: z.string().optional(),
      /**
       * The prototype's "This post is designed to:" list. Derived from the
       * format's own `objective_fit` and pillar rather than written — every line
       * is an objective this format genuinely scores well on.
       */
      designedTo: z.array(z.string()),
      readiness: Readiness,
      missingRoles: z.array(z.string()),
      /** How many more suggestions are behind this one. */
      alternativesLeft: z.number().int(),
      why: Explanation,
    })
    .optional(),
  /** A post worth moving here. Absent when nothing would be better off. */
  move: z
    .object({
      contentItemId: z.string(),
      playbookName: z.string(),
      pillar: z.string(),
      currentlyAt: z.string(),
      platform: Platform.optional(),
      alternativesLeft: z.number().int(),
      why: Explanation,
    })
    .optional(),
  /**
   * Said when there is nothing to suggest, so the modal has a sentence rather
   * than an empty panel. A day with nothing to offer is a real state — a brand
   * with no assets and no filmable formats genuinely has no recommendation.
   */
  note: z.string().optional(),
});

/** Which objectives a format is actually good at — the threshold below which "designed to" would be a stretch. */
const FIT_FLOOR = 0.5;

const OBJECTIVE_WORDS: Record<string, string> = {
  bookings: 'turn attention into appointments',
  leads: 'start conversations with people who might buy',
  sales: 'move people to buy something',
  trials: 'get people to try it themselves',
  audience: 'reach people who have not heard of you',
  hiring: 'attract people who might want to work here',
};

const PILLAR_WORDS: Record<string, string> = {
  product: 'show what you actually sell',
  proof: 'let the work speak for itself',
  craft: 'show how it is done',
  community: 'sound like a person rather than a business',
  offer: 'make the reason to act now obvious',
  education: 'teach something worth knowing',
};

export const calendarRecommendSlot = defineTool({
  name: 'calendar.recommend_slot',
  version: 1,

  summary:
    'What should go on one date: the format that best fits this campaign and, separately, an existing ' +
    'scheduled post that would sit better here. Both carry their reasoning. Free, read-only, writes nothing.',

  input: CalendarRecommendSlotInput,
  output: CalendarRecommendSlotOutput,

  effect: 'read',
  autonomy: 'auto',
  scopes: ['owner', 'admin', 'editor', 'approver'],
  idempotent: true,
  surfaces: ['CAL-04'],

  async handler(input, ctx) {
    const campaign = await ctx.db.campaigns.get(input.campaignId, ctx.orgId);
    if (!campaign) {
      throw new ToolError('NOT_FOUND', 'No such campaign.', { campaignId: input.campaignId });
    }

    const genome = await ctx.db.genomes.get(campaign.genomeId, ctx.orgId);
    if (!genome) {
      throw new ToolError('NOT_FOUND', 'No such genome.', { genomeId: campaign.genomeId });
    }

    const [inventory, slots] = await Promise.all([
      ctx.db.assets.inventory(campaign.genomeId, ctx.orgId) as Promise<AssetInventory>,
      ctx.db.campaigns.slots(input.campaignId, ctx.orgId, campaign.genomeId),
    ]);

    const objective = campaign.objective;
    const create = recommendFormat({
      genome,
      inventory,
      objective,
      slots,
      excluded: new Set(input.excludePlaybookIds),
      ...(campaign.primaryCta ? { cta: campaign.primaryCta } : {}),
      ...(genome.offer?.primary_cta ? { brandCta: genome.offer.primary_cta } : {}),
    });

    const move = recommendMove({
      date: input.date,
      slots,
      excluded: new Set(input.excludeContentItemIds),
    });

    return {
      date: input.date,
      ...(create ? { create } : {}),
      ...(move ? { move } : {}),
      ...(!create && !move
        ? {
            // `AssetInventory` is a flat count per role, so an empty object is
            // genuinely "nothing uploaded" rather than "not loaded".
            note:
              Object.keys(inventory).length === 0
                ? 'Nothing to suggest yet — SPARK has no assets to work from. One upload usually unlocks several formats.'
                : 'Nothing to suggest for this date. Every format that fits has already been offered, and no scheduled post would be better off here.',
          }
        : {}),
    };
  },
});

/**
 * The best-fitting format this brand can actually run, excluding what has been
 * declined and what is already over-used in this campaign.
 *
 * Saturation matters here in a way it does not in `planCampaign`: that function
 * spreads a whole month at once, where this is answering "one more post" against
 * a month that already exists. Recommending a fourth run of the same format
 * because it happens to rank highest is how a calendar comes to read as
 * automated.
 */
function recommendFormat(args: {
  genome: Parameters<typeof resolve>[0];
  inventory: AssetInventory;
  objective: string;
  slots: Array<{ playbookId: string | null; pillar: string | null }>;
  excluded: Set<string>;
  cta?: string;
  brandCta?: string;
}): z.infer<typeof CalendarRecommendSlotOutput>['create'] {
  const { ranked } = resolve(args.genome, args.inventory);

  // How many times each format already appears in this campaign.
  const runs = new Map<string, number>();
  for (const slot of args.slots) {
    if (slot.playbookId) runs.set(slot.playbookId, (runs.get(slot.playbookId) ?? 0) + 1);
  }

  const objective = args.objective as z.infer<typeof Objective>;
  const candidates = ranked
    .filter((r) => !args.excluded.has(r.playbook.playbook_id))
    .map((r) => ({
      r,
      fit: r.playbook.objective_fit[objective] ?? 0,
      used: runs.get(r.playbook.playbook_id) ?? 0,
    }))
    /**
     * Objective fit first, then how little it has been used, then the resolver's
     * own score. Fit leads because a format that does not serve the campaign's
     * objective is the wrong answer however available it is — and `objective_fit`
     * is the signal the whole engine ranks on (`planCampaign` sorts by it too).
     */
    .sort((a, b) => b.fit - a.fit || a.used - b.used || b.r.score - a.r.score);

  const best = candidates[0];
  if (!best || best.fit <= 0) return undefined;

  const p = best.r.playbook;
  const readiness = readinessOf(best.r);

  return {
    playbookId: p.playbook_id,
    playbookName: p.name,
    description: p.description,
    mediaType: p.output.media_type,
    mode: p.mode,
    platforms: p.output.platforms,
    pillar: p.content_pillar,
    goal: objectiveWords(args.objective),
    ...(args.cta ?? args.brandCta ? { cta: args.cta ?? args.brandCta } : {}),
    designedTo: designedTo(p, objective),
    readiness,
    missingRoles: best.r.missingRoles,
    /**
     * How many are genuinely left to offer, and it has to *fall* as they are
     * declined or "try another" implies an endless queue.
     *
     * Declines count against the cap rather than only against the candidate
     * list: there are twenty-odd playbooks, so a bare `candidates.length - 1`
     * would promise eighteen more suggestions, of which the last fifteen are
     * formats the resolver already ranked as poor fits. Eight is the honest
     * depth, and after eight rejections the answer is that there is nothing
     * better — which the caller can then say instead of offering a ninth.
     */
    alternativesLeft: Math.max(
      0,
      Math.min(candidates.length - 1, MAX_SUGGESTIONS - 1 - args.excluded.size),
    ),
    why: {
      summary:
        readiness === 'ready'
          ? `${p.name} fits this campaign best of what you can make today.`
          : readiness === 'needs_upload'
            ? `${p.name} is the best fit, and it needs one file you probably already have.`
            : `${p.name} is the best fit, and it needs filming before it can be made.`,
      factors: [
        {
          label: `Suits ${args.objective}`,
          detail: `${Math.round(best.fit * 100)}% fit for this campaign's objective`,
          weight: best.fit,
        },
        {
          label: `${p.content_pillar} content`,
          detail: PILLAR_WORDS[p.content_pillar] ?? 'part of the balance this campaign was planned around',
        },
        {
          /**
           * Stated even when it is zero. "Not used yet in this campaign" is the
           * reason a format got picked over a higher-scoring one, and leaving it
           * out would make the ranking look arbitrary.
           */
          label: best.used === 0 ? 'Not used yet in this campaign' : `Used ${best.used}× already`,
          detail:
            best.used === 0
              ? 'nothing on the calendar repeats it'
              : `re-runs are spaced because this format is ${p.saturation_risk}-saturation`,
          weight: best.used === 0 ? 1 : 0.4,
        },
        ...(readiness === 'ready'
          ? []
          : [
              {
                label: readiness === 'needs_upload' ? 'Needs an upload first' : 'Needs filming first',
                detail: best.r.missingRoles.join(', '),
              },
            ]),
      ],
      evidence: [{ kind: 'rule' as const, id: p.playbook_id, note: p.description.slice(0, 200) }],
      /**
       * The runners-up by name, because "try another suggestion" is a real
       * control and the owner should be able to see there is a queue behind this
       * rather than one opinion.
       */
      alternatives: candidates.slice(1, 4).map((c) => ({
        option: c.r.playbook.name,
        rejectedBecause:
          c.fit < best.fit
            ? `${Math.round(c.fit * 100)}% fit against ${Math.round(best.fit * 100)}%`
            : c.used > best.used
              ? `equally good a fit, but already used ${c.used}× in this campaign`
              : 'scored lower on the Asset Graph',
      })),
    },
  };
}

/** Where the missing roles come from decides the words, so it is resolved once. */
function readinessOf(r: ResolvedPlaybook): z.infer<typeof Readiness> {
  if (!r.unlockable) return 'ready';
  return r.unlockedBy === 'upload' ? 'needs_upload' : 'needs_capture';
}

/**
 * A scheduled post that would be better off on this date.
 *
 * The reason has to be real, so there is exactly one basis: a **clash**. Two
 * posts of the same pillar on one day is the thing `placeCalendar` spaces for,
 * and moving one of them onto an empty day is a genuine improvement that can be
 * stated in a sentence. Anything cleverer — "engagement peaks on Fridays" — would
 * need per-day performance history the database does not keep.
 *
 * Returns nothing when there is no clash, which is the common and correct case.
 * A move suggestion that fires on every empty day would train people to ignore it.
 */
function recommendMove(args: {
  date: string;
  slots: Array<{
    id: string;
    playbookId: string | null;
    pillar: string | null;
    status: ContentStatus;
    scheduledAt: Date | null;
    platform: Platform | null;
  }>;
  excluded: Set<string>;
}): z.infer<typeof CalendarRecommendSlotOutput>['move'] {
  // Only unpublished slots can move, and only slots that are actually placed.
  const movable = args.slots.filter(
    (s) => s.scheduledAt && s.status !== 'published' && !args.excluded.has(s.id),
  );
  if (movable.length === 0) return undefined;

  // Nothing to move *to* if the day is already taken.
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  if (movable.some((s) => dayOf(s.scheduledAt!) === args.date)) return undefined;

  const byDay = new Map<string, typeof movable>();
  for (const slot of movable) {
    const key = dayOf(slot.scheduledAt!);
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }

  /**
   * The most crowded day, and within it the post whose pillar is duplicated —
   * moving a craft post off a day that already has another craft post is a
   * better answer than moving whichever happens to be first.
   */
  let candidate: (typeof movable)[number] | undefined;
  let fromDay = '';
  let crowd = 0;
  for (const [day, daySlots] of byDay) {
    if (daySlots.length < 2 || daySlots.length <= crowd) continue;
    const pillars = new Map<string, number>();
    for (const s of daySlots) if (s.pillar) pillars.set(s.pillar, (pillars.get(s.pillar) ?? 0) + 1);
    const duplicated = daySlots.find((s) => s.pillar && (pillars.get(s.pillar) ?? 0) > 1);
    candidate = duplicated ?? daySlots[daySlots.length - 1];
    fromDay = day;
    crowd = daySlots.length;
  }

  if (!candidate) return undefined;

  return {
    contentItemId: candidate.id,
    playbookName: candidate.playbookId ?? 'Untitled post',
    pillar: candidate.pillar ?? 'unknown',
    currentlyAt: candidate.scheduledAt!.toISOString(),
    ...(candidate.platform ? { platform: candidate.platform } : {}),
    alternativesLeft: Math.max(0, movable.length - 1),
    why: {
      summary: `${fromDay} has ${crowd} posts and this day has none.`,
      factors: [
        { label: 'Crowded day', detail: `${crowd} posts scheduled on ${fromDay}`, weight: 1 },
        ...(candidate.pillar
          ? [
              {
                label: `Duplicate ${candidate.pillar} content`,
                detail: 'another post that day covers the same pillar',
                weight: 0.8,
              },
            ]
          : []),
        { label: 'This day is empty', detail: `nothing is scheduled on ${args.date}` },
      ],
      evidence: [{ kind: 'metric' as const, id: candidate.id, note: `currently ${fromDay}` }],
      alternatives: [],
    },
  };
}

function objectiveWords(objective: string): string {
  return OBJECTIVE_WORDS[objective] ?? objective.replace(/_/g, ' ');
}

/**
 * The prototype's "This post is designed to:" list, derived rather than written.
 *
 * Every line is an objective the format genuinely scores at least `FIT_FLOOR` on,
 * plus what its pillar is for. A format that only serves one objective gets one
 * line, which is honest — padding the list to four would make every format look
 * equally versatile.
 */
function designedTo(
  playbook: { objective_fit: Record<string, number | undefined>; content_pillar: string },
  primary: string,
): string[] {
  const fits = Object.entries(playbook.objective_fit)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= FIT_FLOOR)
    // The campaign's own objective first, then the rest by strength.
    .sort((a, b) => (a[0] === primary ? -1 : b[0] === primary ? 1 : b[1] - a[1]))
    .slice(0, 3)
    .map(([objective]) => objectiveWords(objective));

  const pillar = PILLAR_WORDS[playbook.content_pillar];
  return pillar ? [...fits, pillar] : fits;
}
