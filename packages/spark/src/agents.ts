/**
 * THE SPARK AGENT TOPOLOGY — master plan §4.1.
 *
 * One orchestrator, nine specialists. Subagents run in isolated context windows
 * with **narrowed toolsets**, which is the part that has to be real rather than
 * aspirational: `scope.ts` enforces these allowlists at call time, so Curator
 * physically cannot publish and Scout physically cannot spend.
 *
 * ## Why not the Claude Agent SDK
 *
 * Plan §2.2 names the Claude Agent SDK. That package is Claude Code as a
 * library — it ships built-in `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`
 * tools. Handing SPARK a `Bash` tool would create a code path that mutates state
 * without going through `defineTool`, which is exactly what CLAUDE.md invariant 1
 * forbids, and it would bypass the policy engine, the audit row, and genome
 * isolation in one step.
 *
 * What the plan actually wants from it — a tool loop, subagents, context
 * compaction, and policy hooks — is what the Anthropic SDK's **Tool Runner**
 * provides over *our* registry (`loop.ts`). Subagents are this file; policy hooks
 * are already `invokeTool`'s middleware chain. So the runtime is built on
 * `@anthropic-ai/sdk`, and the only tools any agent can reach are registry tools.
 *
 * ## Model tiering
 *
 * Plan §2.2: Opus for orchestration, planning, creative direction and judging;
 * Sonnet for bulk copy, briefs, replies and classification at volume; Haiku for
 * routing, intent tagging and moderation prefilter. Roughly 80% of calls should
 * land on Sonnet or Haiku.
 */

/** Model IDs. Opus 5 is the current flagship; Sonnet 5 and Haiku 4.5 are the volume tiers. */
export const MODELS = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
} as const;

export type ModelTier = keyof typeof MODELS;

export type AgentName =
  | 'spark'
  | 'genesis'
  | 'planner'
  | 'curator'
  | 'director'
  | 'producer'
  | 'field'
  | 'warden'
  | 'scout'
  | 'analyst';

export interface AgentDefinition {
  name: AgentName;
  /** One line, for the orchestrator's delegation prompt. */
  responsibility: string;
  /**
   * Tool families this agent may call, as dotted prefixes ending in `.*`, or
   * exact tool names. This is an **allowlist** — anything not listed is refused
   * by `scope.ts` before the middleware chain is even entered.
   */
  toolScopes: string[];
  model: ModelTier;
  /**
   * Effort level. Per the Opus 5 guidance, `xhigh` suits coding/agentic work and
   * `high` most other intelligence-sensitive work; `low` is right for routing and
   * prefiltering, where the task is classification rather than reasoning.
   */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** True for the orchestrator — only it may delegate to other agents. */
  canDelegate?: boolean;
}

export const AGENTS: Record<AgentName, AgentDefinition> = {
  spark: {
    name: 'spark',
    responsibility: 'User conversation, intent to delegation, chat drawer commands, explainability.',
    toolScopes: ['human.*', 'agent.*', 'queue.*', 'approval.*'],
    model: 'opus',
    effort: 'high',
    canDelegate: true,
  },

  genesis: {
    name: 'genesis',
    responsibility: 'Workspace setup: crawl, infer, play back chips, seed the Asset Graph.',
    toolScopes: ['genome.*', 'knowledge.*', 'asset.ingest_url', 'asset.upload', 'asset.caption', 'asset.embed'],
    model: 'opus',
    effort: 'high',
  },

  planner: {
    name: 'planner',
    responsibility: 'Outcome to volume, platforms, mix, calendar, gap report.',
    toolScopes: ['campaign.*', 'mix.*', 'playbook.*', 'calendar.*', 'asset.gaps'],
    model: 'opus',
    effort: 'xhigh',
  },

  curator: {
    name: 'curator',
    responsibility: 'Asset retrieval, gap detection, cooldown, rights.',
    toolScopes: ['asset.*'],
    model: 'sonnet',
    effort: 'medium',
  },

  director: {
    name: 'director',
    responsibility: 'Per-slot brief, playbook beat filling, copy, hooks, CTA.',
    /**
     * `content.draft` (not `content.generate_*`) — Director writes the script,
     * Producer spends the money rendering it. `draft.*` was the placeholder
     * name this scope was written against before `packages/generate` settled
     * on `content.*`; it matched nothing in the real registry, which the
     * "matches nothing is a typo" test in `scope.test.ts` exists to catch and
     * would have caught here had this file been re-checked against the
     * registry as tools landed.
     */
    toolScopes: ['content.draft', 'playbook.resolve'],
    model: 'opus',
    effort: 'high',
  },

  producer: {
    name: 'producer',
    responsibility: 'Executes the three pipelines; renders, exports, and ships.',
    /**
     * `publish.*` and `integration.*` are assigned here, and the plan does not
     * say so — §4.1's table lists a "Primary tools" column for each agent and
     * the publish family appears in none of them, even though §3.2 defines it.
     * Left unassigned, no agent can publish at all, which the scope tests catch
     * immediately.
     *
     * Producer is the defensible owner: it is the agent that "executes the
     * pipelines", and publishing is the terminal step of one. The alternative —
     * giving it to the orchestrator — would put the single highest-consequence
     * capability in the agent with the broadest remit, which is the wrong
     * direction for blast radius. Worth confirming when §4.1 is next revised.
     */
    /**
     * `synthesize.*`/`finish.*` were placeholder families this scope was
     * written against and never existed in the real registry; the
     * direct_finish pipeline's actual tool (`direct.media.ingest`) belongs to
     * Field, not Producer (it already owns `direct.*`). `compose.*` is real
     * as of `compose.render` (P2) — the beat-list-to-pixels render step is
     * exactly "executes the pipelines; renders, exports, ships", Producer's
     * own description. The three `content.generate_*` tools are what
     * actually spends money rendering a beat, which is Producer's job by the
     * same reasoning; `content.draft` (the cheap half) stays with Director.
     */
    toolScopes: ['assemble.*', 'compose.*', 'content.generate_image', 'content.generate_avatar_video', 'content.generate_voiceover', 'publish.*', 'integration.*'],
    model: 'sonnet',
    effort: 'medium',
  },

  field: {
    name: 'field',
    responsibility: 'Capture loop: briefs, batching, WhatsApp, ingest, quality, reshoot, fallback.',
    toolScopes: ['direct.*', 'whatsapp.*'],
    model: 'sonnet',
    effort: 'medium',
  },

  warden: {
    name: 'warden',
    responsibility: 'Guardrails and engagement: classification, replies, escalation, opportunities.',
    toolScopes: ['guard.*', 'engage.*'],
    model: 'sonnet',
    effort: 'medium',
  },

  scout: {
    name: 'scout',
    responsibility: 'Trend discovery, ranking, brand-safety, repurpose candidates.',
    toolScopes: ['trend.*'],
    model: 'sonnet',
    effort: 'medium',
  },

  analyst: {
    name: 'analyst',
    responsibility: 'Metrics ingestion, outcome reporting, mix reweighting, memory distillation.',
    /**
     * `learning.*` (Thompson-sampling mix reweighting, memory distillation —
     * the plan's outcome loop) was in this list from the start and matched
     * nothing in the real registry, same bug pattern already fixed on
     * director/producer: no `learning_*` schema, no tools, nothing to grant a
     * scope to. It is a materially larger feature than `analytics.sync` (P4)
     * landing next to it, tracked separately rather than claimed here.
     * `analytics.*` is real as of `analytics.sync` (P4) — the analyst's one
     * actual capability today is pulling metrics, not yet acting on them.
     */
    toolScopes: ['analytics.*'],
    model: 'sonnet',
    effort: 'medium',
  },
};

export const agentNames = (): AgentName[] => Object.keys(AGENTS) as AgentName[];

/**
 * The only agent permitted to delegate. Enforced so a subagent cannot spawn
 * further subagents — plan §4.1 is one orchestrator and nine specialists, not a
 * tree, and an unbounded delegation depth is how an agent run becomes unbillable.
 */
export const ORCHESTRATOR: AgentName = 'spark';
