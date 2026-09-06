'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ChatDrawer } from '@/components/command-center/ChatDrawer';
import { isSparkPinned } from '@/lib/askSpark';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { cn } from '@/lib/utils';
import {
  BRAND_SECTIONS,
  PERSONAL_SECTIONS,
  treeFor,
  type SettingsSection,
} from './settingsTree';

/**
 * The frame every Settings screen shares — `ui build/Settings *.dc.html`.
 *
 * Measured off the 1728 stage, and stated here because twenty-six screens
 * depend on these numbers being the same:
 *
 *   card       15,18 · 1698 wide, r30, on `--ss-grad-set-card`
 *   Back       26,30 · 92x36.392 r7.072, ring `0 0 0 0.707px #838383`
 *   "Settings" 138,34 · 27.493/400
 *   divider    41,117 · 1646x1 `rgba(131,131,131,0.25)`
 *   pill       1043,44 · 435x50 r92.405, shadow `0 -100px 40px rgba(0,0,0,.1)`
 *   segment    224x42 r76.383 on `#0C0C0C`, label 16.634/500
 *   nav        41,144 · 285 wide r15.556 white; rows 266x50 r10
 *   content    338,143 · 1350 wide r20
 *
 * ── Why this is not `DiscoveryScreenChrome` ───────────────────────────────
 *
 * The same card, but a different header: Discovery and the Command Center lead
 * with the wordmark and put Back beside it, where Settings puts **Back first**
 * at x=26 and the page title second at x=138, with no wordmark at all. Sharing
 * the chrome would mean a prop that reorders the header, which is a worse
 * description of the design than two components that each state their own.
 *
 * The card wash is also its own token: this screen's is unmirrored where the
 * other three bake in a `scaleX(-1)`, so reusing theirs would put the pink in
 * the wrong corner.
 */
export function SettingsShell({
  heading,
  subtitle,
  /** Rendered inside the content card, under the heading band. */
  children,
  /** Sections that own their card entirely (the Engagement wizard). */
  bare,
  /** The save bar, when the section has one. */
  footer,
  /** Height of the content card. The design sizes it per section. */
  contentClassName,
}: {
  heading: string;
  subtitle?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  footer?: ReactNode;
  contentClassName?: string;
}) {
  const pathname = usePathname();
  const tree = treeFor(pathname);
  const sections = tree === 'personal' ? PERSONAL_SECTIONS : BRAND_SECTIONS;
  const [chatOpen, setChatOpen] = useState(false);
  const { genome } = useSelectedGenome();
  const router = useRouter();

  useEffect(() => {
    if (isSparkPinned()) setChatOpen(true);
  }, []);

  return (
    <div className="min-h-screen bg-white p-[15px] pt-[18px]">
      <div className="relative min-h-[calc(100vh-36px)] overflow-hidden rounded-[30px] bg-set-card">
        {/* ── header ──────────────────────────────────────────────────── */}
        <div className="relative flex flex-wrap items-start gap-[20px] px-[11px] sm:h-[99px]">
          {/* 26,30 on the stage is 11,12 inside a card that starts at 15,18. */}
          <Link
            href="/home"
            className="mt-[12px] flex h-[36.392px] w-[92px] shrink-0 items-center justify-center gap-[10px] rounded-[7.072px] text-[16.915px] font-medium leading-[1.269] transition-colors hover:bg-white"
            style={{ boxShadow: '0 0 0 0.707px rgb(131,131,131)', color: 'rgb(131,131,131)' }}
          >
            <svg width="7.468" height="14.936" viewBox="0 0 8 16" fill="none" aria-hidden>
              <path d="M7 1 1 8l6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </Link>

          {/* 138,34 → 123,16 in the card; the 31px box sits 4px below Back. */}
          <h1 className="mt-[16px] text-[27.493px] font-normal leading-[1.13] text-ink">Settings</h1>

          <div className="ml-auto flex min-w-0 items-start gap-[13px] pr-[15px]">
            <span className="mt-[26px] hidden xl:block">
              <NotificationBell compact />
            </span>

            <SettingsTreeSwitch tree={tree} />

            {/* One 196-wide box, orb then pill, exactly as the design groups them. */}
            <div className="mt-[15px] hidden w-[196px] items-center xl:flex">
              {/* The design's 70.216 orb, then the 126x47 r12.507 pill. */}
              <span
                aria-hidden
                className="relative block h-[70.216px] w-[70.216px] shrink-0 overflow-hidden rounded-full bg-white"
                style={{ boxShadow: 'inset 0 0 10.731px 3.86px rgba(255,255,255,0.84)' }}
              >
                <span className="absolute inset-0 rounded-full" style={{ background: 'rgba(108,232,255,0.2)', backdropFilter: 'blur(33.7px)' }} />
                <span className="absolute left-[30px] top-[19.27px] block h-[18.82px] w-[18.82px] rounded-full" style={{ background: 'rgb(245,107,255)' }} />
                <span className="absolute left-[14.32px] top-[22.12px] block h-[27.433px] w-[27.433px] rounded-full" style={{ background: 'rgb(108,232,255)' }} />
                <span className="absolute left-[28.1px] top-[41.12px] block h-[15.702px] w-[15.702px] rounded-full" style={{ background: 'rgb(163,65,255)' }} />
                <span className="absolute left-[40.42px] top-[31.24px] block h-[15.702px] w-[15.702px] rounded-full bg-white" />
                <span
                  className="absolute left-[13.989px] top-[25.996px] block h-[17.384px] w-[42.881px] rounded-[12.975px]"
                  style={{ background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(11.7px)', boxShadow: 'inset 0 0 6.53px -1.159px rgb(108,232,255)' }}
                />
                <span className="absolute left-[20.363px] top-[31.199px] block h-[7.022px] w-[7.022px] rounded-full bg-white" />
                <span className="absolute left-[44.236px] top-[31.199px] block h-[7.022px] w-[7.022px] rounded-full bg-white" />
              </span>

              <button
                type="button"
                onClick={() => setChatOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={chatOpen}
                className="flex h-[47px] w-[126px] items-center justify-center rounded-[12.507px] bg-white text-[14px] font-semibold text-ink transition-shadow"
                style={{ boxShadow: '0 10px 26px -14px rgba(12,12,12,0.3)' }}
              >
                Ask Spark?
              </button>
            </div>
          </div>
        </div>

        {/* 41,117 on the stage → 26,99 in the card, 1646 wide. */}
        <div aria-hidden className="mx-[26px] h-px" style={{ background: 'rgba(131,131,131,0.25)' }} />

        {/* ── nav + content ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-[11px] px-[26px] pb-[40px] pt-[26px]">
          <SettingsNavPanel sections={sections} tree={tree} pathname={pathname} />

          <section
            className={cn(
              'min-w-0 flex-1 rounded-xl',
              bare ? '' : 'bg-white',
              contentClassName,
            )}
          >
            {bare ? (
              children
            ) : (
              <>
                <div className="px-[30px] pt-[21px]">
                  <h2 className="text-20 font-semibold leading-[1.3] text-ink">{heading}</h2>
                  {subtitle ? (
                    <p className="mt-[8px] max-w-[840px] text-18 font-normal leading-[1.22]" style={{ color: 'rgb(131,131,131)' }}>
                      {subtitle}
                    </p>
                  ) : null}
                </div>
                <div className="px-[30px] pb-[30px] pt-[22px]">{children}</div>
                {footer}
              </>
            )}
          </section>
        </div>
      </div>

      <ChatDrawer
        genomeId={genome?.genomeId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        /* Settings has no draft panel of its own, so a draft Spark produces
           here opens where drafts live — the Command Center. */
        onOpenDraft={(contentItemId) => router.push(`/agents?draft=${contentItemId}`)}
      />
    </div>
  );
}

/** The 435x50 Workspace / Personal switch. */
function SettingsTreeSwitch({ tree }: { tree: 'brand' | 'personal' }) {
  const items = [
    { key: 'brand' as const, label: 'Brand Settings', href: BRAND_SECTIONS[0]!.href },
    { key: 'personal' as const, label: 'Personal Settings', href: PERSONAL_SECTIONS[0]!.href },
  ];
  return (
    <div
      className="mt-[26px] flex h-set-pill-h w-set-pill-w shrink-0 items-center rounded-[92.405px] bg-white p-[4px]"
      style={{ boxShadow: 'var(--ss-set-pill-shadow)' }}
      role="tablist"
      aria-label="Settings scope"
    >
      {items.map((it) => {
        const on = tree === it.key;
        return (
          <Link
            key={it.key}
            href={it.href}
            role="tab"
            aria-selected={on}
            className={cn(
              'flex h-set-seg-h flex-1 items-center justify-center gap-[7px] rounded-[76.383px] text-[16.634px] font-medium leading-[1.26] transition-colors',
              on ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            {it.key === 'brand' ? (
              <svg width="18" height="17" viewBox="0 0 18 17" fill="none" aria-hidden>
                <path d="M1 6.2 9 1.5l8 4.7v8.3H1V6.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <circle cx="9" cy="6.2" r="3.4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2.6 16.4c0-2.9 2.9-5 6.4-5s6.4 2.1 6.4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The 285-wide nav panel.
 *
 * Rows are 266x50 at radius 10 on a fixed pitch — 58 in the brand tree, 56 in
 * the personal one — so the panel's height is the pitch times the count plus
 * the design's 23px inset top and bottom.
 */
function SettingsNavPanel({
  sections,
  tree,
  pathname,
}: {
  sections: readonly SettingsSection[];
  tree: 'brand' | 'personal';
  pathname: string;
}) {
  const pitch = tree === 'personal' ? 56 : 58;
  return (
    <nav
      aria-label={tree === 'personal' ? 'Personal settings' : 'Brand settings'}
      className="w-set-nav shrink-0 overflow-hidden rounded-[15.556px] bg-white py-[10px] max-lg:w-full"
      /*
        The design states both panels outright: 285x420 for the seven brand
        rows on a 58 pitch (406 of rows, 14 of inset) and 285x352 for the six
        personal rows on a 56 pitch (336 and 16). The insets genuinely differ,
        so both are stated rather than averaged.
      */
      style={{ height: sections.length * pitch + (tree === 'personal' ? 16 : 14) }}
    >
      <ul className="px-[10px]">
        {sections.map((s) => {
          const on = pathname === s.href;
          return (
            <li key={s.href} style={{ height: pitch }}>
              <Link
                href={s.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex h-set-nav-row-h w-set-nav-row max-w-full items-center gap-[8px] rounded pl-[13px] pr-[10px] text-18 font-medium leading-[1.28] transition-colors',
                  on ? 'text-ink' : 'text-ink-muted hover:bg-black/[0.03]',
                )}
                style={on ? { background: 'var(--ss-grad-set-nav-active)' } : undefined}
              >
                <span className="flex h-[21px] w-[21px] shrink-0 items-center justify-center">{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The save bar — Cancel 147.869x44.809 r9.704 beside "Save Changes"
 * 167.585x44.809 on `#0C0C0C`, both at the card's bottom-left.
 *
 * The design spells it "Sava Changes". That is a typo in the file, not a
 * decision, so it is spelled correctly here.
 */
export function SettingsSaveBar({
  onSave,
  onCancel,
  busy,
  dirty,
  note,
}: {
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean;
  dirty?: boolean;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[13px] border-t border-[rgba(131,131,131,0.15)] px-[30px] py-[22px]">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy || !dirty}
        className="h-[44.809px] w-[147.869px] rounded-[9.704px] bg-white text-16 font-medium transition-colors hover:bg-surface-200 disabled:opacity-50"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.35)', color: 'rgb(131,131,131)' }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={busy || !dirty}
        className="h-[44.809px] w-[167.585px] rounded-[9.704px] bg-ink text-16 font-medium text-white transition-colors hover:bg-ink-800 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save Changes'}
      </button>
      {note ? <span className="text-16" style={{ color: 'rgb(131,131,131)' }}>{note}</span> : null}
    </div>
  );
}
