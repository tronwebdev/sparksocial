/**
 * The shapes the cockpit reads, mirroring the tool outputs it calls.
 *
 * Declared here rather than imported from the packages that define them, because
 * `apps/web` may import `@sparksocial/shared` and nothing else from `packages/`
 * (CLAUDE.md, and `packages/db/test/isolation.test.ts` fails the build if that
 * slips) — and these live in `analytics`, `engage` and `spark`. The tool schemas
 * are the source of truth; a drift here shows up as an undefined field rather
 * than a wrong number, which is why every one of them is optional or guarded at
 * the point of use.
 */

/**
 * `analytics.brand_series`
 *
 * The tool now returns the interactions individually as well as summed —
 * likes, comments, shares and saves beside `engagements` — because `CC-04`'s
 * Performance tiles need the parts. `changePct` replaced the two scalar
 * `*ChangePct` fields for the same reason: six tiles each want a delta, and
 * six scalars would put the "null when there was nothing before" rule in six
 * places.
 *
 * Clicks are not here on purpose. A click is a CTA-link event Dub owns, read
 * by `analytics.cta_traffic` — putting it on this tool would either duplicate
 * Dub's number or make the dashboard's main read wait on an external API.
 */
export interface SeriesTotals {
  posts: number;
  impressions: number;
  views: number;
  engagements: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface BrandSeries {
  windowDays: number;
  basis: string;
  days: Array<{
    date: string;
    posts: number;
    impressions: number;
    engagements: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }>;
  totals: SeriesTotals;
  previous: SeriesTotals;
  changePct: {
    impressions: number | null;
    engagements: number | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  byPlatform: Array<{ platform: string; impressions: number; share: number }>;
  maturing: number;
  unmeasured: number;
}

/** `agent.run.list` */
export interface AgentRun {
  runId: string;
  agent: string;
  goal: string;
  trigger: string;
  status: string;
  costCents: number;
  startedAt: string;
  endedAt?: string;
  durationMs: number | null;
}

/** `engage.opportunity.list` */
export interface Lead {
  opportunityId: string;
  messageId: string;
  temperature: 'hot' | 'warm' | 'cold';
  recommendedAction: string;
  routedTo?: string;
  raisedAt: string;
  platform?: string;
  authorHandle?: string;
  authorName?: string;
  messageText?: string;
  intentScore?: number;
  receivedAt?: string;
}

/** `trend.rank` */
export interface RankedTrend {
  trendId: string;
  topic: string;
  score: number;
  opportunity: number;
  relevance: number;
}

/** `content.list` */
export interface UpcomingPost {
  contentItemId: string;
  playbookName: string;
  mediaType?: string;
  platform?: string;
  status: string;
  summary: string;
  scheduledAt?: string;
}

/** `brand.governance.get`, the part the cockpit uses. */
export interface BrandKit {
  steps: Array<{ id: string; label: string; done: boolean; because: string }>;
  completed: number;
  total: number;
  pct: number;
  next?: { id: string; label: string; done: boolean; because: string };
}
