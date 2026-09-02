'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheck,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@clerk/nextjs';
import { invoke } from '@/lib/tools';
import { readSelectedGenome, writeSelectedGenome } from '@/lib/selectedGenome';

/**
 * Brand switcher. This is the seam where auth and the shell actually meet, and
 * the first genuinely end-to-end path in the app:
 *
 *   Clerk session → verified org → `genome.list` (org-scoped) → cookie →
 *   every later tool call carries a genome the API re-validates against that org.
 *
 * Selecting a brand writes `spark_genome`, which the tool proxy forwards as
 * `x-genome-id`. That header is a *claim*: `apps/api/src/clerk-auth.ts` looks it
 * up against the verified org and refuses it if it doesn't belong. So a user
 * editing this cookie by hand gets a 403, not someone else's data.
 */
interface GenomeRow {
  genomeId: string;
  brandId: string;
  name: string;
  updatedAt: string;
}


/** The workspace cards' tints, reused so a brand keeps one colour per slot. */
const TILES = ['#C9F0FA', '#D9F4DC', '#FBDCD4', '#FBF0D4', '#EDDBF8'] as const;

export function BrandSwitcher() {
  const router = useRouter();
  const { orgId } = useAuth();
  const [genomes, setGenomes] = useState<GenomeRow[] | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await invoke<{ genomes: GenomeRow[] }>('genome.list', {});
      if (cancelled) return;
      const rows = result.status === 'succeeded' ? result.output.genomes : [];
      setGenomes(rows);

      // Default to the stored genome if it is still in the list, else the most
      // recently updated one. A stale cookie pointing at a deleted or moved
      // genome would otherwise 403 every request with no way back.
      // Read against this session's org: a cookie from another org is not a
      // stale pointer to fix up, it is a claim from somebody else's account.
      const stored = readSelectedGenome(orgId);
      const valid = stored && rows.some((g) => g.genomeId === stored) ? stored : rows[0]?.genomeId;
      if (valid) select(valid, false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(genomeId: string, refresh = true) {
    // Cookie shape and lifetime now live in one module, because four files used
    // to parse this by hand and the rule they were all missing had nowhere to go.
    if (orgId) writeSelectedGenome(orgId, genomeId);
    setActiveId(genomeId);
    if (refresh) router.refresh();
  }

  if (genomes === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-[26px] w-[180px]" />
        <Skeleton className="h-[18px] w-[120px]" />
      </div>
    );
  }

  if (genomes.length === 0) {
    /**
     * A link, not a sentence.
     *
     * This said "Onboarding creates your first one" while onboarding had no
     * route to reach — a dead end that named its own exit. Every panel behind
     * it needs a genome, so this is the only useful action on the screen and it
     * should be the one thing that is clickable.
     */
    return (
      <div>
        <p className="text-[26px] font-semibold text-ink">No brands yet</p>
        <Link
          href="/onboarding"
          className="mt-1 inline-block text-[18px] text-[var(--ss-accent-purple)] underline-offset-4 hover:underline"
        >
          Set up your first brand
        </Link>
      </div>
    );
  }

  const active = genomes.find((g) => g.genomeId === activeId) ?? genomes[0]!;

  return (
    <DropdownMenu>
      {/*
        A 44px row at radius 12 with `0 16px 0 10px` of padding and a 13px gap,
        holding the name at 26px/600 and a chevron. Nothing else.

        It used to render "1 brand" underneath, which put *three* headings in a
        header the design gives two: the name, then "N brands", then the status
        line from `TopBar`. The count is already the length of the list one click
        away, and it was the least useful of the three.
      */}
      <DropdownMenuTrigger className="group -ml-2.5 flex h-11 items-center gap-[13px] rounded-md pl-2.5 pr-4 text-left outline-none transition-colors hover:bg-[rgba(131,131,131,0.08)]">
        <span className="text-[26px] font-semibold leading-[1.27] text-black">{active.name}</span>
        <ChevronDown className="h-[14px] w-[14px] shrink-0 text-ink transition-transform group-data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[348px]">
        {/*
          "Brands" — this switches between businesses inside one Clerk
          organization (an agency running several genomes side by side), which is
          a different thing from the organization itself.

          Both used to be called a "workspace", which is exactly what made "why
          do all my workspaces have the same name" an ambiguous bug report
          instead of an obvious one. M3 settled it: the business is a **brand**
          and the organization is an **account** (`/account`, `AccountHome`,
          `DASH-A-01` — the word the build already used for that level). The
          component was `WorkspaceSwitcher` until the same pass renamed it.
        */}
        <DropdownMenuLabel className="px-3 pb-1.5 pt-2 text-[12.5px] font-semibold uppercase tracking-[0.6px] text-ink-muted">
          Brands
        </DropdownMenuLabel>
        {genomes.map((g, i) => (
          <DropdownMenuItem
            key={g.genomeId}
            onSelect={() => select(g.genomeId)}
            className="h-[46px] gap-3 rounded-[10px] px-3"
          >
            {/* The design's 28px rounded tile, tinted per row. A brand has no
                colour of its own, so the tint comes from its position - the
                same cycle the workspace cards use. */}
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-ink"
              style={{ background: TILES[i % TILES.length] }}
            >
              {g.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-16 font-semibold">{g.name}</span>
            <DropdownMenuCheck checked={g.genomeId === active.genomeId} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/*
          The design's "Account Home / All workspaces & organization" row, which
          this menu did not have — a 52px row with a black tile and a chevron.

          Worth being precise about what it switches, because the design uses one
          word for two levels. This menu lists **brands**: businesses inside one
          Clerk organization, which is what every panel on the dashboard is
          scoped to. `/workspaces` lists the **organizations** themselves. The
          design calls both "workspace", and collapsing them here would make
          "why do all my workspaces have the same name" an ambiguous bug report
          again — which is the reason `M3` separated the words in the first
          place.
        */}
        <DropdownMenuItem onSelect={() => router.push('/workspaces')} className="h-[52px] gap-3 rounded-[10px] px-3">
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: '#0C0C0C' }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 6.5 8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5Z" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-16 font-semibold">Account Home</span>
            <span className="truncate text-13 font-normal text-ink-muted">All workspaces &amp; organization</span>
          </span>
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden className="shrink-0">
            <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          The other half of "add a new brand from the dashboard": a second
          *brand* inside this account, not a second Clerk organization (full
          multi-tenancy is explicitly out of scope for the alpha — CLAUDE.md).
          Onboarding already writes `spark_genome` to whatever it creates, so
          re-running it here needs no new tool — the gap was purely that
          nothing linked to it after the first run.
        */}
        <DropdownMenuItem onSelect={() => router.push('/onboarding')} className="h-[46px] gap-3 rounded-[10px] px-3">
          <Plus className="h-[16px] w-[16px] text-ink-muted" aria-hidden />
          <span>Add a brand</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
