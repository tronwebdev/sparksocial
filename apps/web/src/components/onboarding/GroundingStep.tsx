'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AssetUploadForm } from '@/components/assets/AssetUploadForm';
import { invoke } from '@/lib/tools';

/**
 * `ONB-04` — the step that gives SPARK something to write *from*.
 *
 * Onboarding used to end having established what the brand *could* do and never
 * once asking for anything it already had. Three consequences, all measured on a
 * real account rather than reasoned about:
 *
 *   - **No call to action.** Fourteen of the thirty playbooks source their `cta`
 *     beat from `genome:offer.primary_cta`. Empty, they throw `NOT_FOUND` at plan
 *     time — before any model call — so a brand could reach the Draft Panel and
 *     still only draft the two formats that have no CTA beat.
 *   - **No point of view.** `voice` was left at its schema defaults: an all-0.5
 *     tone vector and no opinions. `text-writer.ts` builds its prompt almost
 *     entirely from `voice`, and its system prompt says outright that "text that
 *     would suit any business in the category is a failed beat" — with nothing in
 *     `voice` there was nothing to make a beat specific. It produced "Fresh cuts,
 *     fresh perspectives — it's not just a style, it's a statement." Given two POV
 *     statements it produced "We perfect every cut because a great fade should
 *     keep you sharp for weeks."
 *   - **No assets.** Every golden fixture in `packages/playbooks/src/golden.ts`
 *     carries `brand_kit: 1`, so the whole test suite modelled the world *after*
 *     a brand kit existed. Real accounts started at zero, where a single logo
 *     file unlocks six formats.
 *
 * ── Why one screen and not three ───────────────────────────────────────────
 *
 * The rest of onboarding is deliberately one question per screen, and this
 * breaks that pattern on purpose: these three are the same question asked three
 * ways — "what do you already have?" — and all three are skippable. Splitting
 * them would put three skippable screens between the routing questions and the
 * finish line, which is how people abandon onboarding.
 *
 * Everything here writes through a tool that already existed or was built for
 * it, per this file's own rule: a screen may not collect something no tool can
 * save. `genome.voice.set` and the `patchVoice` beneath it were added for this
 * step — before it, `voice` was writable only at genome-creation time.
 */
export function GroundingStep({ genomeId }: { genomeId: string }) {
  const [cta, setCta] = useState('');
  const [povText, setPovText] = useState('');
  const [savingCta, setSavingCta] = useState(false);
  const [savingPov, setSavingPov] = useState(false);
  const [ctaMsg, setCtaMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [povMsg, setPovMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [gaps, setGaps] = useState<{ role: string; count: number } | null>(null);

  /**
   * What the best single upload would unlock, read from the same tool the Assets
   * Library uses so the two screens cannot disagree. Read-only and best-effort:
   * a failure here leaves the upload control perfectly usable, so it says
   * nothing rather than showing an error for a hint.
   */
  const loadGaps = useCallback(async () => {
    const res = await invoke<{
      gaps: Array<{ missingRole: string; playbooksBlocked: string[]; unlockedBy: 'upload' | 'capture' }>;
    }>('asset.gaps', { genomeId });
    if (res.status !== 'succeeded') return;
    const best = res.output.gaps.find((g) => g.unlockedBy === 'upload');
    setGaps(best ? { role: best.missingRole.replace(/_/g, ' '), count: best.playbooksBlocked.length } : null);
  }, [genomeId]);

  useEffect(() => {
    void loadGaps();
  }, [loadGaps]);

  async function saveCta() {
    if (!cta.trim()) return;
    setSavingCta(true);
    setCtaMsg(null);
    const res = await invoke('genome.offer.set', { genomeId, offer: { primary_cta: cta.trim() } });
    setSavingCta(false);
    setCtaMsg(
      res.status === 'succeeded'
        ? { kind: 'ok', text: 'Saved. Every post that ends on an ask will use those words.' }
        : { kind: 'err', text: res.status === 'failed' ? res.error.message : 'That needs approval before it can run.' },
    );
  }

  async function savePov() {
    // One statement per line, blanks dropped — a textarea is the right control
    // for "two or three opinions" and a repeater would be three clicks per line.
    const statements = povText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (statements.length === 0) return;

    setSavingPov(true);
    setPovMsg(null);
    const res = await invoke('genome.voice.set', { genomeId, voice: { pov_statements: statements } });
    setSavingPov(false);
    setPovMsg(
      res.status === 'succeeded'
        ? {
            kind: 'ok',
            text: `Saved ${statements.length} ${statements.length === 1 ? 'opinion' : 'opinions'}. SPARK will write from ${statements.length === 1 ? 'it' : 'them'} rather than around them.`,
          }
        : { kind: 'err', text: res.status === 'failed' ? res.error.message : 'That needs approval before it can run.' },
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {/* ── 1. The CTA. First because it is the one that unblocks formats. ── */}
      <section className="flex flex-col gap-2">
        <label className="text-[15px] font-medium text-ink" htmlFor="onb-cta">
          What should someone do after they see a post?
        </label>
        <p className="max-w-prose text-[13px] text-ink-muted">
          Your own words, as you would say them — &ldquo;Book a chair&rdquo;, &ldquo;Message us for a
          quote&rdquo;, &ldquo;Start a free trial&rdquo;. SPARK never invents this one, so most formats
          cannot finish a post without it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="onb-cta"
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Book a chair"
            className="w-full sm:max-w-xs"
          />
          <Button variant="outline" disabled={savingCta || !cta.trim()} onClick={() => void saveCta()}>
            {savingCta ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {ctaMsg ? (
          <p className={`text-[13px] ${ctaMsg.kind === 'ok' ? 'text-success' : 'text-[var(--ss-danger)]'}`}>
            {ctaMsg.text}
          </p>
        ) : null}
      </section>

      {/* ── 2. Point of view. The biggest lever on whether copy sounds like you. ── */}
      <section className="flex flex-col gap-2 border-t border-border pt-6">
        <label className="text-[15px] font-medium text-ink" htmlFor="onb-pov">
          What do you believe that a competitor might not say?
        </label>
        <p className="max-w-prose text-[13px] text-ink-muted">
          One per line, two or three is plenty. Opinions, not features —{' '}
          <span className="text-ink">&ldquo;a fade should last three weeks, not three days&rdquo;</span> is
          worth more than &ldquo;we do great fades&rdquo;. This is the difference between copy that sounds
          like you and copy that would suit anyone in your trade.
        </p>
        <textarea
          id="onb-pov"
          value={povText}
          onChange={(e) => setPovText(e.target.value)}
          rows={3}
          placeholder={'A fade should last three weeks, not three days\nWe would rather turn you away than rush a line-up'}
          className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-[14px] text-ink placeholder:text-ink-placeholder focus:outline-none focus:ring-[1.5px] focus:ring-ring"
        />
        <div>
          <Button variant="outline" disabled={savingPov || !povText.trim()} onClick={() => void savePov()}>
            {savingPov ? 'Saving…' : 'Save opinions'}
          </Button>
        </div>
        {povMsg ? (
          <p className={`text-[13px] ${povMsg.kind === 'ok' ? 'text-success' : 'text-[var(--ss-danger)]'}`}>
            {povMsg.text}
          </p>
        ) : null}
      </section>

      {/* ── 3. Something to build from. ── */}
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div>
          <p className="text-[15px] font-medium text-ink">Anything you already have?</p>
          <p className="mt-1 max-w-prose text-[13px] text-ink-muted">
            {gaps
              ? `A ${gaps.role} is the one that pays off most — it unlocks ${gaps.count} ${gaps.count === 1 ? 'format' : 'formats'} on its own, with no filming.`
              : 'A logo, a photo of finished work, a screenshot of a good review. No filming needed.'}{' '}
            You can add more any time from the Assets Library.
          </p>
        </div>
        <AssetUploadForm genomeId={genomeId} onIngested={() => { setUploadKey((k) => k + 1); void loadGaps(); }} />
        {uploadKey > 0 ? (
          <p className="text-[13px] text-success">
            Added. {uploadKey === 1 ? 'That is' : `${uploadKey} files are`} in the library — SPARK can build
            from {uploadKey === 1 ? 'it' : 'them'} now.
          </p>
        ) : null}
      </section>
    </div>
  );
}
