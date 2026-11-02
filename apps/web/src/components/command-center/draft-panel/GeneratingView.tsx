'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { PostType } from './DraftDrawer';
import { Fact } from './ImageDraftForm';
import { GenCheckIcon, GenImageIcon, GenVideoIcon, SlideDoneIcon, SparkleIcon } from './icons';
import type { ResolvedBeat } from './types';

/**
 * The Draft Panel while something is being made — `DP genImage`, `DP genVideo`,
 * `DP genCarousel` and `DP genText`.
 *
 * ── Measured off the rendered prototypes at 1728 ──────────────────────────
 *
 * The content pane is x788, 940 wide; there are no tabs on this screen, the
 * header takes their place.
 *
 *   header row    y55 · sparkle 21.6 at +32, title 18/600, "In progress" pill
 *                 125x33 r15.76 violet 20%, a 14px violet dot, 14/600 #A341FF
 *   campaign      y107 · 26.9/600, at +37
 *   facts         y157 · the focus card's own 168/167 columns
 *   accounts      y196 · 30px circles, 44 apart
 *   rule          y252 · full width
 *   preview       image 327x411 r10 · video 257x411 · carousel 3x 211x240,
 *                 29 apart · text 548x259 r20 — grey wash in a 30% ring
 *   bar           357x7 r13 at 20% grey, a 109x6 ink segment
 *   status        18/500 black, the ETA 18/500 grey at 60%
 *   asked card    417 wide r10 · grey 10% in a 30% ring · chips 23 tall r10
 *   steps         35 apart · a green tick, a violet dot, or a grey dot, then
 *                 18/500 — ink once done, grey until
 *   footer        rule at y1157 · "Close" 116x42 r8.4 · a 15/500 grey note
 *
 * ── What is real here, and what is an estimate ────────────────────────────
 *
 * Every generate call is one HTTP request that answers when the vendor is done
 * — no job id, no stream, nothing to poll. So:
 *
 * - The **bar** sweeps rather than fills. It says "working"; a fill would be a
 *   percentage nobody measured.
 * - The **steps** are what the tool really does, in its order — the handler's
 *   own awaits, read from `packages/generate/src`. Which one is *current* is
 *   paced against the time the step usually takes, and the last one is held
 *   until the response arrives: nothing is ticked before it has happened.
 * - The **ETA** is the vendor's usual time, and once that has passed the line
 *   says so instead of repeating a promise the request has already broken.
 * - The **scene squares and slides** are the post's own beats: a tick is a
 *   scene that has media, the highlighted one is the one being worked on.
 */

export type GenKind = 'post' | 'image' | 'broll' | 'avatar' | 'voiceover' | 'dub';

export interface GenJob {
  kind: GenKind;
  postType: PostType;
  /** "What you asked for" — the brief, the prompt or the script. */
  asked: string;
  /** The chips under it: aspect, format, language. */
  chips: string[];
  /** The post this belongs to; absent while a new post is being drafted. */
  contentItemId?: string;
  /** The scene being worked on, for a per-scene job. */
  beatId?: string;
  /** For a dub, the language — it names the middle step. */
  language?: string;
  startedAt: number;
}

interface Plan {
  steps: string[];
  /** Seconds — the vendor's usual range. */
  eta: [number, number];
  etaLine: string;
}

function writeStep(postType: PostType): string {
  if (postType === 'video') return 'Writing the script';
  if (postType === 'carousel') return 'Writing the slides';
  return 'Writing the copy';
}

/**
 * The steps, from the handlers themselves.
 *
 * `content.draft`: `resolvePlan` (the brand's assets for each beat), then
 * `selectKnowledge`, then the beats, then `writeHashtags`, then the guard.
 * The generate tools: the brand's style folded into the prompt (or the voice
 * and consent checks), the vendor call, then `content.updateDraft`.
 */
export function planFor(job: Pick<GenJob, 'kind' | 'postType' | 'language'>): Plan {
  switch (job.kind) {
    case 'post':
      return {
        steps: [
          'Matching your brand assets',
          'Reading your brand knowledge',
          writeStep(job.postType),
          'Adding hashtags',
          'Checking brand fit',
        ],
        eta: [10, 40],
        etaLine: 'This usually takes 10–40 seconds',
      };
    case 'image':
      return {
        steps: ['Applying your brand style', 'Generating the image', 'Saving it to the draft'],
        eta: [20, 30],
        etaLine: 'This usually takes 20–30 seconds',
      };
    case 'broll':
      return {
        steps: ['Applying your brand style', 'Generating the clip', 'Saving it to the draft'],
        eta: [60, 180],
        etaLine: 'Video usually takes 1–3 minutes',
      };
    case 'avatar':
      return {
        steps: ['Checking avatar consent', 'Rendering the avatar video', 'Saving it to the draft'],
        eta: [120, 600],
        etaLine: 'Avatar video usually takes a few minutes',
      };
    case 'voiceover':
      return {
        steps: ['Choosing the voice', 'Recording the voiceover', 'Saving it to the draft'],
        eta: [5, 20],
        etaLine: 'This usually takes 5–20 seconds',
      };
    case 'dub':
      return {
        steps: ['Sending the scene to dubbing', `Dubbing it into ${job.language ?? 'the new language'}`, 'Saving it to the draft'],
        eta: [60, 300],
        etaLine: 'Dubbing usually takes a few minutes',
      };
  }
}

/** The header — the prototypes' "Generating your image", "Finalizing your copy". */
export function titleFor(job: Pick<GenJob, 'kind' | 'postType'>): string {
  switch (job.kind) {
    case 'post':
      if (job.postType === 'video') return 'Generating your Video Post';
      if (job.postType === 'carousel') return 'Generating your carousel';
      if (job.postType === 'text') return 'Writing your copy';
      return 'Generating your Image Post';
    case 'image':
      return job.postType === 'carousel' ? 'Generating your slide' : 'Generating your image';
    case 'broll':
      return 'Generating your video clip';
    case 'avatar':
      return 'Generating your avatar video';
    case 'voiceover':
      return 'Recording your voiceover';
    case 'dub':
      return 'Dubbing your scene';
  }
}

/** What the "ready" notification says, for a job that finished with the panel closed. */
export function readyTitle(job: Pick<GenJob, 'kind' | 'postType'>): string {
  switch (job.kind) {
    case 'post':
      return 'Your draft is ready';
    case 'image':
      return job.postType === 'carousel' ? 'Your slide is ready' : 'Your image is ready';
    case 'broll':
      return 'Your video clip is ready';
    case 'avatar':
      return 'Your avatar video is ready';
    case 'voiceover':
      return 'Your voiceover is ready';
    case 'dub':
      return 'Your dubbed scene is ready';
  }
}

/**
 * Which step is under way, `elapsed` seconds in.
 *
 * Paced evenly across the low end of the ETA and capped at the last step, which
 * holds until the response arrives — a slow request sits on its last honest
 * step rather than ticking one it has not done.
 */
export function currentStep(stepCount: number, eta: [number, number], elapsed: number): number {
  if (stepCount <= 1) return 0;
  const per = eta[0] / stepCount;
  return Math.min(stepCount - 1, Math.max(0, Math.floor(elapsed / per)));
}

/** A beat with something made for it — media of its own, or media behind its words. */
function hasMedia(beat: ResolvedBeat): boolean {
  return beat.kind !== 'text' || Boolean(beat.backdrop);
}

const RING = 'inset 0 0 0 1px rgba(131,131,131,0.3)';
const WASH =
  'linear-gradient(270deg, rgba(224,224,224,0.1) 0%, rgba(29,29,29,0.06) 48.38%, rgba(131,131,131,0.035) 100%)';
const PLACEHOLDER: CSSProperties = { background: WASH, boxShadow: RING };
/** The prototypes' 14px status dot — a tint under a colour fading to nothing. */
function dotStyle(colour: string): CSSProperties {
  return {
    background: `linear-gradient(156.861deg, ${colour} 14.97%, rgba(255,255,255,0) 97.57%), rgba(131,131,131,0.2)`,
  };
}

export function GeneratingView({
  job,
  beats,
  campaignName,
  heading,
  goal,
  campaignType,
  duration,
  platforms,
  onClose,
}: {
  job: GenJob;
  beats: ResolvedBeat[];
  campaignName?: string;
  /** The post's own title, when it belongs to no campaign. */
  heading?: string;
  goal?: string;
  campaignType?: string;
  duration?: string;
  platforms?: string[];
  onClose: () => void;
}) {
  const plan = planFor(job);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, (now - job.startedAt) / 1000);
  const step = currentStep(plan.steps.length, plan.eta, elapsed);
  const late = elapsed > plan.eta[1];

  const sceneIndex = job.beatId ? beats.findIndex((b) => b.beatId === job.beatId) : -1;
  const unit = job.postType === 'carousel' ? 'slide' : 'scene';
  const verb = job.kind === 'voiceover' ? 'Recording' : job.kind === 'dub' ? 'Dubbing' : 'Generating';
  const status =
    sceneIndex >= 0 && beats.length > 1 && (job.postType === 'video' || job.postType === 'carousel')
      ? `${verb} ${unit} ${sceneIndex + 1} of ${beats.length}`
      : plan.steps[step]!;
  const hasFacts = Boolean(goal || campaignType || duration);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Header — y55 to the rule at y252 ────────────────────────────── */}
        <header className="px-[32px] pt-[27px] pb-[26px]">
          <div className="flex flex-wrap items-center">
            <SparkleIcon className="shrink-0 text-ink" />
            <h2 className="ml-[6px] text-18 font-semibold leading-[23px] text-ink">{titleFor(job)}</h2>
            <span
              className="ml-[10px] flex h-[33px] items-center gap-[8px] rounded-[15.758px] pl-[15px] pr-[13px] text-14 font-semibold text-[color:var(--ss-purple)]"
              style={{ background: 'rgba(163,65,255,0.2)' }}
            >
              <span
                aria-hidden
                className="h-[14px] w-[14px] animate-pulse rounded-full"
                style={{ background: 'linear-gradient(156.861deg, var(--ss-purple) 14.97%, rgba(255,255,255,0) 97.57%), #fff' }}
              />
              In progress
            </span>
          </div>
          <p className="ml-[5px] mt-[19px] text-26 font-semibold leading-[1.26] text-ink">
            {heading ?? campaignName ?? 'Untitled Post'}
          </p>
          {hasFacts ? (
            <dl className="ml-[5px] mt-[16px] grid grid-cols-[170px_167px_1fr] gap-y-[8px]">
              <Fact label="Goal" value={goal} />
              <Fact label="Type" value={campaignType} />
              <Fact label="Duration" value={duration} />
            </dl>
          ) : null}
          {platforms && platforms.length > 0 ? (
            <div className="ml-[5px] mt-[19px] flex items-center gap-[14px]">
              {platforms.slice(0, 4).map((p) => (
                <span
                  key={p}
                  title={p}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-11 font-semibold uppercase text-ink-muted"
                  style={{ background: 'var(--ss-surface-100)', boxShadow: 'inset 0 0 0 0.761px rgba(120,120,120,0.28)' }}
                >
                  {p.slice(0, 2)}
                </span>
              ))}
            </div>
          ) : null}
        </header>
        <Hairline />

        {/* ── The work — centred in the pane ──────────────────────────────── */}
        <div className="flex flex-col items-center px-[24px] pb-[32px]" aria-live="polite">
          <Preview job={job} beats={beats} sceneIndex={sceneIndex} />

          <div
            role="progressbar"
            aria-label={titleFor(job)}
            aria-busy="true"
            className={cn(
              'relative h-[7px] w-full max-w-[357px] overflow-hidden rounded-[13.11px]',
              job.postType === 'carousel' ? 'mt-[47px]' : job.postType === 'video' ? 'mt-[38px]' : job.postType === 'text' ? 'mt-[41px]' : 'mt-[31px]',
            )}
            style={{ background: 'rgba(131,131,131,0.2)' }}
          >
            <span className="absolute left-[0.8px] top-[0.45px] h-[6px] w-[109px] animate-sweep rounded-[18.79px] bg-ink" />
          </div>

          <p className="mt-[20px] text-center text-18 font-medium leading-[23px] text-black">
            {status}
            <span aria-hidden>
              {' '}
              <span className="inline-block animate-dot">.</span>
              <span className="inline-block animate-dot [animation-delay:0.15s]">.</span>
              <span className="inline-block animate-dot [animation-delay:0.3s]">.</span>
            </span>
          </p>
          <p className="mt-[10px] text-center text-18 font-medium leading-[23px]" style={{ color: 'rgba(131,131,131,0.6)' }}>
            {late ? 'Taking longer than usual — still working on it' : plan.etaLine}
          </p>

          {/* ── What you asked for — 417 wide, r10 ─────────────────────────── */}
          <div className="mt-[24px] w-full max-w-[417px]">
            {job.asked.trim() ? (
              <div className="rounded-[10px] px-[21px] pt-[15px] pb-[12px]" style={{ background: 'rgba(131,131,131,0.1)', boxShadow: RING }}>
                <p className="text-14 font-medium leading-[18px] text-ink-muted">What you asked for</p>
                <div className="mt-[12px] flex items-start gap-[7px]">
                  <GenCheckIcon className="mt-[3px] shrink-0 text-[color:var(--ss-scene-cta)]" />
                  <p className="line-clamp-3 text-16 font-medium leading-[1.25] text-black">{job.asked.trim()}</p>
                </div>
                {job.chips.length > 0 ? (
                  <div className="mt-[16px] flex flex-wrap gap-[5px]">
                    {job.chips.map((c) => (
                      <span
                        key={c}
                        className="flex h-[23px] items-center rounded-[10px] px-[8px] text-14 font-medium text-ink-muted"
                        style={{ background: 'rgba(131,131,131,0.15)', boxShadow: RING }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── The steps — 35 apart ───────────────────────────────────────── */}
            <ol className="mt-[20px] flex flex-col gap-[12px] pl-[21px]">
              {plan.steps.map((label, i) => {
                const done = i < step;
                const on = i === step;
                return (
                  <li
                    key={label}
                    className={cn('flex h-[23px] items-center gap-[8px] text-18 font-medium', done ? 'text-ink' : 'text-ink-muted')}
                    aria-current={on ? 'step' : undefined}
                  >
                    {done ? (
                      <GenCheckIcon className="shrink-0 text-[color:var(--ss-scene-cta)]" />
                    ) : (
                      <span
                        aria-hidden
                        className={cn('h-[14px] w-[14px] shrink-0 rounded-full', on ? 'animate-pulse' : '')}
                        style={dotStyle(on ? 'var(--ss-purple)' : 'rgb(131,131,131)')}
                      />
                    )}
                    {label}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      {/* ── Footer — the rule at y1157, then Close and the note ──────────────── */}
      <Hairline />
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pl-[22px] pr-[34px] pt-[20px] pb-[27px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[42px] w-[116px] items-center justify-center rounded-[8.405px] text-16 font-semibold text-ink-muted hover:text-ink"
          style={{ boxShadow: 'inset 0 0 0 0.701px rgb(131,131,131)' }}
        >
          Close
        </button>
        <p className="text-15 font-medium text-ink-muted">You can close this — we&rsquo;ll notify you when it&rsquo;s ready</p>
      </footer>
    </div>
  );
}

function Hairline() {
  return <div aria-hidden className="h-px w-full shrink-0" style={{ background: 'rgba(131,131,131,0.25)' }} />;
}

/** The format's placeholder — and, for a per-scene job, where that scene sits in the post. */
function Preview({ job, beats, sceneIndex }: { job: GenJob; beats: ResolvedBeat[]; sceneIndex: number }) {
  if (job.postType === 'video') {
    return (
      <>
        <div
          className="mt-[44px] flex h-[411px] w-[257px] max-w-full items-center justify-center rounded-[10px]"
          style={PLACEHOLDER}
        >
          <GenVideoIcon className="animate-shimmer text-ink-muted" />
        </div>
        {/* The scenes, when this is one of them — none while the post itself is being written. */}
        {job.kind !== 'post' && beats.length > 1 ? (
          <ol className="mt-[24px] flex flex-wrap justify-center gap-[16px]">
            {beats.map((b, i) => {
              const on = i === sceneIndex;
              const made = !on && hasMedia(b);
              return (
                <li
                  key={b.beatId}
                  aria-current={on ? 'step' : undefined}
                  className={cn(
                    'flex h-[126.3px] w-[79px] items-center justify-center rounded-[3.074px] text-18 font-semibold text-black',
                    on ? 'animate-shimmer' : '',
                  )}
                  style={
                    made
                      ? { background: 'rgba(31,175,19,0.1)', boxShadow: 'inset 0 0 0 1px var(--ss-scene-cta)' }
                      : on
                        ? { background: 'rgba(163,65,255,0.06)', boxShadow: 'inset 0 0 0 1px var(--ss-purple)' }
                        : { boxShadow: 'inset 0 0 0 0.5px rgb(131,131,131)' }
                  }
                >
                  {made ? (
                    <GenCheckIcon width={15.8} height={15.8} className="text-[color:var(--ss-scene-cta)]" />
                  ) : (
                    i + 1
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}
      </>
    );
  }

  if (job.postType === 'carousel') {
    // A new carousel has no slides yet; three blanks say "slides are coming" without inventing a count.
    const slides = job.kind === 'post' || beats.length === 0 ? null : beats;
    return (
      <ol className="mt-[39px] grid w-full max-w-[691px] grid-cols-[repeat(auto-fill,minmax(160px,211px))] justify-center gap-[29px]">
        {(slides ?? [null, null, null]).map((b, i) => {
          const on = slides ? i === sceneIndex : false;
          const made = Boolean(b) && !on && hasMedia(b!);
          const label = `SLIDE ${String(i + 1).padStart(2, '0')}`;
          return (
            <li
              key={b?.beatId ?? i}
              aria-current={on ? 'step' : undefined}
              className="relative flex h-[240px] flex-col rounded-[10px] px-[21px] pt-[18px] pb-[17px]"
              style={
                made
                  ? { background: 'var(--ss-gen-slide-done)', boxShadow: 'inset 0 0 0 1px var(--ss-cyan)' }
                  : on
                    ? { background: '#fff', boxShadow: 'inset 0 0 0 1px var(--ss-cyan)' }
                    : { background: WASH, boxShadow: 'inset 0 0 0 1px rgb(131,131,131)' }
              }
            >
              {made ? (
                <>
                  <span className="text-14 font-semibold text-ink-muted">{label}</span>
                  <SlideDoneIcon className="absolute right-[15px] top-[18px] text-[color:var(--ss-green-600)]" />
                  <p className="mt-auto line-clamp-3 text-16 font-medium leading-[1.25] text-black">
                    {b!.kind === 'text' ? b!.text : b!.label}
                  </p>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={cn('m-auto h-[30px] w-[30px] rounded-full', on ? 'animate-pulse' : '')}
                    style={dotStyle(on ? 'rgb(52,205,233)' : 'rgb(131,131,131)')}
                  />
                  <span className="text-14 font-semibold text-ink-muted">{label}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  if (job.postType === 'text') {
    // `DP genText`'s skeleton post: an avatar, a byline, and five lines of copy.
    const bar = (w: string, strong: boolean) => (
      <span
        className="block h-[10.5px] rounded-[9.557px]"
        style={{ width: w, background: strong ? 'rgba(131,131,131,0.2)' : 'rgba(131,131,131,0.1)' }}
      />
    );
    return (
      <div
        className="mt-[50px] h-[259px] w-full max-w-[548px] animate-shimmer rounded-[20px] px-[24px] pt-[18px]"
        style={{ background: WASH, boxShadow: 'inset 0 0 0 0.956px rgba(131,131,131,0.3)' }}
        aria-hidden
      >
        <div className="flex items-start gap-[13px]">
          <span className="h-[70.7px] w-[70.7px] shrink-0 rounded-full" style={{ background: 'var(--ss-gen-avatar)' }} />
          <div className="flex w-full flex-col gap-[10.5px] pt-[20px]">
            {bar('107px', true)}
            {bar('79px', false)}
          </div>
        </div>
        <div className="mt-[28px] flex flex-col gap-[10px]">
          {bar('97%', true)}
          {bar('89%', false)}
          {bar('94%', true)}
        </div>
        <div className="mt-[30px] flex flex-col gap-[10.5px]">
          {bar('84%', true)}
          {bar('77%', false)}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-[24px] flex h-[411px] w-[327px] max-w-full items-center justify-center rounded-[10px]" style={PLACEHOLDER}>
      <GenImageIcon className="animate-shimmer text-ink-muted" />
    </div>
  );
}
