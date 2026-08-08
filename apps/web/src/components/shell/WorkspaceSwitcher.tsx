'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuCheck,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

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

const COOKIE = 'spark_genome';

function readCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
}

export function WorkspaceSwitcher() {
  const router = useRouter();
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
      const stored = readCookie();
      const valid = stored && rows.some((g) => g.genomeId === stored) ? stored : rows[0]?.genomeId;
      if (valid) select(valid, false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(genomeId: string, refresh = true) {
    // `SameSite=Lax` so it rides same-site navigations but not cross-site
    // requests; not `Secure` here because local dev is http.
    document.cookie = `${COOKIE}=${encodeURIComponent(genomeId)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
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
    return (
      <div>
        <p className="text-[26px] font-semibold text-ink">No brands yet</p>
        <p className="mt-1 text-[18px] text-ink-muted">Onboarding creates your first one.</p>
      </div>
    );
  }

  const active = genomes.find((g) => g.genomeId === activeId) ?? genomes[0]!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex items-center gap-2 text-left outline-none">
        <div>
          <span className="flex items-center gap-2 text-[26px] font-semibold text-ink">
            {active.name}
            <ChevronDown className="h-[14px] w-[14px] transition-transform group-data-[state=open]:rotate-180" />
          </span>
          <span className="mt-1 block text-[18px] font-normal text-ink-muted">{genomes.length} brand{genomes.length === 1 ? '' : 's'}</span>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[348px]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {genomes.map((g) => (
          <DropdownMenuItem key={g.genomeId} onSelect={() => select(g.genomeId)}>
            <span className="truncate">{g.name}</span>
            <DropdownMenuCheck checked={g.genomeId === active.genomeId} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
