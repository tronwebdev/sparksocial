'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { BeatRow } from './BeatRow';
import { PLATFORMS, type DraftView, type PlaybookSummary, type RankedPlaybook, type ResolvedBeat } from './types';

/**
 * The Draft Panel — plan §6.8's Draft Panel, `ui build/figma-dp/`'s ~20
 * `DraftPannel*` mockups. Those files are 20 separate, hand-fixed Figma
 * exports (one per phase × format combination — trigger, editor, generating,
 * preview, crossed with text/image/video/carousel), not literally one
 * parametric component; this rebuilds the *idea* they share — one panel, one
 * `phase` state, branching on the draft's real `mediaType` — as an actual
 * parametric component, the way the mockups' own naming implies they should
 * have been. Pixel fidelity traded for real data, same call every other P3
 * screen this session made.
 *
 * Four phases:
 * - **trigger** — no draft yet: pick a playbook, say what it's about, call
 *   `content.draft`.
 * - **editor** — the drafted copy, editable per beat, with per-beat
 *   media-generation actions (`BeatRow`).
 * - **generating** — not a separate screen here, a per-beat busy state; see
 *   `BeatRow`'s comment on why one row style covers image/avatar/voiceover.
 * - **preview** — the assembled post, a platform picker, and `publish.now` —
 *   real, since P4's aggregator publishing already exists.
 */

export function DraftPanel({
  genomeId,
  contentItemId: initialContentItemId,
  open,
  onClose,
  onDraftCreated,
}: {
  genomeId: string | undefined;
  contentItemId?: string;
  open: boolean;
  onClose: () => void;
  /** Fires once, right after `content.draft` first creates a row — CAL-04's hook for pinning a fresh trigger-phase draft to the date the caller opened this panel for. */
  onDraftCreated?: (contentItemId: string) => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'trigger' | 'editor' | 'preview'>(
    initialContentItemId ? 'loading' : 'trigger',
  );
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [playbooks, setPlaybooks] = useState<RankedPlaybook[] | null>(null);
  const [playbooksWhy, setPlaybooksWhy] = useState<string | null>(null);
  // Distinguishes "nothing fits this genome at all" from "something fits, but
  // only a direct_finish format" — the resolver found a real format either
  // way, and telling the second case apart matters because its fix is "ask
  // SPARK to start a capture session," not "add assets."
  const [captureOnly, setCaptureOnly] = useState(false);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>('instagram');
  const [busyBeatId, setBusyBeatId] = useState<string | null>(null);
  const [beatErrors, setBeatErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [shortening, setShortening] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [renders, setRenders] = useState<Array<{ aspect: string; url: string; beatId?: string }> | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [variants, setVariants] = useState<Array<{ beats: ResolvedBeat[] }> | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [applyingVariant, setApplyingVariant] = useState<number | null>(null);
  const [repurposeOpen, setRepurposeOpen] = useState(false);
  const [repurposePlaybooks, setRepurposePlaybooks] = useState<PlaybookSummary[] | null>(null);
  const [repurposing, setRepurposing] = useState(false);
  const [repurposeError, setRepurposeError] = useState<string | null>(null);
  const [repurposeResult, setRepurposeResult] = useState<string | null>(null);
  const [explainOpenId, setExplainOpenId] = useState<string | null>(null);
  const [explainSummary, setExplainSummary] = useState<Record<string, string>>({});
  const [explainLoading, setExplainLoading] = useState<string | null>(null);
  const [staticRendering, setStaticRendering] = useState(false);
  const [staticRenderError, setStaticRenderError] = useState<string | null>(null);
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null);
  const [fanoutOpen, setFanoutOpen] = useState(false);
  const [brandTemplateId, setBrandTemplateId] = useState('');
  const [fanoutData, setFanoutData] = useState('');
  const [fanoutBusy, setFanoutBusy] = useState(false);
  const [fanoutError, setFanoutError] = useState<string | null>(null);
  const [fanoutResult, setFanoutResult] = useState<{ editUrl?: string; renders: { format: string; url: string }[] } | null>(null);

  const loadDraft = useCallback(
    async (contentItemId: string) => {
      if (!genomeId) return;
      setPhase('loading');
      const res = await invoke<DraftView>('content.get', { contentItemId, genomeId });
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }

      // `calendar.generate` writes slots with a playbook assigned but no
      // copy yet — content.get's own comment calls an empty beat list "the
      // honest answer, not a parse error." Opening one is the natural place
      // to actually fill it, rather than showing an editor with nothing in
      // it and no way to fix that. direct_finish is the one exception:
      // those are filmed via the capture loop, and content.draft refuses
      // them outright ("use direct.brief.generate").
      if (res.output.beats.length === 0 && res.output.mode !== 'direct_finish') {
        const filled = await invoke<DraftView>(
          'content.draft',
          { genomeId, playbookId: res.output.playbookId, contentItemId, intent: '' },
          crypto.randomUUID(),
        );
        if (filled.status !== 'succeeded') {
          setError(filled.status === 'failed' ? filled.error.message : 'That draft was gated.');
          return;
        }
        setDraft(filled.output);
        setPhase('editor');
        return;
      }

      setDraft(res.output);
      setPhase('editor');
    },
    [genomeId],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBeatErrors({});
    setLinkUrl('');
    setShortUrl(null);
    setLinkError(null);
    setRenders(null);
    setRenderError(null);
    setRollbackError(null);
    if (initialContentItemId) {
      void loadDraft(initialContentItemId);
    } else {
      setPhase('trigger');
      setDraft(null);
      setSelectedPlaybookId(null);
      setIntent('');
    }
    // Only re-run when the panel opens or is pointed at a different draft —
    // `loadDraft`'s identity changes with `genomeId`, which must not itself
    // reset an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialContentItemId]);

  useEffect(() => {
    if (!open || phase !== 'trigger' || !genomeId || playbooks !== null) return;
    void (async () => {
      const res = await invoke<{ ranked: RankedPlaybook[]; why: { summary: string } }>('playbook.resolve', { genomeId });
      if (res.status !== 'succeeded') {
        setPlaybooks([]);
        return;
      }
      // `direct_finish` playbooks go through WhatsApp capture (§6.3), never this
      // panel — filtered here, not upstream, because `playbook.resolve`'s ranking
      // is shared with the calendar and capture-gap surfaces, which do need them.
      const usable = res.output.ranked.filter((p) => p.mode !== 'direct_finish');
      setPlaybooks(usable);
      // Only worth showing once the filter leaves nothing to pick — the resolver's
      // own `why` already names exactly what a fresh, asset-less genome is missing
      // (CLAUDE.md invariant 4), so surface that instead of a silent empty gap.
      if (usable.length === 0) {
        setPlaybooksWhy(res.output.why.summary);
        // The resolver found real formats, just none this dialog can drive —
        // "add assets" would be wrong advice here, since assets are not what's
        // missing. Distinguishes that from a genuinely empty resolution (e.g.
        // onboarding's routing questions aren't answered yet), where they are.
        setCaptureOnly(res.output.ranked.length > 0);
      }
    })();
  }, [open, phase, genomeId, playbooks]);

  async function createDraft() {
    if (!genomeId || !selectedPlaybookId || busy) return;
    setBusy(true);
    setError(null);
    // `content.draft` is deliberately `idempotent: false` — a second call is
    // a second take, not a safe replay of the first — so it requires a key,
    // and it must be fresh per click: reusing one across clicks would make
    // "Generate post" silently return the same draft forever after the first.
    const res = await invoke<DraftView>(
      'content.draft',
      { genomeId, playbookId: selectedPlaybookId, intent },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That draft was gated.');
      return;
    }
    setDraft(res.output);
    setPhase('editor');
    onDraftCreated?.(res.output.contentItemId);
  }

  const replaceBeat = useCallback((beatId: string, next: ResolvedBeat) => {
    setDraft((d) => (d ? { ...d, beats: d.beats.map((b) => (b.beatId === beatId ? next : b)) } : d));
  }, []);

  async function generateImage(beatId: string, prompt: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    // idempotent: false — regenerating a beat's image is the point of the
    // button, so each click needs its own key or every click after the first
    // would silently return the first image again.
    const res = await invoke<{ url: string }>(
      'content.generate_image',
      {
        contentItemId: draft.contentItemId,
        genomeId,
        beatId,
        prompt,
        aspectRatio: draft.mediaType === 'carousel' ? '4:5' : '1:1',
      },
      crypto.randomUUID(),
    );
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'generated_image', beatId, url: res.output.url, prompt });
  }

  async function generateAvatarVideo(beatId: string, script: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    // idempotent: false — same reasoning as generateImage above.
    const res = await invoke<{ url: string }>(
      'content.generate_avatar_video',
      {
        contentItemId: draft.contentItemId,
        genomeId,
        beatId,
        script,
        aspectRatio: '9:16',
      },
      crypto.randomUUID(),
    );
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'generated_video', beatId, url: res.output.url, script });
  }

  async function generateVoiceover(beatId: string, script: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    // idempotent: false — same reasoning as generateImage above.
    const res = await invoke<{ url: string }>(
      'content.generate_voiceover',
      {
        contentItemId: draft.contentItemId,
        genomeId,
        beatId,
        script,
        useClonedVoice: false,
      },
      crypto.randomUUID(),
    );
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'generated_audio', beatId, url: res.output.url, script });
  }

  // `content.beat.update` — a plain edit, not a regeneration: idempotent, so
  // no fresh key needed the way the generate_*/draft calls above require.
  // Without this, hand-editing a hook or CTA updated only BeatRow's own
  // local state and was silently gone the moment the panel closed.
  async function generateBroll(beatId: string, prompt: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    // idempotent: false — same reasoning as generateImage above.
    const res = await invoke<{ url: string }>(
      'content.generate_broll',
      {
        contentItemId: draft.contentItemId,
        genomeId,
        beatId,
        prompt,
        aspectRatio: '9:16',
      },
      crypto.randomUUID(),
    );
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'generated_broll', beatId, url: res.output.url, prompt });
  }

  async function dubBeat(beatId: string, sourceUrl: string, mediaKind: 'video' | 'audio', targetLanguage: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    // idempotent: false — a re-dub is a new generation, same reasoning as every other generate_* call above.
    const res = await invoke<{ url: string }>(
      'content.generate_dub',
      {
        contentItemId: draft.contentItemId,
        genomeId,
        beatId,
        sourceUrl,
        mediaType: mediaKind,
        targetLanguage,
      },
      crypto.randomUUID(),
    );
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'dubbed_media', beatId, url: res.output.url, targetLanguage, mediaType: mediaKind });
  }

  async function saveBeatText(beatId: string, text: string) {
    if (!draft || !genomeId || busyBeatId) return;
    setBusyBeatId(beatId);
    setBeatErrors((e) => ({ ...e, [beatId]: '' }));
    const res = await invoke<{ beats: ResolvedBeat[] }>('content.beat.update', {
      contentItemId: draft.contentItemId,
      genomeId,
      beatId,
      text,
    });
    setBusyBeatId(null);
    if (res.status !== 'succeeded') {
      setBeatErrors((e) => ({ ...e, [beatId]: res.status === 'failed' ? res.error.message : 'Gated.' }));
      return;
    }
    replaceBeat(beatId, { kind: 'text', beatId, text });
  }

  async function shortenLink() {
    if (!genomeId || !linkUrl.trim() || shortening) return;
    setShortening(true);
    setLinkError(null);
    const res = await invoke<{ shortUrl: string; destinationUrl: string }>('link.shorten', {
      genomeId,
      url: linkUrl.trim(),
    });
    setShortening(false);
    if (res.status !== 'succeeded') {
      setLinkError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setShortUrl(res.output.shortUrl);
  }

  async function renderCompose() {
    if (!draft || !genomeId || rendering) return;
    setRendering(true);
    setRenderError(null);
    // idempotent: false — "a re-render is a new render... not a safe replay"
    // (compose/tool.ts), same reasoning as content.draft above.
    const res = await invoke<{ renders: Array<{ aspect: string; url: string; beatId?: string }> }>(
      'compose.render',
      { genomeId, contentItemId: draft.contentItemId },
      crypto.randomUUID(),
    );
    setRendering(false);
    if (res.status !== 'succeeded') {
      setRenderError(res.status === 'failed' ? res.error.message : 'Rendering was gated.');
      return;
    }
    setRenders(res.output.renders);
  }

  async function loadVariants() {
    if (!draft || !genomeId || variantsLoading) return;
    setVariantsLoading(true);
    setVariantsError(null);
    // read/idempotent — a preview, safe to call with no idempotency key and
    // to re-call for a fresh set of takes.
    const res = await invoke<{ variants: Array<{ beats: ResolvedBeat[] }> }>('draft.variants', {
      genomeId,
      contentItemId: draft.contentItemId,
    });
    setVariantsLoading(false);
    if (res.status !== 'succeeded') {
      setVariantsError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setVariants(res.output.variants);
  }

  async function applyVariant(index: number, beats: ResolvedBeat[]) {
    if (!draft || !genomeId || applyingVariant !== null) return;
    setApplyingVariant(index);
    // `draft.variants` only varies written copy — asset/generated beats are
    // resolved identically across takes (same doc comment: "same assets,
    // different copy") — so applying a variant means saving each of its
    // text-kind beats, not replacing the whole beat list.
    for (const beat of beats) {
      if (beat.kind !== 'text') continue;
      await invoke('content.beat.update', { contentItemId: draft.contentItemId, genomeId, beatId: beat.beatId, text: beat.text });
      replaceBeat(beat.beatId, { kind: 'text', beatId: beat.beatId, text: beat.text });
    }
    setApplyingVariant(null);
    setVariants(null);
  }

  useEffect(() => {
    if (!repurposeOpen || !genomeId || repurposePlaybooks !== null) return;
    void (async () => {
      const res = await invoke<{ playbooks: PlaybookSummary[] }>('playbook.list', { activeOnly: true });
      if (res.status !== 'succeeded') {
        setRepurposePlaybooks([]);
        return;
      }
      setRepurposePlaybooks(res.output.playbooks.filter((p) => p.mode !== 'direct_finish'));
    })();
  }, [repurposeOpen, genomeId, repurposePlaybooks]);

  useEffect(() => {
    if (!open || !genomeId || canvaConnected !== null) return;
    void (async () => {
      const res = await invoke<{ connected: boolean }>('brand.oauth.status', { genomeId, provider: 'canva' });
      setCanvaConnected(res.status === 'succeeded' ? res.output.connected : false);
    })();
  }, [open, genomeId, canvaConnected]);

  async function repurposeAs(targetPlaybookId: string) {
    if (!draft || !genomeId || repurposing) return;
    setRepurposing(true);
    setRepurposeError(null);
    // idempotent: false — creates a genuinely new draft each call, same reasoning content.draft gives.
    const res = await invoke<{ contentItemId: string; playbookId: string }>(
      'draft.repurpose',
      { genomeId, sourceContentItemId: draft.contentItemId, targetPlaybookId },
      crypto.randomUUID(),
    );
    setRepurposing(false);
    if (res.status !== 'succeeded') {
      setRepurposeError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setRepurposeOpen(false);
    setRepurposeResult(`Created as a new draft (${res.output.playbookId}) — the source is untouched. Find it in Drafts.`);
  }

  async function explainPlaybook(playbookId: string) {
    if (explainOpenId === playbookId) {
      setExplainOpenId(null);
      return;
    }
    setExplainOpenId(playbookId);
    if (!genomeId || explainSummary[playbookId]) return; // cached
    setExplainLoading(playbookId);
    const res = await invoke<{ why: { summary: string } }>('playbook.explain', { genomeId, playbookId });
    setExplainLoading(null);
    if (res.status === 'succeeded') {
      setExplainSummary((s) => ({ ...s, [playbookId]: res.output.why.summary }));
    } else {
      setExplainSummary((s) => ({ ...s, [playbookId]: res.status === 'failed' ? res.error.message : 'That request was gated.' }));
    }
  }

  async function renderStatic() {
    if (!draft || !genomeId || staticRendering) return;
    setStaticRendering(true);
    setStaticRenderError(null);
    // idempotent: false — same reasoning as renderCompose above.
    const res = await invoke<{ renders: Array<{ aspect: string; url: string; beatId?: string }> }>(
      'compose.static',
      { genomeId, contentItemId: draft.contentItemId },
      crypto.randomUUID(),
    );
    setStaticRendering(false);
    if (res.status !== 'succeeded') {
      setStaticRenderError(res.status === 'failed' ? res.error.message : 'Rendering was gated.');
      return;
    }
    setRenders(res.output.renders);
  }

  /**
   * `compose.fanout`'s `data` keys are the Canva Brand Template's own field
   * names — there is no tool to introspect a template's fields, so this
   * can't offer a real per-field picker the way the beat editor does for
   * everything else. Defaulting the JSON to the draft's own text beats
   * (keyed by beatId) gives a real starting point to edit into the
   * template's actual field names, rather than an empty box with no clue
   * what shape is expected.
   */
  function defaultFanoutData(): string {
    if (!draft) return '{}';
    const data: Record<string, { type: 'text'; text: string }> = {};
    for (const beat of draft.beats) {
      if (beat.kind === 'text') data[beat.beatId] = { type: 'text', text: beat.text };
    }
    return JSON.stringify(data, null, 2);
  }

  async function fanout() {
    if (!draft || !genomeId || fanoutBusy || !brandTemplateId.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(fanoutData);
    } catch {
      setFanoutError('That field data isn’t valid JSON.');
      return;
    }
    setFanoutBusy(true);
    setFanoutError(null);
    setFanoutResult(null);
    // idempotent: false — an Autofill+Export job runs fresh each call.
    const res = await invoke<{ editUrl?: string; renders: { format: string; url: string }[] }>(
      'compose.fanout',
      { genomeId, contentItemId: draft.contentItemId, brandTemplateId: brandTemplateId.trim(), data, formats: ['png'] },
      crypto.randomUUID(),
    );
    setFanoutBusy(false);
    if (res.status !== 'succeeded') {
      setFanoutError(res.status === 'failed' ? res.error.message : 'Fanning out was gated.');
      return;
    }
    setFanoutResult(res.output);
  }

  async function publishNow() {
    if (!draft || !genomeId || busy) return;
    setBusy(true);
    setError(null);
    const text = [
      draft.beats
        .map((b) => (b.kind === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n\n'),
      shortUrl,
    ]
      .filter(Boolean)
      .join('\n\n');
    const referencedAssetIds = draft.beats.filter((b) => b.kind === 'asset').map((b) => b.assetId);
    // A real `compose.render` output — one composed file per aspect ratio —
    // is what should actually publish for anything with pixels. Falling back
    // to raw per-beat generated URLs is only correct for a single-beat post
    // (one generated image/video *is* the whole thing); a multi-beat video
    // or carousel published from unrendered beats would post disconnected
    // clips instead of the one thing SPARK assembled.
    const mediaUrls =
      renders && renders.length > 0
        ? renders.map((r) => r.url)
        : draft.beats
            .filter(
              (
                b,
              ): b is Extract<
                ResolvedBeat,
                { kind: 'generated_image' | 'generated_video' | 'generated_audio' | 'generated_broll' | 'dubbed_media' }
              > =>
                b.kind === 'generated_image' ||
                b.kind === 'generated_video' ||
                b.kind === 'generated_audio' ||
                b.kind === 'generated_broll' ||
                b.kind === 'dubbed_media',
            )
            .map((b) => b.url);

    const res = await invoke(
      'publish.now',
      { contentItemId: draft.contentItemId, genomeId, playbookId: draft.playbookId, platform, text, referencedAssetIds, mediaUrls },
      `publish:${draft.contentItemId}:${platform}`,
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Publishing was held for review — check the queue.');
      return;
    }
    onClose();
  }

  async function rollbackPost() {
    if (!draft || !genomeId || rollingBack) return;
    if (!window.confirm('Delete this post from the platform? This cannot be undone.')) return;
    setRollingBack(true);
    setRollbackError(null);
    // idempotent: false — a retried rollback must not be treated as a safe
    // replay once the post is already down, so it needs a fresh key too.
    const res = await invoke<{ platform: string; rolledBackAt: string }>(
      'publish.rollback',
      { contentItemId: draft.contentItemId, genomeId },
      crypto.randomUUID(),
    );
    setRollingBack(false);
    if (res.status !== 'succeeded') {
      setRollbackError(res.status === 'failed' ? res.error.message : 'Rollback was held for review.');
      return;
    }
    setDraft((d) => (d ? { ...d, status: 'rolled_back' } : d));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-label="Draft">
      <div className="flex max-h-[85vh] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-[16px] font-semibold text-ink">
            {phase === 'trigger' ? 'New post' : phase === 'preview' ? 'Review your post' : draft?.playbookId ?? 'Draft'}
          </h2>
          <button type="button" onClick={onClose} className="text-[14px] text-ink-muted hover:text-ink">
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'loading' ? <Skeleton className="h-64 w-full rounded" /> : null}

          {phase === 'trigger' ? (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-[13px] font-medium text-ink-muted" htmlFor="dp-intent">
                  What is this post about?
                </label>
                <textarea
                  id="dp-intent"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-ink placeholder:text-ink-placeholder focus:outline-none focus:ring-[1.5px] focus:ring-ring"
                />
              </div>

              <div>
                <p className="text-[13px] font-medium text-ink-muted">Post type</p>
                {playbooks === null ? (
                  <Skeleton className="mt-2 h-10 w-full rounded" />
                ) : playbooks.length === 0 ? (
                  <div className="mt-2 rounded-lg border border-border bg-surface-muted p-3">
                    <p className="text-[13px] text-ink">
                      {playbooksWhy ?? "Nothing is ready to post yet — this brand's Asset Graph is empty."}
                    </p>
                    <p className="mt-1 text-[12.5px] text-ink-muted">
                      {captureOnly
                        ? "Those formats need filming first — ask SPARK to start this week's capture session " +
                          '(Ask Spark, top right), or add existing photos/screenshots in the Assets Library to ' +
                          'unlock a format postable straight from here.'
                        : "Add assets in the Assets Library, or fill in more of your brand's onboarding answers, " +
                          'then come back here.'}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {playbooks.map((pb) => (
                      <button
                        key={pb.playbook_id}
                        type="button"
                        onClick={() => setSelectedPlaybookId(pb.playbook_id)}
                        className={`rounded-full border px-3 py-1.5 text-[13px] ${
                          selectedPlaybookId === pb.playbook_id
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-ink hover:bg-surface-muted'
                        }`}
                      >
                        {pb.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

              <Button disabled={!selectedPlaybookId || busy} onClick={() => void createDraft()}>
                {busy ? 'Generating…' : 'Generate post'}
              </Button>
            </div>
          ) : null}

          {phase === 'editor' && draft && draft.status === 'published' ? (
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3">
              <p className="text-[13px] text-ink">
                Live on <span className="font-medium capitalize">{draft.platform?.replace('_', ' ')}</span>
                {draft.via ? <span className="text-ink-muted"> via {draft.via}</span> : null}
                {draft.url ? (
                  <>
                    {' — '}
                    <a href={draft.url} target="_blank" rel="noreferrer" className="text-brand-purple hover:underline">
                      view post
                    </a>
                  </>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                {rollbackError ? <p className="text-[12px] text-destructive">{rollbackError}</p> : null}
                <Button size="sm" variant="outline" disabled={rollingBack} onClick={() => void rollbackPost()}>
                  {rollingBack ? 'Rolling back…' : 'Roll back'}
                </Button>
              </div>
            </div>
          ) : null}

          {phase === 'editor' && draft && draft.status === 'rolled_back' ? (
            <div className="mb-1 rounded-lg border border-border bg-surface-muted px-4 py-3">
              <p className="text-[13px] text-ink-muted">
                Rolled back — no longer live on <span className="capitalize">{draft.platform?.replace('_', ' ')}</span>.
              </p>
            </div>
          ) : null}

          {phase === 'editor' && draft ? (
            <div className="grid grid-cols-1 gap-4">
              <ul className="grid grid-cols-1 gap-3">
                {draft.beats.map((beat) => (
                  <BeatRow
                    // `BeatRow`'s own textarea state initializes once from
                    // `beat` on mount and never re-syncs on a prop change —
                    // React doesn't re-run a `useState` initializer. A key
                    // that changes whenever the beat's *generated content*
                    // changes (not on every keystroke, since typing never
                    // touches `beat` until Save/regenerate) forces a remount
                    // exactly when the textarea needs to pick up the fresh
                    // value — found live: applying a `draft.variants` take
                    // updated the draft and the backend correctly but left
                    // the visible textarea showing the old copy, which a
                    // stray "Save" click would have silently reverted.
                    key={`${beat.beatId}:${beat.kind}:${'url' in beat ? beat.url : ''}:${beat.kind === 'text' ? beat.text : ''}`}
                    beat={beat}
                    mediaType={draft.mediaType}
                    busy={busyBeatId === beat.beatId}
                    error={beatErrors[beat.beatId] || undefined}
                    onGenerateImage={(id, prompt) => void generateImage(id, prompt)}
                    onGenerateAvatarVideo={(id, script) => void generateAvatarVideo(id, script)}
                    onGenerateVoiceover={(id, script) => void generateVoiceover(id, script)}
                    onGenerateBroll={(id, prompt) => void generateBroll(id, prompt)}
                    onDub={(id, sourceUrl, mediaKind, lang) => void dubBeat(id, sourceUrl, mediaKind, lang)}
                    onSaveText={(id, text) => void saveBeatText(id, text)}
                  />
                ))}
              </ul>

              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Not sure this is the best take?</p>
                    <p className="text-[12px] text-ink-muted">Preview a couple of alternative takes on the written copy — nothing is saved until you pick one.</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={variantsLoading} onClick={() => void loadVariants()}>
                    {variantsLoading ? 'Generating…' : 'See variants'}
                  </Button>
                </div>
                {variantsError ? <p className="mt-2 text-[12px] text-destructive">{variantsError}</p> : null}
                {variants && variants.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-1 gap-2">
                    {variants.map((v, i) => (
                      <li key={i} className="rounded border border-border p-3">
                        <p className="whitespace-pre-wrap text-[13px] text-ink">
                          {v.beats
                            .filter((b): b is Extract<ResolvedBeat, { kind: 'text' }> => b.kind === 'text')
                            .map((b) => b.text)
                            .join('\n\n') || '(no written copy in this take)'}
                        </p>
                        <Button
                          size="sm"
                          className="mt-2"
                          disabled={applyingVariant !== null}
                          onClick={() => void applyVariant(i, v.beats)}
                        >
                          {applyingVariant === i ? 'Applying…' : 'Use this'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Want this as a different format?</p>
                    <p className="text-[12px] text-ink-muted">Repurpose this post's topic into another playbook — creates a new draft, this one stays as-is.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setRepurposeOpen((v) => !v)}>
                    {repurposeOpen ? 'Cancel' : 'Repurpose'}
                  </Button>
                </div>
                {repurposeOpen ? (
                  repurposePlaybooks === null ? (
                    <Skeleton className="mt-3 h-10 w-full rounded" />
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {repurposePlaybooks
                        .filter((p) => p.playbookId !== draft.playbookId)
                        .map((p) => (
                          <div key={p.playbookId} className="inline-flex items-center gap-1 rounded-full border border-border pr-1">
                            <button
                              type="button"
                              disabled={repurposing}
                              onClick={() => void repurposeAs(p.playbookId)}
                              className="rounded-full px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted disabled:opacity-50"
                            >
                              {repurposing ? 'Working…' : p.name}
                            </button>
                            <button
                              type="button"
                              title="Why — is this producible for this brand right now?"
                              onClick={() => void explainPlaybook(p.playbookId)}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                            >
                              ⓘ
                            </button>
                          </div>
                        ))}
                    </div>
                  )
                ) : null}
                {explainOpenId ? (
                  <p className="mt-2 text-[12px] text-ink-muted">
                    {explainLoading === explainOpenId ? 'Working it out…' : explainSummary[explainOpenId]}
                  </p>
                ) : null}
                {repurposeError ? <p className="mt-2 text-[12px] text-destructive">{repurposeError}</p> : null}
                {repurposeResult ? <p className="mt-2 text-[12px] text-success">{repurposeResult}</p> : null}
              </div>

              {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            </div>
          ) : null}

          {phase === 'preview' && draft ? (
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-lg border border-border p-4">
                <p className="whitespace-pre-wrap text-[14px] text-ink">
                  {[
                    draft.beats
                      .map((b) => (b.kind === 'text' ? b.text : ''))
                      .filter(Boolean)
                      .join('\n\n'),
                    shortUrl,
                  ]
                    .filter(Boolean)
                    .join('\n\n') || '(no written copy)'}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {draft.beats
                    .filter(
                      (b) =>
                        b.kind === 'generated_image' ||
                        b.kind === 'generated_video' ||
                        b.kind === 'generated_audio' ||
                        b.kind === 'generated_broll' ||
                        b.kind === 'dubbed_media',
                    )
                    .map((b) =>
                      b.kind === 'generated_image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={b.beatId} src={b.url} alt={b.prompt} className="max-h-64 rounded object-contain" />
                      ) : b.kind === 'generated_video' || b.kind === 'generated_broll' ? (
                        <video key={b.beatId} src={b.url} controls className="max-h-64 rounded" />
                      ) : b.kind === 'dubbed_media' ? (
                        b.mediaType === 'video' ? (
                          <video key={b.beatId} src={b.url} controls className="max-h-64 rounded" />
                        ) : (
                          <audio key={b.beatId} src={b.url} controls className="w-full" />
                        )
                      ) : (
                        <audio key={b.beatId} src={b.url} controls className="w-full" />
                      ),
                    )}
                </div>
              </div>

              {draft.mediaType !== 'text' ? (
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-ink-muted">
                      {draft.mediaType === 'video' ? 'Composed video' : draft.mediaType === 'carousel' ? 'Carousel slides' : 'Composed image'}
                    </p>
                    <div className="flex gap-2">
                      {draft.mediaType === 'image' || draft.mediaType === 'carousel' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={staticRendering}
                          title="Satori — no browser render, faster and cheaper for static formats"
                          onClick={() => void renderStatic()}
                        >
                          {staticRendering ? 'Rendering…' : 'Fast render'}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" disabled={rendering} onClick={() => void renderCompose()}>
                        {rendering ? 'Rendering…' : renders ? 'Re-render' : 'Render'}
                      </Button>
                      {canvaConnected ? (
                        <Button
                          size="sm"
                          variant="outline"
                          title="compose.fanout — autofill a Canva Brand Template and export it"
                          onClick={() => {
                            if (!fanoutOpen) setFanoutData(defaultFanoutData());
                            setFanoutOpen((v) => !v);
                          }}
                        >
                          {fanoutOpen ? 'Cancel fan out' : 'Fan out via Canva'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {staticRenderError ? <p className="mt-1 text-[12px] text-destructive">{staticRenderError}</p> : null}

                  {fanoutOpen ? (
                    <div className="mt-2 rounded-lg border border-border p-3">
                      <label className="text-[12px] font-medium text-ink-muted" htmlFor="dp-brand-template-id">
                        Canva Brand Template ID
                      </label>
                      <input
                        id="dp-brand-template-id"
                        value={brandTemplateId}
                        onChange={(e) => setBrandTemplateId(e.target.value)}
                        placeholder="from the template's Canva URL"
                        className="mt-1 h-9 w-full rounded border border-border bg-input px-2 text-[13px] text-ink placeholder:text-ink-placeholder"
                      />
                      <label className="mt-2 block text-[12px] font-medium text-ink-muted" htmlFor="dp-fanout-data">
                        Field data (JSON — edit the keys to match the template's own field names)
                      </label>
                      <textarea
                        id="dp-fanout-data"
                        value={fanoutData}
                        onChange={(e) => setFanoutData(e.target.value)}
                        rows={5}
                        className="mt-1 w-full resize-y rounded border border-border bg-input px-2 py-1.5 font-mono text-[12px] text-ink"
                      />
                      <Button size="sm" className="mt-2" disabled={fanoutBusy || !brandTemplateId.trim()} onClick={() => void fanout()}>
                        {fanoutBusy ? 'Fanning out…' : 'Fan out'}
                      </Button>
                      {fanoutError ? <p className="mt-1 text-[12px] text-destructive">{fanoutError}</p> : null}
                      {fanoutResult ? (
                        <div className="mt-2">
                          {fanoutResult.editUrl ? (
                            <a href={fanoutResult.editUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-purple underline">
                              Edit in Canva
                            </a>
                          ) : null}
                          <div className="mt-1 grid grid-cols-1 gap-2">
                            {fanoutResult.renders.map((r) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={r.url} src={r.url} alt={`${r.format} export`} className="max-h-64 rounded object-contain" />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {renders ? (
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {renders.map((r, i) =>
                        draft.mediaType === 'video' ? (
                          <video key={`${r.aspect}-${i}`} src={r.url} controls className="max-h-64 rounded" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={`${r.aspect}-${i}`} src={r.url} alt={`${r.aspect} render`} className="max-h-64 rounded object-contain" />
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-[12px] text-ink-muted">
                      Not rendered yet — publishing before rendering sends the raw generated clips, not one assembled {draft.mediaType}.
                    </p>
                  )}
                  {renderError ? <p className="mt-1 text-[12px] text-destructive">{renderError}</p> : null}
                </div>
              ) : null}

              <div>
                <p className="text-[13px] font-medium text-ink-muted">Add a tracked link</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://your-site.com/offer"
                    disabled={shortening || !!shortUrl}
                    className="h-9 min-w-[220px] flex-1 rounded border border-border bg-input px-3 text-[13px] text-ink placeholder:text-ink-placeholder disabled:opacity-50"
                  />
                  {shortUrl ? (
                    <Button size="sm" variant="outline" onClick={() => { setShortUrl(null); setLinkUrl(''); }}>
                      Remove
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!linkUrl.trim() || shortening} onClick={() => void shortenLink()}>
                      {shortening ? 'Shortening…' : 'Shorten'}
                    </Button>
                  )}
                </div>
                {shortUrl ? <p className="mt-1 text-[12px] text-success">Added {shortUrl} to the caption above.</p> : null}
                {linkError ? <p className="mt-1 text-[12px] text-destructive">{linkError}</p> : null}
              </div>

              <div>
                <p className="text-[13px] font-medium text-ink-muted">Publish to</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] capitalize ${
                        platform === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface-muted'
                      }`}
                    >
                      {p.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            </div>
          ) : null}
        </div>

        {phase === 'editor' || phase === 'preview' ? (
          <footer className="flex items-center justify-between border-t border-border px-6 py-4">
            {phase === 'editor' ? (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Save as draft
                </Button>
                <Button onClick={() => setPhase('preview')}>Continue to preview</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setPhase('editor')}>
                  Back to editor
                </Button>
                <Button disabled={busy} onClick={() => void publishNow()}>
                  {busy ? 'Publishing…' : 'Publish now'}
                </Button>
              </>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
