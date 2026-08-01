import { describe, expect, it } from 'vitest';
import { AGENTS, ORCHESTRATOR, agentNames } from '../src/agents.js';
import { canCallTool, canDelegate, toolsInScope } from '../src/scope.js';

/**
 * §4.1's "isolated context windows with narrowed toolsets" made falsifiable.
 * The cases below are the ones that would actually hurt: Curator publishing,
 * Scout spending, a specialist spawning specialists.
 */

describe('narrowed toolsets are real', () => {
  it('Curator can retrieve assets but cannot publish', () => {
    expect(canCallTool('curator', 'asset.retrieve').allowed).toBe(true);
    expect(canCallTool('curator', 'publish.now').allowed).toBe(false);
  });

  it('Scout can read trends but cannot spend', () => {
    expect(canCallTool('scout', 'trend.rank').allowed).toBe(true);
    expect(canCallTool('scout', 'synthesize.avatar_video').allowed).toBe(false);
  });

  it('Field owns the capture loop but not the Asset Graph', () => {
    expect(canCallTool('field', 'direct.session.batch').allowed).toBe(true);
    expect(canCallTool('field', 'asset.retrieve').allowed).toBe(false);
  });

  it('Warden owns guardrails and engagement, nothing else', () => {
    expect(canCallTool('warden', 'guard.evaluate_draft').allowed).toBe(true);
    expect(canCallTool('warden', 'engage.reply.send').allowed).toBe(true);
    expect(canCallTool('warden', 'campaign.activate').allowed).toBe(false);
  });

  it('the refusal explains the fix rather than just denying', () => {
    const decision = canCallTool('curator', 'publish.now');
    expect(decision.reason).toBe('out_of_scope');
    expect(decision.detail).toContain('Delegate to the agent that owns this capability');
  });

  it('refuses an unknown agent instead of defaulting open', () => {
    const decision = canCallTool('nobody' as never, 'asset.retrieve');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('unknown_agent');
  });
});

describe('family matching is on segment boundaries', () => {
  it('matches the family root and its children', () => {
    expect(canCallTool('curator', 'asset').allowed).toBe(true);
    expect(canCallTool('curator', 'asset.gaps').allowed).toBe(true);
    expect(canCallTool('curator', 'asset.ingest_url').allowed).toBe(true);
  });

  it('does NOT match a different family that merely shares a prefix', () => {
    // A substring match would let `asset.*` reach `assetgraph.*` — silently
    // widening every agent whose scope happens to prefix another family's name.
    expect(canCallTool('curator', 'assetgraph.retrieve').allowed).toBe(false);
    expect(canCallTool('curator', 'assets_admin.purge').allowed).toBe(false);
  });

  it('honours exact-name entries without widening them to a family', () => {
    // Genesis has `asset.ingest_url` exactly, not `asset.*`.
    expect(canCallTool('genesis', 'asset.ingest_url').allowed).toBe(true);
    expect(canCallTool('genesis', 'asset.retrieve').allowed).toBe(false);
    expect(canCallTool('genesis', 'asset.ingest_url.extra').allowed).toBe(false);
  });
});

describe('delegation is orchestrator-only', () => {
  it('the orchestrator may delegate', () => {
    expect(canDelegate(ORCHESTRATOR).allowed).toBe(true);
  });

  it.each(agentNames().filter((a) => a !== ORCHESTRATOR))('%s may not delegate', (agent) => {
    const decision = canDelegate(agent);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('delegation_forbidden');
  });

  it('only one agent carries canDelegate in its definition', () => {
    const delegators = agentNames().filter((a) => AGENTS[a].canDelegate);
    expect(delegators).toEqual([ORCHESTRATOR]);
  });
});

describe('toolsInScope — what the model is even shown', () => {
  const registry = [
    'asset.retrieve',
    'asset.gaps',
    'assetgraph.internal',
    'publish.now',
    'trend.rank',
    'direct.brief.generate',
  ];

  it('narrows the visible toolset, so an out-of-scope tool is never attempted', () => {
    expect(toolsInScope('curator', registry).sort()).toEqual(['asset.gaps', 'asset.retrieve']);
  });

  it('returns nothing for an unknown agent', () => {
    expect(toolsInScope('nobody' as never, registry)).toEqual([]);
  });

  it('every agent sees a non-empty slice of a realistic registry', () => {
    // A scope that matches nothing is a typo in agents.ts, not a design choice.
    const broad = [
      'human.ask', 'agent.status', 'queue.plan.list', 'approval.decide',
      'genome.bootstrap_from_url', 'knowledge.ingest_site', 'asset.ingest_url',
      'campaign.activate', 'mix.derive_from_outcome', 'playbook.resolve', 'calendar.schedule',
      'asset.retrieve', 'draft.copy.write', 'synthesize.image', 'assemble.montage',
      'finish.trim', 'compose.render', 'direct.brief.generate', 'whatsapp.send',
      'guard.evaluate_draft', 'engage.classify', 'trend.rank', 'analytics.sync', 'learning.reweight',
    ];
    for (const agent of agentNames()) {
      expect(toolsInScope(agent, broad).length, `${agent} matched nothing`).toBeGreaterThan(0);
    }
  });
});
