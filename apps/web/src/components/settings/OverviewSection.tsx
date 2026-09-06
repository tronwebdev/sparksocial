'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { SettingsSaveBar } from './SettingsShell';

/**
 * `Settings WS Overview`, measured off the prototype's own DOM.
 *
 * All offsets below are relative to the 1350-wide content card at 337,143:
 *
 *   banner       8,8 · 1334x198 r20 on a flat `#B7F1FC`
 *   brand mark   47,82 · 184x186 r50% — straddles the banner's bottom edge
 *   pencil       right 24, top 25 · 39x39 r96.469 white
 *   name         50,291 · 560x37 · 28.633/600
 *   avatars      50,348 · 39x39 on a 26 pitch
 *   created      152,352 · 177x34 r75.111 · 15.317/500
 *   facts        796,256 / 302 / 344 · 19.285/500, label `rgba(131,131,131,.8)`
 *   compliant    1166,299 · 140x32 r88.266 on `#6CE8FF` · 19.285/500 + a tick
 *   fields       47,447 — two 672x98 blocks (an 18/500 label over a 672x62 r10
 *                box on `#F3F4F8`, its value inset 60 for a leading glyph) and
 *                a 543x213 Description column at x=752
 *
 * The hero is positioned absolutely because it genuinely is: the brand mark
 * overhangs the banner by 62px, and the right-hand facts start *above* the
 * name. No flow layout expresses that, so this block states its own
 * coordinates and scrolls sideways below the design's width rather than
 * reflowing into something the design never describes.
 *
 * ── Which of the three fields is real ─────────────────────────────────────
 *
 * Work Name is `brand.settings.patch`, whose entire input is a name.
 * Description is the genome's `one_liner` via `genome.identity.set` — the
 * sentence every playbook reads when it has to say what this brand does.
 * Workspace URL has no field anywhere, so it is shown disabled and says so
 * rather than silently discarding what you type.
 *
 * The design has no save bar on this screen. It needs one: two of these fields
 * write through tools, and saving on blur would be a worse surprise than a
 * button the prototype happens to omit.
 */

interface Governance {
  logoUrl?: string;
  brandColors: string[];
  timezone: string;
  agentIdentity: { name: string; voice: string[] };
  strictMode: boolean;
  restrictedTopics: string[];
  brandKit: { steps: Array<{ id: string; label: string; done: boolean }> };
}

interface Health {
  platforms: Array<{ platform: string; connected: boolean; supported: boolean }>;
}

/** `#F3F4F8` — the design's field fill, already in the ramp. */
const FIELD_BG = 'var(--ss-field-bg)';

export function OverviewSection() {
  const { genome } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [gov, setGov] = useState<Governance | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /* `brand.settings.patch` renames a *brand*, and `useSelectedGenome` carries
     only the genome — so the brandId comes off the same `genome.list` read. */
  const [brandId, setBrandId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [initial, setInitial] = useState({ name: '', oneLiner: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!genomeId) return;
    void (async () => {
      const [g, h, list] = await Promise.all([
        invoke<Governance>('brand.governance.get', {}),
        invoke<Health>('integration.health', {}),
        invoke<{ genomes: Array<{ genomeId: string; brandId: string; name: string; updatedAt: string }> }>(
          'genome.list',
          {},
        ),
      ]);
      if (g.status === 'succeeded') setGov(g.output);
      if (h.status === 'succeeded') setHealth(h.output);
      if (list.status === 'succeeded') {
        const row = list.output.genomes.find((x) => x.genomeId === genomeId);
        if (row) {
          setName(row.name);
          setInitial((s) => ({ ...s, name: row.name }));
          setUpdatedAt(row.updatedAt);
          setBrandId(row.brandId);
        }
      }
    })();
  }, [genomeId]);

  const dirty = name !== initial.name || oneLiner !== initial.oneLiner;

  async function save() {
    if (!genomeId) return;
    setBusy(true);
    setNote(null);

    if (name !== initial.name) {
      if (!brandId) {
        setBusy(false);
        setNote('Could not resolve this brand, so the rename was not attempted.');
        return;
      }
      const res = await invoke('brand.settings.patch', { brandId, name: name.trim() });
      if (res.status !== 'succeeded') {
        setBusy(false);
        setNote(res.status === 'failed' ? res.error.message : 'Renaming this brand needs an approval.');
        return;
      }
    }

    if (oneLiner !== initial.oneLiner && oneLiner.trim()) {
      const res = await invoke('genome.identity.set', { genomeId, identity: { one_liner: oneLiner.trim() } });
      if (res.status !== 'succeeded') {
        setBusy(false);
        setNote(res.status === 'failed' ? res.error.message : 'Saving the description needs an approval.');
        return;
      }
    }

    setBusy(false);
    setInitial({ name, oneLiner });
    setNote('Saved.');
  }

  const connected = health?.platforms.filter((p) => p.connected) ?? [];
  const kitDone = gov?.brandKit.steps.filter((s) => s.done).length ?? 0;
  const kitTotal = gov?.brandKit.steps.length ?? 0;
  const compliant = gov ? gov.strictMode : false;

  return (
    <div className="rounded-xl bg-white">
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="relative min-w-[1300px]">
          {/* ── banner ─────────────────────────────────────────────────── */}
          <div
            aria-hidden
            className="absolute left-[8px] right-[8px] top-[8px] h-[198px] rounded-xl"
            style={{ background: '#B7F1FC' }}
          />

          {/* The brand's own mark, straddling the banner's lower edge. */}
          <span
            aria-hidden
            className="absolute left-[47px] top-[82px] block h-[186px] w-[184px] rounded-full"
            style={{
              background: gov?.logoUrl
                ? `url('${gov.logoUrl}') center/cover no-repeat`
                : 'radial-gradient(circle at 50% 40%, #D6F1FF 0%, #A6D8FF 58%, #7FC3F7 100%)',
              boxShadow: '0 0 0 6px rgba(255,255,255,0.9)',
            }}
          />

          <Link
            href="/settings/brand-kits"
            aria-label="Edit the brand kit"
            className="absolute right-[24px] top-[25px] flex h-[39px] w-[39px] items-center justify-center rounded-full bg-white transition-colors hover:bg-surface-200"
          >
            <svg width="17" height="16" viewBox="0 0 17 16" fill="none" aria-hidden>
              <path d="M11.6 1.4 15 4.8 5.8 14H2.4v-3.4L11.6 1.4Z" stroke="rgb(131,131,131)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </Link>

          {/* ── identity ───────────────────────────────────────────────── */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Brand name"
            placeholder="This brand"
            maxLength={120}
            className="absolute left-[50px] top-[291px] h-[37px] w-[560px] bg-transparent text-[28.633px] font-semibold leading-[1.28] text-ink outline-none"
          />

          <span aria-hidden className="absolute left-[50px] top-[348px] block h-[40px] w-[91px]">
            {[0, 26, 52].map((x, i) => (
              <span
                key={x}
                className="absolute top-0 block h-[39px] w-[39px] rounded-full bg-surface-200 bg-cover bg-center"
                style={{
                  left: x,
                  zIndex: 3 - i,
                  backgroundImage: gov?.logoUrl ? `url('${gov.logoUrl}')` : undefined,
                  boxShadow: '0 0 0 2px #FFFFFF, inset 0 0 0 1px rgba(131,131,131,0.3)',
                }}
              />
            ))}
          </span>

          {updatedAt ? (
            <span
              className="absolute left-[152px] top-[352px] flex h-[34px] items-center rounded-[75.111px] px-[13px] text-[15.317px] font-medium"
              style={{ boxShadow: 'inset 0 0 0 0.851px rgba(131,131,131,0.2)', color: 'rgb(131,131,131)' }}
            >
              Updated {new Date(updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          ) : null}

          {/* ── the three facts ────────────────────────────────────────── */}
          <dl className="absolute left-[796px] top-[256px] w-[520px] text-[19.285px] font-medium leading-[1.3]">
            <div>
              <dt className="inline" style={{ color: 'rgba(131,131,131,0.8)' }}>Purpose:&nbsp;</dt>
              <dd className="inline text-ink">
                {oneLiner || initial.oneLiner || 'Not described yet — set it below.'}
              </dd>
            </div>
            <div className="mt-[23px]">
              <dt className="inline" style={{ color: 'rgba(131,131,131,0.8)' }}>Brand Compliance Status:</dt>
            </div>
            <div className="mt-[19px]">
              <dt className="inline" style={{ color: 'rgba(131,131,131,0.8)' }}>Publishing Connections Health:&nbsp;</dt>
              <dd className="inline text-ink">
                {health === null
                  ? '—'
                  : connected.length === 0
                    ? 'Nothing connected yet.'
                    : 'All systems operational.'}
              </dd>
            </div>
          </dl>

          {/* The design's cyan status chip. */}
          <span
            className="absolute left-[1166px] top-[299px] flex h-[32px] items-center gap-[8px] rounded-[88.266px] px-[10px] text-[19.285px] font-medium text-ink"
            style={{ background: compliant ? 'var(--ss-cyan)' : 'rgba(131,131,131,0.18)' }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="9.4" stroke="currentColor" strokeWidth="1.6" />
              <path d="m6.8 11.3 3 3 5.4-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {compliant ? 'Compliant' : 'Standard'}
          </span>

          {/* ── the three fields ───────────────────────────────────────── */}
          <div className="absolute left-[47px] top-[447px] flex w-[1249px] gap-[33px]">
            <div className="w-[672px] shrink-0">
              <Field
                label="Work Name"
                icon={
                  <svg width="18" height="17" viewBox="0 0 18 17" fill="none" aria-hidden>
                    <path d="M1 6.6 9 1l8 5.6V16H1V6.6Z" stroke="rgb(12,12,12)" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                }
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  aria-label="Work name"
                  className="h-full w-full bg-transparent text-18 font-medium text-ink outline-none"
                />
              </Field>

              <div className="mt-[17px]">
                <Field
                  label="Workspace URL"
                  hint="No tool stores a workspace address, so this is shown rather than saved."
                  icon={
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                      <path d="M9 13a3.6 3.6 0 0 0 5.1 0l2.9-2.9a3.6 3.6 0 0 0-5.1-5.1l-1 1" stroke="rgb(12,12,12)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M13 9a3.6 3.6 0 0 0-5.1 0L5 11.9a3.6 3.6 0 0 0 5.1 5.1l1-1" stroke="rgb(12,12,12)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  }
                >
                  <input
                    disabled
                    value={genomeId ? `spark.app/${genomeId.slice(0, 8)}` : ''}
                    aria-label="Workspace URL"
                    className="h-full w-full cursor-not-allowed bg-transparent text-18 font-medium outline-none"
                    style={{ color: 'rgb(131,131,131)' }}
                  />
                </Field>
              </div>
            </div>

            <div className="w-[543px] shrink-0">
              <label className="block text-18 font-medium text-ink">
                Description <span style={{ color: 'rgb(131,131,131)' }}>(Optional)</span>
              </label>
              <textarea
                value={oneLiner}
                onChange={(e) => setOneLiner(e.target.value)}
                placeholder={initial.oneLiner || 'Enter short description'}
                className="mt-[13px] h-[177px] w-full resize-none rounded-[10px] px-[23px] py-[20px] text-18 font-medium text-ink outline-none"
                style={{ background: FIELD_BG }}
              />
              <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
                The genome&rsquo;s one-liner — every playbook that has to say what you do reads it.
              </p>
            </div>
          </div>

          {/* The card's own height, so the absolute children have a box. */}
          <div aria-hidden className="h-[700px]" />
        </div>
      </div>

      {kitTotal > 0 ? (
        <p className="px-[30px] pb-[6px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          Brand kit {kitDone} of {kitTotal} complete ·{' '}
          <Link href="/settings/brand-kits" className="font-medium text-ink underline underline-offset-2">
            finish it
          </Link>
        </p>
      ) : null}

      <SettingsSaveBar
        onSave={() => void save()}
        onCancel={() => {
          setName(initial.name);
          setOneLiner(initial.oneLiner);
          setNote(null);
        }}
        busy={busy}
        dirty={dirty}
        note={note}
      />
    </div>
  );
}

/** The design's 672x98 field block: an 18/500 label over a 62-tall r10 box. */
function Field({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-18 font-medium text-ink">{label}</label>
      <div
        className="mt-[13px] flex h-[62px] items-center gap-[18px] rounded-[10px] px-[21px]"
        style={{ background: FIELD_BG }}
      >
        {icon ? <span className="flex w-[22px] shrink-0 justify-center">{icon}</span> : null}
        <span className="min-w-0 flex-1">{children}</span>
      </div>
      {hint ? (
        <p className="mt-[8px] text-16" style={{ color: 'rgb(131,131,131)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
