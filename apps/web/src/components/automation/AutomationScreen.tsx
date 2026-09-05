'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AutomationHome } from './AutomationHome';
import { CampaignManage } from './CampaignManage';
import { LaunchModal, RecipeChooserModal } from './LaunchModal';
import { RecipeWizard, emptyDraft, type WizardDraft } from './RecipeWizard';
import { KIND_META, type RecipeKind } from './recipeMeta';
import { useAutomation, type ManageRow, type QueueRow, type RecipeItem } from './useAutomation';

/**
 * Automation Recipes — `ui build/SparkSocial Automation.dc.html`.
 *
 * ── The four views, and what moves between them ───────────────────────────
 *
 * The prototype holds one `view` field — `home | atWizard | atReview |
 * atManage` — plus a modal chooser, so this screen holds the same one rather
 * than four booleans that can disagree:
 *
 *   home → wizard    a recipe card's **Add New**, or the hero's **Add New
 *                    Recipe** → the chooser modal → a kind
 *   wizard → wizard  **Continue** walks `KIND_META[kind].steps`; **Back** on
 *                    step 1 returns home. The progress bar animates its width
 *                    over 400ms, which is the only thing the design animates
 *                    between steps
 *   wizard → review  **Launch Automation** — and unlike the prototype, the
 *                    recipe is *written* here. `atActivate` in the prototype
 *                    bumps a counter after the congratulations; a modal that
 *                    congratulates you before the call succeeded is a lie the
 *                    first time it fails, so the order is inverted: create,
 *                    then celebrate, and a failure keeps you on the step with
 *                    the reason
 *   review → manage  **Activate Campaign** lands on that kind's manage view,
 *                    the same handoff `atActivate` makes for AutoTrend
 *   home → manage    a recipe card's **Manage**
 *
 * ── One screen, three kinds ───────────────────────────────────────────────
 *
 * The prototype's manage view and its launch rows are written for AutoTrend
 * alone. All three cards have a Manage button, so both are per kind here —
 * sending Bulk Connector to a screen headed "AutoTrend" would be worse than
 * the extra branch.
 */
export function AutomationScreen() {
  const { genome, loading: genomeLoading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;
  const router = useRouter();

  const { recipes, rows, manageRows, needsReview, error: loadError, reload } = useAutomation(genomeId);

  const [view, setView] = useState<'home' | 'wizard' | 'manage'>('home');
  const [chooser, setChooser] = useState(false);
  const [manageKind, setManageKind] = useState<RecipeKind>('auto_trend');

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ draft: WizardDraft; recipeId: string } | null>(null);
  const [requireApproval, setRequireApproval] = useState(true);
  const [validation, setValidation] = useState<{ valid: boolean; error?: string; notApplied: string[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2300);
  }, []);

  /**
   * What to say when a call did not succeed.
   *
   * `gated` is not a failure — it is the policy engine staging the call for a
   * person, and `decision.reason` is why. `recipe.delete` is `effect:
   * 'destructive'`, so it is gated for most roles and the flat "that request
   * was gated" told nobody anything they could act on.
   */
  const whyNot = useCallback((res: { status: string; error?: { message: string }; decision?: { reason?: string } }): string => {
    if (res.status === 'failed') return res.error?.message ?? 'That request failed.';
    /* The engine's reason is a fragment ("Irreversible action."), so it gets a
       lead-in rather than being shown as a whole sentence on its own. */
    return res.decision?.reason
      ? `Staged for approval — ${res.decision.reason.replace(/\.$/, '')}.`
      : 'That needs an approval before it can run — check the approvals queue.';
  }, []);

  /** The config `recipe.create` stores, per kind. */
  const configFor = useCallback((d: WizardDraft): Record<string, unknown> => {
    if (d.kind === 'rss') return { feedUrl: d.feedUrl.trim() };
    if (d.kind === 'auto_trend') {
      return {
        /* The engine's own floor. The design has no score control, and a recipe
           that accepted everything would fill the queue with noise. */
        minScore: 0.6,
        ...(d.keywords.length ? { keywords: d.keywords } : {}),
        ...(d.excludeKeywords.length ? { excludeKeywords: d.excludeKeywords } : {}),
      };
    }
    return d.bulkSource === 'csv'
      ? { source: 'csv', csvUrl: d.sourceRef.trim() }
      : d.bulkSource === 'drive'
        ? { source: 'drive', driveFolderId: d.sourceRef.trim() }
        : { source: 'canva', canvaFolderId: d.sourceRef.trim() };
  }, []);

  /* The validate step asks the engine what it makes of the config so far. */
  const stepKind = draft ? KIND_META[draft.kind].steps[Math.min(step, KIND_META[draft.kind].steps.length - 1)] : null;
  useEffect(() => {
    if (!draft || !genomeId || stepKind !== 'validate') return;
    let cancelled = false;
    setValidation(null);
    void (async () => {
      const res = await invoke<{ valid: boolean; error?: string; notApplied: string[] }>('recipe.validate', {
        genomeId,
        kind: draft.kind,
        config: configFor(draft),
      });
      if (cancelled) return;
      setValidation(
        res.status === 'succeeded'
          ? res.output
          : { valid: false, error: res.status === 'failed' ? res.error.message : 'That check was gated.', notApplied: [] },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, genomeId, stepKind, configFor]);

  async function launch() {
    if (!draft || !genomeId || busy) return;
    setBusy(true);
    setError(null);

    const res = await invoke<{ id: string }>(
      'recipe.create',
      {
        genomeId,
        kind: draft.kind,
        name: draft.name.trim() || KIND_META[draft.kind].name,
        config: configFor(draft),
        /* `recipe.create` takes minutes, and refuses anything under 15. */
        intervalMinutes: Math.max(15, draft.everyHours * 60),
      },
      /* Not idempotent — two presses are two recipes — so a fresh key per press. */
      crypto.randomUUID(),
    );
    setBusy(false);

    if (res.status !== 'succeeded') {
      setError(whyNot(res));
      return;
    }

    setRequireApproval(draft.reviewFirst);
    setLaunched({ draft, recipeId: res.output.id });
    void reload();
  }

  async function decide(row: ManageRow | QueueRow, status: 'approved' | 'rejected') {
    if (!genomeId || busyId) return;
    setBusyId(row.id);

    /*
      Approving turns the preview into a real draft first, because
      `recipe.output.decide` refuses an approval without the `contentItemId` it
      became — "Approving an output requires the contentItemId it became."

      That needs a playbook, and only the AutoTrend runner records one
      (`packages/recipes/src/runners.ts`); the RSS and bulk runners write a
      title and a source link and no format. So an output from those two cannot
      be approved at all today, and the button is not offered for them — see
      `canDraft` in `CampaignManage`. This guard is the second line of defence.
    */
    let contentItemId = row.contentItemId;
    if (status === 'approved' && !contentItemId) {
      if (!row.playbookId) {
        setBusyId(null);
        say('This run picked no format, so there is nothing to draft — remove it or let the recipe try again.');
        return;
      }
      const drafted = await invoke<{ contentItemId: string }>(
        'content.draft',
        { genomeId, playbookId: row.playbookId, intent: row.intent ?? row.title },
        crypto.randomUUID(),
      );
      if (drafted.status !== 'succeeded') {
        setBusyId(null);
        say(whyNot(drafted));
        return;
      }
      contentItemId = drafted.output.contentItemId;
    }

    const res = await invoke('recipe.output.decide', {
      id: row.id,
      genomeId,
      status,
      ...(contentItemId ? { contentItemId } : {}),
    });
    setBusyId(null);
    if (res.status !== 'succeeded') {
      say(whyNot(res));
      return;
    }
    say(status === 'approved' ? 'Post approved' : 'Removed from the queue');
    void reload();
  }

  async function recipeAction(r: RecipeItem, action: 'run' | 'pause' | 'delete') {
    if (!genomeId || busyId) return;
    setBusyId(r.id);
    const res =
      action === 'run'
        ? await invoke('recipe.run', { id: r.id, genomeId }, crypto.randomUUID())
        : action === 'delete'
          ? await invoke('recipe.delete', { id: r.id, genomeId })
          : await invoke('recipe.schedule', { id: r.id, genomeId, status: r.status === 'paused' ? 'active' : 'paused' });
    setBusyId(null);
    if (res.status !== 'succeeded') {
      say(whyNot(res));
      return;
    }
    say(action === 'run' ? `${r.name} ran` : action === 'delete' ? `${r.name} deleted` : r.status === 'paused' ? `${r.name} resumed` : `${r.name} paused`);
    void reload();
  }

  if (genomeLoading) return <p className="p-[40px] text-16 text-ink-muted">Loading…</p>;
  if (!genomeId) return <p className="p-[40px] text-16 text-ink-muted">{genomeError ?? 'Pick a brand first.'}</p>;

  return (
    <>
      {view === 'home' ? (
        <AutomationHome
          recipes={recipes}
          rows={rows}
          loading={recipes === null}
          needsReview={needsReview}
          onOpenChooser={() => setChooser(true)}
          onAddNew={(kind) => {
            setDraft(emptyDraft(kind));
            setStep(0);
            setError(null);
            setView('wizard');
            window.scrollTo(0, 0);
          }}
          onManage={(kind) => {
            setManageKind(kind);
            setView('manage');
            window.scrollTo(0, 0);
          }}
          onPreview={(row) =>
            row.contentItemId
              ? router.push(`/agents?draft=${encodeURIComponent(row.contentItemId)}`)
              : say('This one has no draft yet — approve it and SPARK writes one.')
          }
          onRemove={(row) => void decide(row, 'rejected')}
          onReview={() => {
            const first = (rows ?? []).find((r) => r.canDecide);
            if (!first) return;
            setManageKind(first.kind);
            setView('manage');
            window.scrollTo(0, 0);
          }}
        />
      ) : null}

      {view === 'wizard' && draft ? (
        <RecipeWizard
          draft={draft}
          onDraft={setDraft}
          step={step}
          onStep={setStep}
          onBack={() => {
            if (step === 0) {
              setView('home');
              setDraft(null);
              return;
            }
            setStep(step - 1);
          }}
          onLaunch={() => void launch()}
          busy={busy}
          error={error}
          validation={validation}
        />
      ) : null}

      {view === 'manage' ? (
        <CampaignManage
          kind={manageKind}
          recipes={(recipes ?? []).filter((r) => r.kind === manageKind)}
          rows={manageRows(manageKind)}
          onBack={() => setView('home')}
          onRun={(r) => void recipeAction(r, 'run')}
          onPause={(r) => void recipeAction(r, 'pause')}
          onDelete={(r) => void recipeAction(r, 'delete')}
          onApprove={(row) => void decide(row, 'approved')}
          onReject={(row) => void decide(row, 'rejected')}
          busyId={busyId}
        />
      ) : null}

      {chooser ? (
        <RecipeChooserModal
          onClose={() => setChooser(false)}
          onPick={(kind) => {
            setChooser(false);
            setDraft(emptyDraft(kind));
            setStep(0);
            setError(null);
            setView('wizard');
            window.scrollTo(0, 0);
          }}
        />
      ) : null}

      {launched ? (
        <LaunchModal
          draft={launched.draft}
          requireApproval={requireApproval}
          onRequireApproval={setRequireApproval}
          busy={busy}
          onClose={() => {
            setLaunched(null);
            setDraft(null);
            setView('home');
          }}
          onDone={() => {
            const kind = launched.draft.kind;
            setLaunched(null);
            setDraft(null);
            setManageKind(kind);
            setView('manage');
            window.scrollTo(0, 0);
            say(`${KIND_META[kind].name} campaign activated`);
          }}
        />
      ) : null}

      {loadError ? (
        <p className="px-auto-inset pb-[20px] text-15 text-destructive">{loadError}</p>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-[34px] left-1/2 z-[140] -translate-x-1/2 animate-toast-in whitespace-nowrap rounded-xl px-[22px] py-[13px] text-15 font-medium text-white motion-reduce:animate-none"
          style={{ background: 'rgba(12,12,12,0.92)' }}
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}
