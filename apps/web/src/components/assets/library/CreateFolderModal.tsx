'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/common/ModalShell';
import { invoke } from '@/lib/tools';
import { AssignmentNote, MemberChecklist, useTeam } from './FolderMembers';

/**
 * `Create Folder Modal` — `SparkSocial Assets Library.dc.html`.
 *
 *   panel      509,255 · 710x560 at radius 28 on
 *              `linear-gradient(180deg,#FCFCFD,#F3F4F7)`
 *   close      right 30 / top 30 · 36x36, `#B0B0B0` cross
 *   title      centred at 74, 30px/700
 *   label      120,168 · 18px/500 "Folder Name"
 *   input      120,202 · 470x72 r14 white, px26, 18px/500, under
 *              `0 10px 30px -22px rgba(12,12,12,.35)` and a
 *              `rgba(131,131,131,.12)` hairline
 *   members    120,306 label; 120,340 · 470x72 row with a 44px avatar
 *   footer     centred at 474, gap 26 — Cancel (h52 r11 on
 *              `rgba(255,255,255,.6)` in a 1.2px ring) and Save (h52 r11,
 *              18px/600 with a chevron)
 *
 * ── Assign Team members ──────────────────────────────────────────────────
 *
 * The prototype's row toasts "Team members — mock". It was drawn here disabled,
 * with the note that no tool assigned a person to a folder — true at the time.
 * `asset.folder.member.set` is that tool now, so the row is a real checklist.
 *
 * Two things it deliberately is not: it is not an access control (every folder
 * stays visible to everybody on the brand — retrieval is scoped by genome, not
 * by folder), and it does not touch brand membership. See `FolderMembers`.
 *
 * The assignment is applied *after* the folder exists, because it needs the new
 * folder's id. A failure there leaves the folder created and unassigned rather
 * than rolling back something the person just watched succeed — and it says so.
 */

export function CreateFolderModal({
  genomeId,
  onClose,
  onCreated,
}: {
  genomeId: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const { team, error: teamError } = useTeam();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    /* The prototype falls back to "My New Folder" on an empty field; the tool
       requires `min(1)`, so the same default is applied before the call rather
       than sending an empty string and reading back a validation error. */
    const folderName = name.trim() || 'My New Folder';
    setBusy(true);
    setError(null);
    /* `asset.folder.create` is `idempotent: false` — two folders of the same
       name are two folders, so `invoke` refuses the call without a key. A fresh
       one per press: pressing Save twice deliberately is two folders, and a
       retried *request* is one. */
    const res = await invoke<{ folderId: string; name: string }>(
      'asset.folder.create',
      { genomeId, name: folderName },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'That request was gated.');
      return;
    }
    if (members.length > 0) {
      /* Applied after the create, because it needs the id the create returns.
         `idempotent: true`, so no key. A failure here leaves a real folder with
         nobody on it — said out loud rather than silently swallowed, because
         the folder is not going away. */
      const assigned = await invoke('asset.folder.member.set', {
        genomeId,
        folderId: res.output.folderId,
        userIds: members,
      });
      if (assigned.status !== 'succeeded') {
        setError(
          `Folder created, but the people could not be assigned: ${
            assigned.status === 'failed' ? assigned.error.message : 'that request was gated.'
          } Use the folder's ⋯ menu to try again.`,
        );
        return;
      }
    }
    onCreated(res.output.name);
  }

  return (
    <ModalShell
      top={255}
      height={640}
      width={710}
      radius={28}
      background="var(--ss-grad-lib-create)"
      label="Create a new folder"
      onClose={onClose}
    >
      <p className="pt-[74px] text-center text-[30px] font-bold text-ink">Create New Folder</p>

      <div className="px-[120px] pt-[36px]">
        <label htmlFor="lib-folder-name" className="block text-18 font-medium text-ink">
          Folder Name
        </label>
        <input
          id="lib-folder-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          placeholder="My New Folder"
          className="mt-[10px] h-[72px] w-full rounded-[14px] bg-white px-[26px] text-18 font-medium text-ink outline-none placeholder:text-[#B0B0B0]"
          style={{ boxShadow: '0 10px 30px -22px rgba(12,12,12,0.35), inset 0 0 0 1px rgba(131,131,131,0.12)' }}
        />

        <p className="mt-[26px] text-18 font-medium text-ink">Assign Team members</p>
        <div className="mt-[10px] max-h-[150px] overflow-y-auto">
          <MemberChecklist
            team={team}
            error={teamError}
            selected={members}
            onToggle={(id) =>
              setMembers((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
            }
            emptyHint="Nobody else is in this workspace yet. Invite people in Settings → Team."
          />
        </div>
        <AssignmentNote />

        {error ? <p className="mt-[14px] text-15 text-destructive">{error}</p> : null}
      </div>

      <div className="mt-[34px] flex items-center justify-center gap-[26px]">
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] items-center gap-[11px] rounded-[11px] px-[22px] transition-colors hover:bg-white"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 0 0 1.2px rgba(131,131,131,0.4)' }}
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path d="m1.5 1.5 12 12m0-12-12 12" stroke="#838383" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span className="text-17 font-medium" style={{ color: '#838383' }}>
            Cancel
          </span>
        </button>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="flex h-[52px] items-center gap-[22px] rounded-[11px] px-[18px] transition-colors hover:bg-[rgba(255,255,255,0.7)] active:scale-[0.985] disabled:opacity-60"
        >
          <span className="text-18 font-semibold text-ink">{busy ? 'Saving…' : 'Save'}</span>
          <svg width="9" height="16" viewBox="0 0 8 16" fill="none" aria-hidden>
            <path d="m1 1 6 7-6 7" stroke="#0C0C0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </ModalShell>
  );
}
