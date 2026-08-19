'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/tools';

/**
 * `approval.policy.get`/`.set` — real since 17 Aug 2026, reached from no
 * screen until now. Five fields on top of the three-rung approval mode
 * (`ApprovalModeControl.tsx`, Command Center): per-family autonomy
 * overrides, restricted platforms/content types, publishing freeze windows,
 * and spend/automation permission toggles — `policy.ts`'s own `evaluate()`
 * has read every one of these since P1, but `makeBrandGovernance` never
 * forwarded them, so they were permanently `undefined` in production until
 * this pair existed at all.
 *
 * Saves send the full current state on every call rather than tracking
 * which of the five fields actually changed — `approval.policy.set`
 * requires at least one field and treats `null` as "clear this," so
 * sending all five together is simplest and always valid, at the cost of
 * occasionally re-writing a field that didn't change.
 */

const PLATFORMS = ['instagram', 'tiktok', 'linkedin', 'x', 'youtube_shorts'] as const;
const AUTONOMY_OPTIONS = ['auto', 'confirm', 'approval', 'human_only'] as const;

interface QuietWindow {
  from: string;
  to: string;
  reason: string;
}

interface Policy {
  familyOverrides: Record<string, string> | null;
  restrictedPlatforms: string[] | null;
  restrictedContentTypes: string[] | null;
  quietWindows: QuietWindow[] | null;
  permissions: { spendCredits?: boolean; automationAutoPublish?: boolean } | null;
}

export function PolicyPanel() {
  const [loading, setLoading] = useState(true);
  const [restrictedPlatforms, setRestrictedPlatforms] = useState<string[]>([]);
  const [contentTypesText, setContentTypesText] = useState('');
  const [spendCredits, setSpendCredits] = useState(true);
  const [automationAutoPublish, setAutomationAutoPublish] = useState(true);
  const [quietWindows, setQuietWindows] = useState<QuietWindow[]>([]);
  const [newWindow, setNewWindow] = useState({ from: '', to: '', reason: '' });
  const [familyOverrides, setFamilyOverrides] = useState<Record<string, string>>({});
  const [newFamily, setNewFamily] = useState({ family: '', autonomy: AUTONOMY_OPTIONS[1] as string });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Policy>('approval.policy.get', {});
      setLoading(false);
      if (res.status !== 'succeeded') return;
      const p = res.output;
      setRestrictedPlatforms(p.restrictedPlatforms ?? []);
      setContentTypesText((p.restrictedContentTypes ?? []).join(', '));
      setSpendCredits(p.permissions?.spendCredits ?? true);
      setAutomationAutoPublish(p.permissions?.automationAutoPublish ?? true);
      setQuietWindows(p.quietWindows ?? []);
      setFamilyOverrides(p.familyOverrides ?? {});
    })();
  }, []);

  function togglePlatform(platform: string) {
    setRestrictedPlatforms((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));
  }

  function addWindow() {
    if (!newWindow.from || !newWindow.to || !newWindow.reason.trim()) return;
    setQuietWindows((prev) => [...prev, { ...newWindow, reason: newWindow.reason.trim() }]);
    setNewWindow({ from: '', to: '', reason: '' });
  }

  function addFamilyOverride() {
    if (!newFamily.family.trim()) return;
    setFamilyOverrides((prev) => ({ ...prev, [newFamily.family.trim()]: newFamily.autonomy }));
    setNewFamily({ family: '', autonomy: AUTONOMY_OPTIONS[1] });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const contentTypes = contentTypesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await invoke<{ policy: Policy }>('approval.policy.set', {
      restrictedPlatforms: restrictedPlatforms.length ? restrictedPlatforms : null,
      restrictedContentTypes: contentTypes.length ? contentTypes : null,
      permissions: { spendCredits, automationAutoPublish },
      quietWindows: quietWindows.length
        ? quietWindows.map((w) => ({ from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), reason: w.reason }))
        : null,
      familyOverrides: Object.keys(familyOverrides).length ? familyOverrides : null,
    });
    setBusy(false);
    if (res.status === 'succeeded') {
      setMessage({ kind: 'ok', text: 'Saved.' });
    } else {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
    }
  }

  if (loading) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Escalation policy</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Finer-grained rules on top of the approval mode above — platforms/content types that always need review,
        publishing freeze windows, spend/automation permissions, and per tool-family autonomy overrides.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5">
        <div>
          <p className="text-[13px] font-medium text-ink">Always require review for</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`rounded-full border px-3 py-1.5 text-[13px] capitalize ${
                  restrictedPlatforms.includes(p) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink hover:bg-surface-muted'
                }`}
              >
                {p.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink" htmlFor="policy-content-types">
            Restricted content types (comma-separated)
          </label>
          <input
            id="policy-content-types"
            value={contentTypesText}
            onChange={(e) => setContentTypesText(e.target.value)}
            placeholder="e.g. ai_ugc_testimonial, offer_availability"
            className="mt-1 h-9 w-full rounded border border-border bg-input px-2 text-[13px] text-ink placeholder:text-ink-placeholder"
          />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={spendCredits} onChange={(e) => setSpendCredits(e.target.checked)} />
            Allow spending credits
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={automationAutoPublish} onChange={(e) => setAutomationAutoPublish(e.target.checked)} />
            Allow automation recipes to autopublish
          </label>
        </div>

        <div>
          <p className="text-[13px] font-medium text-ink">Quiet windows (publishing frozen)</p>
          {quietWindows.map((w, i) => (
            <div key={i} className="mt-1 flex items-center justify-between rounded border border-border px-2 py-1.5 text-[12px] text-ink-muted">
              <span>
                {new Date(w.from).toLocaleString()} → {new Date(w.to).toLocaleString()} — {w.reason}
              </span>
              <button type="button" onClick={() => setQuietWindows((prev) => prev.filter((_, j) => j !== i))} className="text-destructive">
                Remove
              </button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              type="datetime-local"
              value={newWindow.from}
              onChange={(e) => setNewWindow((w) => ({ ...w, from: e.target.value }))}
              className="h-9 rounded border border-border bg-input px-2 text-[12px] text-ink"
            />
            <input
              type="datetime-local"
              value={newWindow.to}
              onChange={(e) => setNewWindow((w) => ({ ...w, to: e.target.value }))}
              className="h-9 rounded border border-border bg-input px-2 text-[12px] text-ink"
            />
            <input
              value={newWindow.reason}
              onChange={(e) => setNewWindow((w) => ({ ...w, reason: e.target.value }))}
              placeholder="reason"
              className="h-9 min-w-[140px] flex-1 rounded border border-border bg-input px-2 text-[12px] text-ink placeholder:text-ink-placeholder"
            />
            <Button size="sm" variant="outline" onClick={addWindow}>
              Add window
            </Button>
          </div>
        </div>

        <div>
          <p className="text-[13px] font-medium text-ink">Tool-family autonomy overrides</p>
          {Object.entries(familyOverrides).map(([family, autonomy]) => (
            <div key={family} className="mt-1 flex items-center justify-between rounded border border-border px-2 py-1.5 text-[12px] text-ink-muted">
              <span>
                <b className="text-ink">{family}</b> — {autonomy}
              </span>
              <button
                type="button"
                onClick={() => setFamilyOverrides((prev) => { const next = { ...prev }; delete next[family]; return next; })}
                className="text-destructive"
              >
                Remove
              </button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={newFamily.family}
              onChange={(e) => setNewFamily((f) => ({ ...f, family: e.target.value }))}
              placeholder="e.g. content, publish, learning"
              className="h-9 min-w-[140px] flex-1 rounded border border-border bg-input px-2 text-[12px] text-ink placeholder:text-ink-placeholder"
            />
            <select
              value={newFamily.autonomy}
              onChange={(e) => setNewFamily((f) => ({ ...f, autonomy: e.target.value }))}
              className="h-9 rounded border border-border bg-surface px-2 text-[12px] text-ink"
            >
              {AUTONOMY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={addFamilyOverride}>
              Add override
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {message ? <span className={`text-[13px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>{message.text}</span> : null}
      </div>
    </section>
  );
}
