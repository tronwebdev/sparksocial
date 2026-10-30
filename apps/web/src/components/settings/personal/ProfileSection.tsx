'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { notify } from '@/lib/notify';
import { SettingsSaveBar } from '../SettingsShell';
import { Busy, SparkLoader } from '@/components/brand/SparkLoader';
import { PersonalField, PersonalSelect } from './fields';
import { guessTimezone, zonesIncluding } from '@sparksocial/shared';

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

/** What the hint under the button promises: "PNG, JPG up to 4MB". */
const PHOTO_TYPES = ['image/png', 'image/jpeg'];
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function uploadPhoto(file: File) {
    if (!user) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError('That file is not a PNG or JPG.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoError('That image is over 4MB.');
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await user.setProfileImage({ file });
      // The resource re-reads itself, so every screen holding `useUser()`
      // picks up the new `imageUrl` without a reload.
      await user.reload();
      notify.success('Profile photo updated');
    } catch (e) {
      notify.error('Couldn’t upload that photo', { body: e instanceof Error ? e.message : 'That photo did not upload.' });
    }
    setPhotoBusy(false);
  }

  async function removePhoto() {
    if (!user) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
      notify.success('Profile photo removed');
    } catch (e) {
      notify.error('Couldn’t remove your photo', { body: e instanceof Error ? e.message : 'That photo was not removed.' });
    }
    setPhotoBusy(false);
  }
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(initial), [initial]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    if (!user) return;
    setBusy(true);
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
      notify.success('Profile saved');
    } catch (e) {
      notify.error('Couldn’t save your profile', { body: e instanceof Error ? e.message : 'That did not save.' });
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
    return <SparkLoader size="panel" label="Loading your profile…" />;
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
            // `hasImage`, not `imageUrl`: Clerk always returns a URL, a generated
            // placeholder when nobody has uploaded, and that read as "you have a
            // photo" and hid the monogram.
            background: user?.hasImage
              ? `url('${user.imageUrl}') center/cover no-repeat`
              : 'linear-gradient(180deg, rgb(12,12,12) 0%, rgb(114,114,114) 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 0 4px #FFFFFF',
          }}
        >
          {user?.hasImage ? null : (
            <span className="text-64 font-medium leading-none text-white">{monogram}</span>
          )}
          {photoBusy ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-15 font-medium text-white">
              <Busy size={16}>Saving…</Busy>
            </span>
          ) : null}
        </span>

        <div className="mb-[8px]">
          <div className="flex items-center gap-[10px]">
            {/*
              Upload opened Clerk's profile dialog by dispatching
              `spark:open-user-profile` — an event nothing listened for, so the
              button did nothing at all. It is a file picker now, straight into
              `user.setProfileImage`: Clerk still stores and serves the image,
              and every `useUser()` reader (the sidebar's plan card, the brands
              page's chip) re-renders with it.
            */}
            <input
              ref={fileRef}
              type="file"
              accept={PHOTO_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadPhoto(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="flex h-[40px] w-[100px] items-center justify-center rounded-[8.863px] bg-white text-17 font-medium transition-colors hover:bg-surface-200 disabled:opacity-60"
              style={{ boxShadow: 'inset 0 0 0 0.591px rgba(131,131,131,0.2), 0 4px 40px rgba(0,0,0,0.15)', color: 'rgb(131,131,131)' }}
            >
              Upload
            </button>
            {user?.hasImage ? (
              <button
                type="button"
                onClick={() => void removePhoto()}
                disabled={photoBusy}
                className="flex h-[40px] items-center justify-center rounded-[8.863px] px-[14px] text-17 font-medium transition-colors hover:bg-white disabled:opacity-60"
                style={{ color: 'rgb(131,131,131)' }}
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-[10px] text-16" style={{ color: photoError ? '#E5484D' : 'rgb(131,131,131)' }} role={photoError ? 'alert' : undefined}>
            {photoError ?? 'PNG, JPG up to 4MB. Square images work best.'}
          </p>
        </div>
      </div>

      {/*
        ── the field grid ─────────────────────────────────────────────────

        A `min-w-[Npx] flex-1` column is a floor, not a width: it tells the row
        to wrap rather than let a field get too narrow, which is right on a wide
        screen and is content loss on a phone. Measured on the deployed
        `/settings/profile` at 430px: 29 elements past the viewport, the row
        ending at 491, because a 420px floor cannot fit a 374px content column
        however the row wraps.

        Below `canvas` every such column takes a full row instead —
        `max-cq-canvas:min-w-0 max-cq-canvas:basis-full`, applied to all 31 of them
        across the app. `min-w-0` matters as much as the basis: without it the
        column's own content re-inflates it past the row it was given.
      */}
      <div className="mt-[30px] flex flex-wrap gap-[26px]">
        <div className="min-w-[420px] flex-[2] max-cq-canvas:min-w-0 max-cq-canvas:basis-full space-y-[22px]">
          <div className="flex flex-wrap gap-[22px]">
            <PersonalField label="First Name" className="min-w-[240px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
              <input
                value={form.first}
                onChange={(e) => set({ first: e.target.value })}
                aria-label="First name"
                className="h-full w-full bg-transparent px-[26px] text-18 font-medium text-ink outline-none"
              />
            </PersonalField>
            <PersonalField label="Last Name" className="min-w-[240px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
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
            <PersonalField label="Timezone" className="min-w-[240px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
              <PersonalSelect
                value={form.timezone ?? ''}
                onChange={(v) => set({ timezone: v })}
                aria-label="Timezone"
                /*
                 * Every zone, not the seven that happened to be listed here.
                 * `zonesIncluding` keeps whatever the person already has
                 * selectable even when it is an `Etc/*` alias that
                 * `supportedValuesOf` omits — which is what the old
                 * `resolvedOptions()` entry in this list was reaching for.
                 */
                options={zonesIncluding(form.timezone || guessTimezone())}
              />
            </PersonalField>
            <PersonalField label="Pronouns" className="min-w-[240px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full">
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

        <div className="min-w-[320px] flex-1 max-cq-canvas:min-w-0 max-cq-canvas:basis-full space-y-[22px]">
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
        onCancel={() => setForm(initial)}
        busy={busy}
        dirty={dirty}
      />
    </>
  );
}
