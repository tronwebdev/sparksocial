'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/tools';
import { userMessage } from '@/lib/errorCopy';
import type { RecipeKind } from './recipeMeta';

/**
 * What the recipe would produce if it ran now — `recipe.preview`, which reads
 * the source with the same runner as a real run and saves nothing.
 *
 * AUTO-04.3 is "RSS URL + Preview" and AUTO-03.4 is "Preview Table + Validate",
 * and neither step could read its source: a mistyped feed URL or a private Drive
 * folder was found out a day later, as an empty run. Each item also shows the
 * format the engine picked for it, because that is what it will become.
 *
 * Debounced, because the RSS step calls this while the URL is being typed.
 */

interface PreviewItem {
  title: string;
  intent: string;
  sourceUrl?: string;
  playbookName?: string;
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function RecipePreview({
  genomeId,
  kind,
  config,
  ready,
  idle,
}: {
  genomeId: string;
  kind: RecipeKind;
  config: Record<string, unknown>;
  /** False until the step has enough to read — no URL yet, for instance. */
  ready: boolean;
  /** What to say before `ready`. */
  idle: string;
}) {
  const [state, setState] = useState<
    { phase: 'idle' } | { phase: 'loading' } | { phase: 'done'; items: PreviewItem[]; error?: string }
  >({ phase: 'idle' });
  const key = JSON.stringify(config);

  useEffect(() => {
    if (!ready) {
      setState({ phase: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ phase: 'loading' });
    const timer = window.setTimeout(async () => {
      const res = await invoke<{ items: PreviewItem[]; error?: string }>('recipe.preview', {
        genomeId,
        kind,
        config: JSON.parse(key) as unknown,
      });
      if (cancelled) return;
      setState(
        res.status === 'succeeded'
          ? { phase: 'done', items: res.output.items, ...(res.output.error ? { error: res.output.error } : {}) }
          : { phase: 'done', items: [], error: res.status === 'failed' ? userMessage(res.error) : 'That check was gated.' },
      );
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [genomeId, kind, key, ready]);

  return (
    <div className="mt-[26px]">
      <p className="text-17 font-semibold text-ink">Preview</p>
      {state.phase === 'idle' ? (
        <p className="mt-[8px] text-15" style={{ color: '#838383' }}>
          {idle}
        </p>
      ) : state.phase === 'loading' ? (
        <p className="mt-[8px] text-15" style={{ color: '#838383' }}>
          Reading it now…
        </p>
      ) : state.error ? (
        <p className="mt-[8px] text-15" style={{ color: 'var(--ss-auto-failed)' }}>
          {state.error}
        </p>
      ) : state.items.length === 0 ? (
        <p className="mt-[8px] text-15" style={{ color: '#838383' }}>
          It read fine, but there is nothing in it to post yet.
        </p>
      ) : (
        <>
          <p className="mt-[6px] text-14" style={{ color: '#838383' }}>
            A run now would turn {state.items.length === 1 ? 'this' : `these ${state.items.length}`} into posts. Each
            later run takes the next new items and skips anything already used.
          </p>
          <ul className="mt-[12px] flex flex-col gap-[10px]">
            {state.items.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="rounded-[14px] px-[18px] py-[12px]"
                style={{ background: 'rgba(131,131,131,0.07)' }}
              >
                <p className="line-clamp-2 text-16 font-semibold text-ink" title={item.title}>
                  {item.title}
                </p>
                <p className="mt-[4px] flex flex-wrap gap-x-[10px] text-14" style={{ color: '#838383' }}>
                  {hostOf(item.sourceUrl) ? <span>{hostOf(item.sourceUrl)}</span> : null}
                  <span style={{ color: item.playbookName ? '#2AA02A' : 'var(--ss-amber-500)' }}>
                    {item.playbookName
                      ? `Becomes a ${item.playbookName} post`
                      : 'No format this brand can make fits it — it will be listed, not posted'}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
