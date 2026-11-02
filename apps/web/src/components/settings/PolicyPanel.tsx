'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, DateField, FieldLabel, SelectField, TextField, ToggleChip } from '@/components/ui/field';
import { invoke } from '@/lib/tools';
import { notifyResult } from '@/lib/notify';
import { Busy } from '@/components/brand/SparkLoader';

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
  permissions: {
    spendCredits?: boolean;
    automationAutoPublish?: boolean;
    requireApprovalForMedia?: boolean;
  } | null;
  publishRoles: string[] | null;
  maxPendingReview: number | null;
}

/**
 * §6's "Publish permission (per role)". Only the roles a publish tool could
 * ever be granted to — `publish.now` declares `['owner','admin','editor']`, and
 * `policy.ts` rule 2 refuses anything outside that regardless of what is set
 * here, so offering `approver`/`viewer`/`client` would be offering a choice that
 * cannot take effect.
 */
const PUBLISH_ROLES = ['owner', 'admin', 'editor'] as const;

export function PolicyPanel() {
  const [loading, setLoading] = useState(true);
  const [restrictedPlatforms, setRestrictedPlatforms] = useState<string[]>([]);
  const [contentTypesText, setContentTypesText] = useState('');
  const [spendCredits, setSpendCredits] = useState(true);
  const [automationAutoPublish, setAutomationAutoPublish] = useState(true);
  const [requireApprovalForMedia, setRequireApprovalForMedia] = useState(false);
  const [publishRoles, setPublishRoles] = useState<string[]>([]);
  const [maxPendingReview, setMaxPendingReview] = useState('');
  const [quietWindows, setQuietWindows] = useState<QuietWindow[]>([]);
  const [newWindow, setNewWindow] = useState({ from: '', to: '', reason: '' });
  const [familyOverrides, setFamilyOverrides] = useState<Record<string, string>>({});
  const [newFamily, setNewFamily] = useState({ family: '', autonomy: AUTONOMY_OPTIONS[1] as string });
  const [busy, setBusy] = useState(false);

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
      setRequireApprovalForMedia(p.permissions?.requireApprovalForMedia ?? false);
      setPublishRoles(p.publishRoles ?? []);
      setMaxPendingReview(p.maxPendingReview === null ? '' : String(p.maxPendingReview));
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
    const contentTypes = contentTypesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await invoke<{ policy: Policy }>('approval.policy.set', {
      restrictedPlatforms: restrictedPlatforms.length ? restrictedPlatforms : null,
      restrictedContentTypes: contentTypes.length ? contentTypes : null,
      permissions: { spendCredits, automationAutoPublish, requireApprovalForMedia },
      // Empty means "the tool's own scopes stand" — a cleared list must not read
      // as "nobody may publish", which would take a brand down from a
      // settings screen.
      publishRoles: publishRoles.length ? publishRoles : null,
      maxPendingReview: Number(maxPendingReview) > 0 ? Number(maxPendingReview) : null,
      quietWindows: quietWindows.length
        ? quietWindows.map((w) => ({ from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), reason: w.reason }))
        : null,
      familyOverrides: Object.keys(familyOverrides).length ? familyOverrides : null,
    });
    setBusy(false);
    notifyResult(res, 'Policy saved', 'Couldn’t save the policy');
  }

  if (loading) return null;

  return (
    <section className="rounded-[16px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] bg-white p-6 max-sm:p-4">
      <h2 className="text-18 font-semibold text-ink">Escalation policy</h2>
      <p className="mt-1 text-13 text-ink-muted">
        Finer-grained rules on top of the approval mode above — platforms/content types that always need review,
        publishing freeze windows, spend/automation permissions, and per tool-family autonomy overrides.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-5">
        <div>
          <p className="text-13 font-medium text-ink">Always require review for</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <ToggleChip
                key={p}
                pressed={restrictedPlatforms.includes(p)}
                announce={false}
                onClick={() => togglePlatform(p)}
                className="capitalize"
              >
                {p.replace('_', ' ')}
              </ToggleChip>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="policy-content-types">Restricted content types (comma-separated)</FieldLabel>
          <TextField
            id="policy-content-types"
            value={contentTypesText}
            onChange={(e) => setContentTypesText(e.target.value)}
            placeholder="e.g. ai_ugc_testimonial, offer_availability"
          />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex cursor-pointer items-center gap-2.5 text-14 font-medium text-ink">
            <Checkbox checkSize="sm" checked={spendCredits} onChange={(e) => setSpendCredits(e.target.checked)} />
            Allow spending credits
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-14 font-medium text-ink">
            <Checkbox checkSize="sm" checked={automationAutoPublish} onChange={(e) => setAutomationAutoPublish(e.target.checked)} />
            Allow automation recipes to autopublish
          </label>
          {/* PRD §6's fifth permission control, and the one guarding the money:
              an avatar video is 50¢ a call and a dub 60¢. Distinct from the
              spend cap, which answers "can we afford it" rather than "should a
              person look first". */}
          <label className="flex cursor-pointer items-center gap-2.5 text-14 font-medium text-ink">
            <Checkbox
              checkSize="sm"
              checked={requireApprovalForMedia}
              onChange={(e) => setRequireApprovalForMedia(e.target.checked)}
            />
            Approve before generating video, images or voice
          </label>
        </div>

        {/* PRD §6: "Publish permission (per role)" */}
        <div>
          <p className="text-13 font-medium text-ink">Who may publish</p>
          <p className="mt-0.5 text-12 text-ink-muted">
            {publishRoles.length === 0
              ? 'Anyone who can create drafts can also publish them.'
              : `Only ${publishRoles.join(', ')}. Everyone else can draft and schedule.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PUBLISH_ROLES.map((r) => {
              const on = publishRoles.includes(r);
              return (
                <ToggleChip
                  key={r}
                  pressed={on}
                  onClick={() =>
                    setPublishRoles((prev) =>
                      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
                    )
                  }
                  className="capitalize"
                >
                  {r}
                </ToggleChip>
              );
            })}
          </div>
        </div>

        {/* PRD §10: queue caps, the mitigation for "automation floods calendars" */}
        <div className="max-w-xs">
          <FieldLabel htmlFor="policy-queue-cap" className="mb-0">
            Stop SPARK when this many items await review
          </FieldLabel>
          <p className="mt-0.5 text-12 text-ink-muted">
            Leave empty for no limit. You can always keep clearing the queue yourself — this only stops
            SPARK adding to it.
          </p>
          <TextField
            id="policy-queue-cap"
            value={maxPendingReview}
            inputMode="numeric"
            onChange={(e) => setMaxPendingReview(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 25"
            className="mt-[9px] tabular-nums"
          />
        </div>

        <div>
          <p className="text-13 font-medium text-ink">Quiet windows (publishing frozen)</p>
          {quietWindows.map((w, i) => (
            <div key={i} className="mt-1 flex items-center justify-between rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] px-2 py-1.5 text-12 text-ink-muted">
              <span>
                {new Date(w.from).toLocaleString()} → {new Date(w.to).toLocaleString()} — {w.reason}
              </span>
              <button type="button" onClick={() => setQuietWindows((prev) => prev.filter((_, j) => j !== i))} className="text-destructive">
                Remove
              </button>
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {/* A filter-row: `sm` controls, and the default 44px button beside
                them so the row shares one baseline. */}
            <DateField
              type="datetime-local"
              fieldSize="sm"
              value={newWindow.from}
              onChange={(e) => setNewWindow((w) => ({ ...w, from: e.target.value }))}
              className="w-[236px] max-cq-canvas:w-full"
            />
            <DateField
              type="datetime-local"
              fieldSize="sm"
              value={newWindow.to}
              onChange={(e) => setNewWindow((w) => ({ ...w, to: e.target.value }))}
              className="w-[236px] max-cq-canvas:w-full"
            />
            <TextField
              fieldSize="sm"
              value={newWindow.reason}
              onChange={(e) => setNewWindow((w) => ({ ...w, reason: e.target.value }))}
              placeholder="reason"
              className="w-auto min-w-[140px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full"
            />
            <Button variant="secondary" onClick={addWindow}>
              Add window
            </Button>
          </div>
        </div>

        <div>
          <p className="text-13 font-medium text-ink">Tool-family autonomy overrides</p>
          {Object.entries(familyOverrides).map(([family, autonomy]) => (
            <div key={family} className="mt-1 flex items-center justify-between rounded-[10px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)] px-2 py-1.5 text-12 text-ink-muted">
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
            <TextField
              fieldSize="sm"
              value={newFamily.family}
              onChange={(e) => setNewFamily((f) => ({ ...f, family: e.target.value }))}
              placeholder="e.g. content, publish, learning"
              className="w-auto min-w-[140px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full"
            />
            <SelectField
              fieldSize="sm"
              value={newFamily.autonomy}
              onChange={(e) => setNewFamily((f) => ({ ...f, autonomy: e.target.value }))}
              className="w-[160px]"
            >
              {AUTONOMY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectField>
            <Button variant="secondary" onClick={addFamilyOverride}>
              Add override
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? <Busy>Saving…</Busy> : 'Save'}
        </Button>
      </div>
    </section>
  );
}
