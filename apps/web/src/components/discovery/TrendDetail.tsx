'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';
import { cn } from '@/lib/utils';
import { WhyPopover, type Explanation } from '@/components/explain/WhyPopover';

/**
 * `DISC-02` — the trend detail screen, PRD §8.9.
 *
 *   *"Trend detail includes: metrics + time series, sample posts, generate
 *   content pack panel (brief title, goal, CTA, post types, brand kit toggle),
 *   recommendations row (time shift, format, hook) with apply buttons."*
 *
 * ── Four registered tools with no way to reach them ────────────────────────
 *
 * `trend.detail`, `trend.explain`, `trend.reshare` and `trend.safety_filter`
 * were all registered, tested and callable, and no component called any of
 * them — so this screen did not exist at all. The feed showed a score and a
 * "Suggest a post" button, and the two things §8.9 actually asks the detail view
 * to answer — *why* is this trend worth my time, and what does joining it look
 * like — were unreachable.
 *
 * ── What is here and what is deliberately not ─────────────────────────────
 *
 * Here: the four metrics, the safety verdict, the full scoring breakdown, the
 * sample posts, and both routes into content (Repurpose → a new post from this
 * trend; Reshare → reframe something you already published around it). The
 * scoring breakdown carries the most weight on this screen: the PRD's whole
 * premise for Discovery is acting *before saturation*, and a number without its
 * factors is a number nobody can act on.
 *
 * Not here: a time series. `TrendMetrics` carries four scalars — volume,
 * velocity, saturation, growth — and no history, so a chart would be a chart of
 * one point. Drawing a fabricated curve through it would be worse than the
 * honest four numbers with `growth` named as the direction of travel. The
 * series needs the sources to be polled and stored over time, which is real work
 * and not a rendering problem.
 */

interface TrendMetrics {
  volume: number;
  velocity: number;
  saturation: number;
  growth: number;
}

interface TrendDetailView {
  trend: {
    id: string;
    source: string;
    topic: string;
    tags: string[];
    metrics: TrendMetrics;
    samples: Array<{ url: string; caption?: string }>;
  };
  score: number;
  relevance: number;
  opportunity: number;
  safety: { safe: boolean; reasons: string[]; detail?: string };
  factors: Array<{ label: string; detail: string; weight?: number }>;
  why: Explanation;
}

interface RepurposeSuggestion {
  playbookId: string;
  playbookName: string;
  intent: string;
}

interface ReshareSuggestion {
  contentItemId?: string;
  caption?: string;
  intent?: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Volume is the only raw count here, and raw counts are unreadable past a few thousand. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function TrendDetail({
  genomeId,
  trendId,
  onClose,
}: {
  genomeId: string;
  trendId: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<TrendDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [suggestion, setSuggestion] = useState<RepurposeSuggestion | null>(null);
  const [reshare, setReshare] = useState<ReshareSuggestion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<'repurpose' | 'reshare' | 'draft' | null>(null);

  // §8.9's content-pack panel inputs. Held here rather than on the tool call
  // because they apply to whichever route the user takes out of this screen.
  const [ctaUrl, setCtaUrl] = useState('');
  const [reshareItemId, setReshareItemId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setView(null);
      setError(null);
      const res = await invoke<TrendDetailView>('trend.detail', { genomeId, trendId });
      if (cancelled) return;
      if (res.status !== 'succeeded') {
        setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
        return;
      }
      setView(res.output);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, trendId]);

  const runRepurpose = useCallback(async () => {
    setBusy('repurpose');
    setNote(null);
    const res = await invoke<{ suggestion: RepurposeSuggestion | null; why: Explanation }>('trend.repurpose', {
      genomeId,
      trendId,
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setSuggestion(res.output.suggestion);
    if (!res.output.suggestion) setNote(res.output.why.summary);
  }, [genomeId, trendId]);

  const runReshare = useCallback(async () => {
    if (!reshareItemId.trim()) {
      setNote('Paste the id of a post you have already published to reframe it.');
      return;
    }
    setBusy('reshare');
    setNote(null);
    const res = await invoke<{ suggestion: ReshareSuggestion | null; why: Explanation }>('trend.reshare', {
      genomeId,
      trendId,
      contentItemId: reshareItemId.trim(),
    });
    setBusy(null);
    if (res.status !== 'succeeded') {
      setNote(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    setReshare(res.output.suggestion);
    if (!res.output.suggestion) setNote(res.output.why.summary);
  }, [genomeId, trendId, reshareItemId]);

  /** The suggestion becomes a real draft — `content.draft` is the same tool the Draft Panel uses. */
  const draftIt = useCallback(async () => {
    if (!suggestion) return;
    setBusy('draft');
    setNote(null);
    const res = await invoke<{ contentItemId: string }>(
      'content.draft',
      {
        genomeId,
        playbookId: suggestion.playbookId,
        intent: ctaUrl.trim() ? `${suggestion.intent} Point people at ${ctaUrl.trim()}.` : suggestion.intent,
      },
      // Non-idempotent: a second call is a second take, not a replay.
      `trend-draft:${trendId}:${Date.now()}`,
    );
    setBusy(null);
    setNote(
      res.status === 'succeeded'
        ? 'Drafted. It is in your drafts, ready to place on the calendar.'
        : res.status === 'failed'
          ? res.error.message
          : 'That draft needs approval first.',
    );
  }, [suggestion, genomeId, trendId, ctaUrl]);

  if (error) {
    return (
      <section className="rounded-xl border border-border bg-surface p-6">
        <p className="text-[14px] text-ink-muted">{error}</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={onClose}>
          Back to trends
        </Button>
      </section>
    );
  }

  if (!view) return <Skeleton className="h-96 w-full rounded-xl" />;

  const { trend, metrics } = { trend: view.trend, metrics: view.trend.metrics };

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-medium text-ink">{trend.topic}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="neutral" className="capitalize">
              {trend.source}
            </Badge>
            <Badge variant={view.score >= 0.5 ? 'success' : 'neutral'}>{pct(view.score)} match</Badge>
            {/* Safety is a verdict, not a score — it reads as a warning or it
                does not appear at all. */}
            {!view.safety.safe ? <Badge variant="warn">Brand-safety concern</Badge> : null}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back to trends
        </Button>
      </div>

      {/* ── Metrics. Ordered by what the PRD says matters, not by size. ──── */}
      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Metric
          label="Velocity"
          value={pct(metrics.velocity)}
          note="How fast it is moving. The early signal."
        />
        <Metric
          label="Saturation"
          value={pct(metrics.saturation)}
          note="How done it already is. The late signal."
          warn={metrics.saturation >= 0.7}
        />
        <Metric
          label="Growth"
          value={`${metrics.growth > 0 ? '+' : ''}${Math.round(metrics.growth * 100)}%`}
          note={metrics.growth < 0 ? 'Already declining.' : 'Period over period.'}
          warn={metrics.growth < 0}
        />
        <Metric label="Volume" value={compact(metrics.volume)} note="Reach. Context, not a reason." />
      </dl>

      <p className="mt-3 text-[13px] text-ink-muted">
        Opportunity is <span className="font-medium text-ink">{pct(view.opportunity)}</span> — velocity
        discounted by how done the trend already is — and relevance to this brand is{' '}
        <span className="font-medium text-ink">{pct(view.relevance)}</span>.
      </p>

      <WhyPopover why={{ ...view.why, factors: view.factors }} label="How this trend scored for you" />

      {!view.safety.safe && view.safety.reasons.length ? (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-[13px] font-medium text-ink">Why this needs a second look</p>
          <ul className="mt-1 list-inside list-disc text-[13px] text-ink-muted">
            {view.safety.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Samples ─────────────────────────────────────────────────── */}
        <div>
          <h3 className="text-[14px] font-medium text-ink">What people are posting</h3>
          {trend.samples.length ? (
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {trend.samples.slice(0, 6).map((s, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  {s.caption ? <p className="text-[13px] text-ink">{s.caption}</p> : null}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 block truncate text-[12px] text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
                  >
                    {s.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-muted">
              This source did not return example posts for this trend.
            </p>
          )}

          {trend.tags.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {trend.tags.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-surface-muted px-2.5 py-1 text-[12px] text-ink-muted">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* ── The content pack panel (§8.9) ───────────────────────────── */}
        <div>
          <h3 className="text-[14px] font-medium text-ink">Make something from it</h3>

          <div className="mt-2">
            <label className="text-[12px] font-medium text-ink-muted" htmlFor="trend-cta">
              CTA link (optional)
            </label>
            <Input
              id="trend-cta"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1.5"
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-[13px] font-medium text-ink">Repurpose</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                A new post from this trend, in a format you can actually make.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy !== null}
                onClick={() => void runRepurpose()}
              >
                {busy === 'repurpose' ? 'Thinking…' : 'Suggest a post'}
              </Button>

              {suggestion ? (
                <div className="mt-3 rounded border border-border bg-surface-muted p-3">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
                    {suggestion.playbookName}
                  </p>
                  <p className="mt-1 text-[13px] text-ink">{suggestion.intent}</p>
                  <Button size="sm" className="mt-2" disabled={busy !== null} onClick={() => void draftIt()}>
                    {busy === 'draft' ? 'Drafting…' : 'Draft it'}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-[13px] font-medium text-ink">Reshare</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Reframe something you already published around this trend, with the CTA re-pointed.
              </p>
              <Input
                value={reshareItemId}
                onChange={(e) => setReshareItemId(e.target.value)}
                placeholder="Published post id"
                className="mt-2"
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy !== null}
                onClick={() => void runReshare()}
              >
                {busy === 'reshare' ? 'Thinking…' : 'Suggest a reshare'}
              </Button>

              {reshare?.caption ? (
                <div className="mt-3 rounded border border-border bg-surface-muted p-3">
                  <p className="text-[13px] text-ink">{reshare.caption}</p>
                </div>
              ) : null}
            </div>
          </div>

          {note ? <p className="mt-3 text-[13px] text-ink-muted">{note}</p> : null}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-surface p-3">
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn('mt-0.5 text-[20px] font-medium tabular-nums', warn ? 'text-warn' : 'text-ink')}>
        {value}
      </dd>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{note}</p>
    </div>
  );
}
