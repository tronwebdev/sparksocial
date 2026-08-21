/**
 * Mirrors `packages/generate/src/draft.ts`'s `ResolvedBeat` — apps/web cannot
 * import that package (CLAUDE.md: only `@sparksocial/shared` from `packages/`),
 * so the wire shape is retyped here, the same way `CalendarBoard.tsx` retypes
 * its own `Slot`/`CalendarView`.
 */
export type ResolvedBeat =
  | { kind: 'asset'; beatId: string; assetId: string; role: string; caption: string | null }
  | { kind: 'text'; beatId: string; text: string }
  | { kind: 'generated_image'; beatId: string; url: string; prompt: string }
  | { kind: 'generated_video'; beatId: string; url: string; script: string }
  | { kind: 'generated_audio'; beatId: string; url: string; script: string }
  /** `content.generate_broll` — generative b-roll from a prompt, no likeness. */
  | { kind: 'generated_broll'; beatId: string; url: string; prompt: string }
  /** `content.generate_dub` — an existing beat's media re-voiced into `targetLanguage`, replacing it in place. */
  | { kind: 'dubbed_media'; beatId: string; url: string; targetLanguage: string; mediaType: 'video' | 'audio' };

/** Beat kinds that carry a real, playable media URL — the ones a "Dub" action can take as its source. */
export const DUBBABLE_BEAT_KINDS = ['generated_video', 'generated_audio', 'generated_broll', 'dubbed_media'] as const;

export interface DraftView {
  contentItemId: string;
  playbookId: string;
  mode: string;
  mediaType: 'video' | 'image' | 'carousel' | 'text';
  beats: ResolvedBeat[];
  status?: string;
  /** The publish receipt — present once `status` is 'published' or 'rolled_back'. */
  platform?: string;
  externalId?: string;
  via?: string;
  url?: string;
  /** Why this item is not moving — set when `status` is 'blocked' or 'needs_review'. */
  blockedReason?: string;
  /** PRD §10's retry flow. 0 when nothing has been tried; see `content.get`'s own comment. */
  publishAttempts?: number;
  lastPublishError?: string;
}

export interface RankedPlaybook {
  playbook_id: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
  content_pillar: string;
  score: number;
  unlockable: boolean;
  missing_roles: string[];
  /** `'upload'` — a file the owner supplies. `'capture'` — the WhatsApp capture loop. */
  unlocked_by?: 'upload' | 'capture';
}

/** `playbook.list`'s real output shape (`packages/playbooks/src/browse.ts`'s `PlaybookSummary`) — camelCase, distinct from `RankedPlaybook`'s snake_case (`playbook.resolve`'s shape). Do not conflate the two. */
export interface PlaybookSummary {
  playbookId: string;
  name: string;
  mode: 'synthesize' | 'assemble' | 'direct_finish';
}

/** PRD/plan's fixed platform set — `@sparksocial/publish`'s `Platform` enum, retyped for the same reason as `ResolvedBeat`. */
export const PLATFORMS = ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const;
