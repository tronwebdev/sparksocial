import type { ResolvedBeat } from '../../src/draft.js';

/**
 * A drafted `pb_talking_head_hot_take`, as `content.draft` would have written it
 * since the draft owns its structure: both beats carry their own duration and
 * label. 23 seconds in a 15–30s band.
 */
export function contentDraftFixtureBeats(): ResolvedBeat[] {
  return [
    { kind: 'text', beatId: 'take', text: 'The take.', durationSec: 20, label: 'Talking head' },
    { kind: 'text', beatId: 'cta', text: 'Book now.', durationSec: 3, label: 'CTA' },
  ];
}
