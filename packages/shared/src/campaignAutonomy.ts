/**
 * THE CAMPAIGN'S OWN VOCABULARY — the wizard's fields, and the engagement
 * ladder (`CMP-01`, F8).
 *
 * In `shared` because three packages on different sides of the build order need
 * the same answers. `campaign` writes these fields, `engage` obeys the rung, and
 * `apps/web` renders both. A rung that meant one thing to the wizard and another
 * to the reply path would be worse than no rung at all.
 */

/**
 * The shape of content a campaign runs, distinct from its objective.
 *
 * The objective is what success looks like; the type is how the campaign chases
 * it. "More enquiries" can be pursued by a lead magnet or by an authority
 * series, and those produce very different mixes.
 */
export type CampaignType = 'promotion' | 'lead_magnet' | 'authority' | 'launch';

/** The prototype's "how much attention should this get?". */
export type CampaignWeight = 'dominant' | 'balanced' | 'light';

/**
 * The engagement ladder — four rungs, decided 22 August.
 *
 * The build previously had three values on the *brand* (`off`/`suggest`/`auto`)
 * and treated Sales Assist as separate configuration. The decision was four
 * rungs with that configuration sitting **on top of** the top rung, so the
 * qualification moves and handoff rules apply when the rung is `sales_assist`
 * and are dormant below it.
 */
export type EngagementRung = 'observe' | 'suggest' | 'auto_reply' | 'sales_assist';

export const ENGAGEMENT_RUNGS: readonly EngagementRung[] = [
  'observe',
  'suggest',
  'auto_reply',
  'sales_assist',
];

/**
 * The rung, expressed as the three-value autonomy the reply path already reads.
 *
 * `policy.ts` rule 6 asks one question — has autonomy been configured — and
 * `engage.autohandle` asks how far it may go. Both were written against
 * `off | suggest | auto`, and both are correct as written; what changed is where
 * the value comes from. Mapping here rather than rewriting them keeps one
 * definition of "may it reply" instead of two that can disagree.
 *
 * `sales_assist` maps to `auto` because it *is* auto-reply, plus a
 * configuration. A rung that answered replies differently from `auto_reply`
 * would make the ladder two ladders.
 */
export function rungAutonomy(rung: EngagementRung | undefined): 'off' | 'suggest' | 'auto' {
  switch (rung) {
    case 'suggest':
      return 'suggest';
    case 'auto_reply':
    case 'sales_assist':
      return 'auto';
    case 'observe':
    default:
      // `observe` is "read and categorise", which is the same permission as
      // never replying. Undefined lands here too: a campaign that has not
      // answered has not opted in.
      return 'off';
  }
}

/**
 * The brand's three-value autonomy, widened onto the four-rung ladder.
 *
 * The brand is the **template** a new campaign is seeded from, and the two
 * vocabularies are different sizes, so the widening has to be written down
 * somewhere. It is written here because it has two readers on opposite sides of
 * the wire: `campaign.create` applies it when the caller names no rung, and the
 * wizard applies it to preselect the rung it is about to send. A wizard that
 * showed `Suggest Replies` while the server seeded `Auto Reply` would be a
 * screen that lies about what activating does.
 *
 * `auto` becomes `auto_reply` and **not** `sales_assist`: promoting a brand that
 * only ever said "answer the safe ones" onto the rung where qualification moves
 * and handoff rules apply would grant a capability nobody asked for.
 */
export function rungFromBrandAutonomy(
  autonomy: 'off' | 'suggest' | 'auto' | undefined,
): EngagementRung {
  switch (autonomy) {
    case 'suggest':
      return 'suggest';
    case 'auto':
      return 'auto_reply';
    case 'off':
    default:
      return 'observe';
  }
}

/**
 * Whether this campaign's Sales Assist configuration applies.
 *
 * The narrow half of "config on top": the qualification moves and the handoff
 * rules are dormant unless the campaign is on the top rung.
 *
 * The escalation keyword list is deliberately **not** gated by this. It is a
 * floor rather than a feature — the words an owner types there mean "never let
 * the agent answer this", and a refund demand is exactly as dangerous on
 * `auto_reply` as on `sales_assist`. Gating it on the rung would switch off a
 * safety net by choosing a lower level of ambition, which is the opposite of
 * what a lower rung should mean.
 */
export function salesAssistApplies(rung: EngagementRung | undefined): boolean {
  return rung === 'sales_assist';
}
