import { AGENTS, ORCHESTRATOR, type AgentName } from './agents.js';

/**
 * TOOL SCOPE ENFORCEMENT.
 *
 * Plan §4.1 describes subagents running "with narrowed toolsets". A comment
 * saying so is not enforcement; this is. Pure function, checked before the
 * middleware chain is entered, so a Scout that tries to publish is refused
 * without ever reaching the policy engine.
 *
 * This sits *above* `packages/tools/src/policy.ts`, not instead of it. Policy
 * answers "is this caller allowed to do this, under this brand's governance?";
 * scope answers "is this tool even part of this agent's job?". A Curator calling
 * `publish.now` is not a governance decision to be approved — it is a routing
 * bug, and it should read as one.
 */

export interface ScopeDecision {
  allowed: boolean;
  /** Stable machine reason, for the audit row and the Agent Timeline. */
  reason?: 'out_of_scope' | 'unknown_agent' | 'delegation_forbidden';
  detail?: string;
}

const ALLOWED: ScopeDecision = { allowed: true };

/**
 * A scope entry is either an exact tool name (`asset.gaps`) or a family prefix
 * ending in `.*` (`asset.*`). Family matching is on the dotted segment boundary,
 * so `asset.*` matches `asset.retrieve` but never `assetgraph.retrieve` — a
 * substring match here would silently widen every agent's reach.
 */
function matchesScope(toolName: string, scope: string): boolean {
  if (!scope.endsWith('.*')) return toolName === scope;
  const family = scope.slice(0, -2);
  return toolName === family || toolName.startsWith(`${family}.`);
}

export function canCallTool(agent: AgentName, toolName: string): ScopeDecision {
  const def = AGENTS[agent];
  if (!def) {
    return { allowed: false, reason: 'unknown_agent', detail: `No agent named "${agent}".` };
  }

  const permitted = def.toolScopes.some((scope) => matchesScope(toolName, scope));
  if (permitted) return ALLOWED;

  return {
    allowed: false,
    reason: 'out_of_scope',
    detail:
      `${agent} may not call "${toolName}" — its scope is ${def.toolScopes.join(', ')}. ` +
      `Delegate to the agent that owns this capability instead of widening the scope.`,
  };
}

/**
 * Only the orchestrator delegates. A subagent that could spawn subagents makes
 * run cost and depth unbounded, and plan §4.1's topology is deliberately flat.
 */
export function canDelegate(agent: AgentName): ScopeDecision {
  if (agent === ORCHESTRATOR) return ALLOWED;
  return {
    allowed: false,
    reason: 'delegation_forbidden',
    detail: `Only ${ORCHESTRATOR} may delegate; ${agent} is a specialist and must return its result instead.`,
  };
}

/**
 * The tool names an agent may see. The Tool Runner is handed exactly this subset,
 * so an out-of-scope tool is not merely refused on call — it is never described
 * to the model in the first place, which is what stops it being attempted.
 */
export function toolsInScope(agent: AgentName, allToolNames: readonly string[]): string[] {
  const def = AGENTS[agent];
  if (!def) return [];
  return allToolNames.filter((name) => def.toolScopes.some((scope) => matchesScope(name, scope)));
}
