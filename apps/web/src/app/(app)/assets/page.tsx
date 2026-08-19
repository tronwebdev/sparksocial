'use client';

import { useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { UserMenu } from '@/components/shell/UserMenu';
import { AssetUploadForm } from '@/components/assets/AssetUploadForm';
import { AssetSearchGrid } from '@/components/assets/AssetSearchGrid';
import { AssetGapsPanel } from '@/components/assets/AssetGapsPanel';

/**
 * Was a placeholder tagged `phase="P2"`. Asset Graph — ingest, caption,
 * embed, retrieve, gap detection — has been real since P2; this is the first
 * screen that reaches any of it.
 */
export default function AssetsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <TopBar title={<WorkspaceSwitcher />} actions={<UserMenu />} />
      <div className="grid grid-cols-1 gap-6 p-8">
        <header>
          <h1 className="text-[20px] font-medium text-ink">Assets Library</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Everything this brand can make content from</p>
        </header>

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-[18px] font-semibold text-ink">Add an asset</h2>
          <p className="mt-1 text-[13px] text-ink-muted">Photos, video, or audio — captioned and embedded automatically so it's retrievable by intent.</p>
          <div className="mt-4">
            <AssetUploadForm onIngested={() => setRefreshKey((n) => n + 1)} />
          </div>
        </section>

        <AssetGapsPanel refreshKey={refreshKey} />
        <AssetSearchGrid refreshKey={refreshKey} />
      </div>
    </>
  );
}
