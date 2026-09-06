'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';

/**
 * Where a *personal* preference lives.
 *
 * Two stores, and which one a setting belongs in is not a style choice:
 *
 *   - **Clerk `unsafeMetadata`** for anything that should follow the person to
 *     another machine — which notifications they want, what they consented to.
 *     It is per-user server state and it survives a reload on any device.
 *   - **`localStorage`** for what is true of *this browser* — reduced motion,
 *     editor density, text size. Syncing those would be wrong: a setting made
 *     because of one screen should not follow you to a different one.
 *
 * The prototype draws both kinds identically, so this says which is which at
 * the point each is declared rather than leaving it to be guessed.
 */

/* ── per-account (syncs) ─────────────────────────────────────────────── */

export function useAccountPrefs<T extends Record<string, unknown>>(key: string, fallback: T) {
  const { user, isLoaded } = useUser();
  const stored = ((user?.unsafeMetadata as Record<string, unknown> | undefined)?.[key] ?? {}) as Partial<T>;
  const [draft, setDraft] = useState<T>({ ...fallback, ...stored });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded) setDraft({ ...fallback, ...stored });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, JSON.stringify(stored)]);

  const save = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    setNote(null);
    try {
      await user.update({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), [key]: draft } });
      setNote('Saved.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That did not save.');
    }
    setBusy(false);
  }, [user, key, draft]);

  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...fallback, ...stored });

  return {
    prefs: draft,
    set: (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch })),
    reset: () => setDraft({ ...fallback, ...stored }),
    save,
    busy,
    note,
    dirty,
    ready: isLoaded,
  };
}

/* ── per-browser (does not sync) ─────────────────────────────────────── */

export function useLocalPrefs<T extends Record<string, unknown>>(key: string, fallback: T) {
  const [prefs, setPrefs] = useState<T>(fallback);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setPrefs({ ...fallback, ...(JSON.parse(raw) as Partial<T>) });
    } catch {
      /* Private mode, or corrupt JSON. The defaults are the safe side. */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (patch: Partial<T>) => {
      setPrefs((d) => {
        const next = { ...d, ...patch };
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* Nothing to do — the setting still applies for this session. */
        }
        return next;
      });
    },
    [key],
  );

  return { prefs, set };
}
