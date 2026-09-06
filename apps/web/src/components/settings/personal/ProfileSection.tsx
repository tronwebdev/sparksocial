'use client';

import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { SettingsSaveBar } from '../SettingsShell';
import { PersonalField, PersonalSelect } from './fields';

/**
 * `Settings PS Profile`.
 *
 *   banner    368,255 · 1295x198 r20
 *   avatar    411,381 · 143x143 r1000 on a `#0C0C0C → #727272` vertical ramp,
 *             with a 64.081/500 monogram, Upload 100x40 r8.863 beside it and
 *             "PNG, JPG up to 4MB. Square images work best." at 159,101
 *   fields    two 346x94 columns at x=411 and 777, a 712x93 pair beneath, and
 *             a 477-wide Bio + Title column at x=1145 — every box 63 tall,
 *             r10, `inset 0 0 0 1px rgba(131,131,131,0.2)`, label 18/500
 *   footer    Cancel 147.869x44.809 and Save 167.585x44.809 at y=1114.596
 *
 * ── Where these fields live ───────────────────────────────────────────────
 *
 * The account is Clerk's, so first and last name and the avatar are Clerk's own
 * fields and are written through `user.update`. Bio, website, title, pronouns
 * and timezone have no column anywhere in the product's own schema — they are
 * about the *person*, not the brand — so they go in Clerk's `unsafeMetadata`,
 * which is what it is for. That is real storage that survives a reload, not a
 * local draft.
 *
 * The email address is deliberately read-only here. Changing it is a
 * verification flow Clerk owns end to end, and a field that looked editable and
 * then bounced you to another screen would be worse than one that says so.
 */

interface Meta {
  bio?: string;
  website?: string;
  title?: string;
  pronouns?: string;
  timezone?: string;
}

const PRONOUNS = ['', 'She/Her', 'He/Him', 'They/Them', 'Prefer not to say'];

export function ProfileSection() {
  const { user, isLoaded } = useUser();

  const initial = useMemo<Meta & { first: string; last: string }>(() => {
    const m = (user?.unsafeMetadata ?? {}) as Meta;
    return {
      first: user?.firstName ?? '',
      last: user?.lastName ?? '',
      bio: m.bio ?? '',
      website: m.website ?? '',
      title: m.title ?? '',
      pronouns: m.pronouns ?? '',
      timezone: m.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }, [user]);

  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setForm(initial), [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!user) return;
    setBusy(true);
    setNote(null);
    try {
      await user.update({
        firstName: form.first,
        lastName: form.last,
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          bio: form.bio,
          website: form.website,
          title: form.title,
          pronouns: form.pronouns,
          timezone: form.timezone,
        },
      });
      setNote('Saved.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That did not save.');
    }
    setBusy(false);
  }

  const monogram =
    `${form.first.slice(0, 1)}${form.last.slice(0, 1)}`.toUpperCase() ||
    (user?.primaryEmailAddress?.emailAddress ?? '?').slice(0, 2).toUpperCase();

  const localTime = (() => {
    try {
      return new Date().toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: form.timezone });
    } catch {
      return new Date().toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    }
  })();

  if (!isLoaded) {
    return <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>Loading your profile…</p>;
  }

  return (
    <>
      {/* The design's 1295x198 banner. */}
      <div
        aria-hidden
        className="h-[198px] rounded-xl"
        style={{
          background:
            'linear-gradient(135deg, rgba(108,232,255,0.55) 0%, rgba(245,107,255,0.35) 48%, rgba(254,222,181,0.6) 100%)',
        }}
      />

      {/* avatar row — the design overlaps it onto the banner. */}
      <div className="-mt-[62px] flex flex-wrap items-end gap-[16px] px-[6px]">
        <span
          className="relative flex h-[143px] w-[143px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center"
          style={{
            background: user?.imageUrl
              ? `url('${user.imageUrl}') center/cover no-repeat`
              : 'linear-gradient(180deg, rgb(12,12,12) 0%, rgb(114,114,114) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 0 4px #FFFFFF',
          }}
        >
          {user?.imageUrl ? null : (
            <span className="text-[64.081px] font-medium leading-none text-white">{monogram}</span>
          )}
        </span>

        <div className="mb-[8px]">
          <div className="flex items-center gap-[10px]">
            {/*
              Clerk owns the avatar upload — it validates, crops and stores it,
              and re-implementing that against `user.setProfileImage` would mean
              owning the failure cases too. This opens the same dialog.
            */}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('spark:open-user-profile'));
              }}
              className="flex h-[40px] w-[100px] items-center justify-center rounded-[8.863px] bg-white text-[16.839px] font-medium transition-colors hover:bg-surface-200"
              style={{ boxShadow: 'inset 0 0 0 0.591px rgba(131,131,131,0.2), 0 4px 40px rgba(0,0,0,0.15)', color: 'rgb(131,131,131)' }}
            >
              Upload
            </a>
          </div>
          <p className="mt-[10px] text-16" style={{ color: 'rgb(131,131,131)' }}>
            PNG, JPG up to 4MB. Square images work best.
          </p>
        </div>
      </div>

      {/* ── the field grid ─────────────────────────────────────────────── */}
      <div className="mt-[30px] flex flex-wrap gap-[26px]">
        <div className="min-w-[420px] flex-[2] space-y-[22px]">
          <div className="flex flex-wrap gap-[22px]">
            <PersonalField label="First Name" className="min-w-[240px] flex-1">
              <input
                value={form.first}
                onChange={(e) => set({ first: e.target.value })}
                aria-label="First name"
                className="h-full w-full bg-transparent px-[26px] text-18 font-medium text-ink outline-none"
              />
            </PersonalField>
            <PersonalField label="Last Name" className="min-w-[240px] flex-1">
              <input
                value={form.last}
                onChange={(e) => set({ last: e.target.value })}
                aria-label="Last name"
                className="h-full w-full bg-transparent px-[26px] text-18 font-medium text-ink outline-none"
              />
            </PersonalField>
          </div>

          <PersonalField label="Email Address" hint="Changing this is a verification flow your account provider owns.">
            <input
              value={user?.primaryEmailAddress?.emailAddress ?? ''}
              readOnly
              aria-label="Email address"
              className="h-full w-full cursor-not-allowed bg-transparent px-[26px] text-18 font-medium outline-none"
              style={{ color: 'rgb(131,131,131)' }}
            />
          </PersonalField>

          <PersonalField label="Website URL">
            <input
              value={form.website ?? ''}
              onChange={(e) => set({ website: e.target.value })}
              placeholder="https://"
              inputMode="url"
              aria-label="Website URL"
              className="h-full w-full bg-transparent px-[26px] text-18 font-medium text-ink outline-none"
            />
          </PersonalField>

          <div className="flex flex-wrap gap-[22px]">
            <PersonalField label="Timezone" className="min-w-[240px] flex-1">
              <PersonalSelect
                value={form.timezone ?? ''}
                onChange={(v) => set({ timezone: v })}
                aria-label="Timezone"
                options={Array.from(
                  new Set([
                    form.timezone ?? '',
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                    'UTC',
                    'America/Los_Angeles',
                    'America/New_York',
                    'Europe/London',
                    'Europe/Berlin',
                    'Africa/Lagos',
                    'Asia/Singapore',
                    'Australia/Sydney',
                  ]),
                ).filter(Boolean)}
              />
            </PersonalField>
            <PersonalField label="Pronouns" className="min-w-[240px] flex-1">
              <PersonalSelect
                value={form.pronouns ?? ''}
                onChange={(v) => set({ pronouns: v })}
                aria-label="Pronouns"
                options={PRONOUNS}
                placeholder="Not set"
              />
            </PersonalField>
          </div>

          <p className="text-16" style={{ color: 'rgb(131,131,131)' }}>
            <span className="font-medium">Local time:</span> {localTime} — used for deadlines, schedules, and digests.
          </p>
        </div>

        <div className="min-w-[320px] flex-1 space-y-[22px]">
          <div>
            <label className="block text-18 font-medium" style={{ color: 'rgb(131,131,131)' }}>
              Bio (Optional)
            </label>
            <textarea
              value={form.bio ?? ''}
              onChange={(e) => set({ bio: e.target.value })}
              rows={7}
              className="mt-[10px] h-[199px] w-full resize-none rounded bg-white px-[22px] py-[16px] text-18 font-medium text-ink outline-none"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
            />
          </div>

          <PersonalField label="Title">
            <input
              value={form.title ?? ''}
              onChange={(e) => set({ title: e.target.value })}
              aria-label="Title"
              placeholder="Head of Marketing"
              className="h-full w-full bg-transparent px-[26px] text-18 font-medium text-ink outline-none"
            />
          </PersonalField>
        </div>
      </div>

      <SettingsSaveBar
        onSave={() => void save()}
        onCancel={() => {
          setForm(initial);
          setNote(null);
        }}
        busy={busy}
        dirty={dirty}
        note={note}
      />
    </>
  );
}
