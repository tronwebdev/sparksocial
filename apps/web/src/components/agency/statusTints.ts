/**
 * THE AGENCY SURFACES' STATUS TINTS, in one place.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Four files painted the same chips from their own copies of the same values.
 * Three of the tints matched byte for byte across all of them — `#D8F5E6`,
 * `#E4EEFB`, `#EFEFEF` — and the red did not:
 *
 *   * `LeadModals` used `#FBD9D9` for its "bad" tone,
 *   * `ProposalModal` used `#FBE4E4` for `declined`,
 *
 * both over the same `#A32626`. Two near-identical pale reds for the same
 * meaning, in two files of the same feature, which is what copied constants
 * do: they agree until one of them is edited.
 *
 * `#FBE4E4` is the one kept. Neither is in a prototype — the agency screens'
 * lead and proposal states are not drawn — but the sibling tints all sit
 * around 228 on their lightest channel (`#D8F5E6`, `#E4EEFB`) and `#FBE4E4`
 * does too, where `#FBD9D9` is a step more saturated than the family.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * Not the Failed chip. `SparkSocial Automation.dc.html` draws that as
 * `#FDECEC` with a `#F35525` ring *and* `#F35525` text, and these are not it:
 * a declined proposal and a lost lead are ordinary outcomes of a sales
 * process, not errors. `STATUS_TINT` in `AgencyClientFinder` already makes
 * that argument about `lost` being grey rather than red, and `PlanQueue`'s
 * `failed` chip is the one that should match the design's.
 *
 * ── `contacted` is the one the design does draw ──────────────────────────
 *
 * `#DCF6E3` over `#26A344`, measured from the Agency Portal prototype's own
 * chip. It is here rather than inlined so it cannot drift from the file that
 * proves it.
 */

export interface StatusTint {
  background: string;
  color: string;
}

export const TINT = {
  /** Something has gone well and is finished: won, accepted. */
  good: { background: '#D8F5E6', color: '#1F7A46' },
  /** In flight, awaiting someone: sent, new. */
  info: { background: '#E4EEFB', color: '#2B5EA7' },
  /** Needs a look but is not wrong. */
  warn: { background: '#FBE4C2', color: '#8A5A12' },
  /** Did not happen. An outcome, not an error — see the note above. */
  bad: { background: '#FBE4E4', color: '#A32626' },
  /** Nothing has happened yet: draft. */
  neutral: { background: '#EFEFEF', color: 'rgb(91,91,91)' },
  /** Deliberately set aside: withdrawn. Quieter than `neutral`. */
  muted: { background: '#EFEFEF', color: '#8A8A8A' },
  /** Mid-pipeline, between `info` and `good`. */
  progress: { background: '#E6E0FB', color: '#6C4BE0' },
  /** The Agency Portal prototype's own chip, measured. */
  contacted: { background: '#DCF6E3', color: '#26A344' },
} as const satisfies Record<string, StatusTint>;
