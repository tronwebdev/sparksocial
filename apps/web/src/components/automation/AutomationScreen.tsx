'use client';

import { SparkLoader } from '@/components/brand/SparkLoader';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoke, type ToolResult } from '@/lib/tools';
import { notify, notifyResult } from '@/lib/notify';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { AutomationHome } from './AutomationHome';
import { CampaignManage } from './CampaignManage';
import { LaunchModal, RecipeChooserModal } from './LaunchModal';
import { RecipeWizard, type Validation } from './RecipeWizard';
import { configFor, draftFromRecipe, emptyDraft, intervalMinutesFor, type WizardDraft } from './wizardDraft';
import { KIND_META, type RecipeKind } from './recipeMeta';
import { useAutomation, type ManageRow, type QueueRow, type RecipeItem } from './useAutomation';
import { userMessage } from '@/lib/errorCopy';

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
 *                    then celebrate, and a failure keeps you on the step and
 *                    says why
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
  /* The saved recipe the wizard is editing, when it is — AUTO-02.1. */
  const [editing, setEditing] = useState<RecipeItem | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<{ draft: WizardDraft; recipeId: string } | null>(null);
  const [requireApproval, setRequireApproval] = useState(true);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /* Canva's connect state, for the source step's dashed strip. Read when a bulk
     wizard opens rather than on mount: no other step asks. */
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectNote, setConnectNote] = useState<string | null>(null);

  /*
    A call that did not succeed goes through `notifyResult`. `gated` is not a
    failure — it is the policy engine staging the call for a person, with
    `decision.reason` as why — so it reads as "sent for approval" with that
    reason rather than as an error. `recipe.delete` is `effect: 'destructive'`,
    so it is gated for most roles, and the flat "that request was gated" this
    screen used to say told nobody anything they could act on.
  */

  /* The validate step asks the engine what it makes of the config so far. */
  const stepKind = draft ? KIND_META[draft.kind].steps[Math.min(step, KIND_META[draft.kind].steps.length - 1)] : null;
  useEffect(() => {
    if (!draft || !genomeId || stepKind !== 'validate') return;
    let cancelled = false;
    setValidation(null);
    void (async () => {
      // `recipe.validate` takes `{ kind, config }`; the brand comes from the
      // `x-genome-id` header the proxy forwards, read as `ctx.genomeId`. Zod
      // strips a key that is not in the schema, so passing `genomeId` here was
      // silently discarded rather than doing anything.
      const res = await invoke<Validation>('recipe.validate', {
        kind: draft.kind,
        config: configFor(draft),
      });
      if (cancelled) return;
      setValidation(
        res.status === 'succeeded'
          ? res.output
          : { valid: false, error: res.status === 'failed' ? userMessage(res.error) : 'That check was gated.', notApplied: [] },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, genomeId, stepKind, configFor]);

  useEffect(() => {
    if (!genomeId || draft?.kind !== 'bulk_connector') return;
    let cancelled = false;
    void (async () => {
      const res = await invoke<{ connected: boolean }>('brand.oauth.status', { genomeId, provider: 'canva' });
      if (!cancelled) setCanvaConnected(res.status === 'succeeded' ? res.output.connected : false);
    })();
    return () => {
      cancelled = true;
    };
  }, [genomeId, draft?.kind]);

  async function connectCanva() {
    if (!genomeId || connecting) return;
    setConnecting(true);
    setConnectNote(null);
    const res = await invoke<{ authorizeUrl: string }>('brand.oauth.connect', { genomeId, provider: 'canva' });
    setConnecting(false);
    if (!notifyResult(res, undefined, 'Couldn’t open Canva')) return;
    /* A new tab: the wizard is mid-flight, and Canva redirects to the API. */
    window.open(res.output.authorizeUrl, '_blank', 'noopener,noreferrer');
    setConnectNote('Finish in the Canva tab, then come back — press Continue to re-check.');
  }

  function openWizard(next: WizardDraft, recipe: RecipeItem | null) {
    setDraft(next);
    setEditing(recipe);
    setStep(0);
    setView('wizard');
    window.scrollTo(0, 0);
  }

  async function launch() {
    if (!draft || !genomeId || busy) return;
    setBusy(true);

    /* Editing saves over the recipe — `recipe.update` validates the config
       against the stored kind and keeps its history and queued outputs. */
    if (editing) {
      const saved = await invoke('recipe.update', {
        id: editing.id,
        genomeId,
        name: draft.name.trim() || KIND_META[draft.kind].name,
        config: configFor(draft),
        intervalMinutes: intervalMinutesFor(draft),
      });
      setBusy(false);
      if (!notifyResult(saved, undefined, 'Couldn’t save the recipe')) return;
      const kind = draft.kind;
      setEditing(null);
      setDraft(null);
      setManageKind(kind);
      setView('manage');
      window.scrollTo(0, 0);
      notify.success('Changes saved');
      void reload();
      return;
    }

    const res = await invoke<{ id: string }>(
      'recipe.create',
      {
        genomeId,
        kind: draft.kind,
        name: draft.name.trim() || KIND_META[draft.kind].name,
        config: configFor(draft),
        /* Both halves of the design's cadence toggle land on this one number —
           see `intervalMinutesFor`. */
        intervalMinutes: intervalMinutesFor(draft),
      },
      /* Not idempotent — two presses are two recipes — so a fresh key per press. */
      crypto.randomUUID(),
    );
    setBusy(false);

    if (!notifyResult(res, undefined, 'Couldn’t launch the recipe')) return;

    setRequireApproval(draft.reviewFirst || (draft.kind === 'auto_trend' && draft.brandSafety));
    setLaunched({ draft, recipeId: res.output.id });
    void reload();
  }

  /**
   * The launch modal's "Require approval" box. It used to change nothing but
   * its own tick — the recipe kept whatever the last wizard step had set — so
   * unticking it there left a recipe that still waited for review. Saved here,
   * and only when it differs from what was launched.
   */
  async function activate() {
    if (!launched || !genomeId || busy) return;
    const { draft: d, recipeId } = launched;
    if (requireApproval !== d.reviewFirst) {
      setBusy(true);
      const saved = await invoke('recipe.update', {
        id: recipeId,
        genomeId,
        config: configFor({ ...d, reviewFirst: requireApproval }),
      });
      setBusy(false);
      if (!notifyResult(saved, undefined, 'Couldn’t save the approval setting')) return;
    }
    setLaunched(null);
    setDraft(null);
    setManageKind(d.kind);
    setView('manage');
    window.scrollTo(0, 0);
    notify.success(`${KIND_META[d.kind].name} campaign activated`);
    void reload();
  }

  async function decide(row: ManageRow | QueueRow, status: 'approved' | 'rejected') {
    if (!genomeId || busyId) return;
    setBusyId(row.id);

    /*
      Approving schedules the post: `recipe.output.decide` makes one scheduled
      post per chosen account, queued after the recipe's other posts and
      carrying its link. It used to need a draft made here first, and that draft
      had no schedule, no recipe and no account — so an approved post never went
      out unless somebody scheduled it by hand.
    */
    if (status === 'approved' && !row.playbookId) {
      setBusyId(null);
      notify.warning('Nothing to post', { body: 'No format this brand can make fits this one — remove it instead.' });
      return;
    }

    const res = await invoke<{ preview: { contentItemIds?: string[] } }>('recipe.output.decide', { id: row.id, genomeId, status });
    if (res.status !== 'succeeded') {
      setBusyId(null);
      notifyResult(res, undefined, status === 'approved' ? 'Couldn’t approve it' : 'Couldn’t remove it');
      /* The usual cause is a stale screen — the item was decided somewhere
         else since this list loaded — so show the queue as it is now rather
         than leaving a button that will fail the same way again. */
      void reload();
      return;
    }

    /*
      Then write the copy now, so Preview shows the real post before it goes
      out. The scheduler would write it when the slot comes due anyway (and
      will, if this fails), so a failure here is reported, not fatal.
    */
    let drafted = true;
    if (status === 'approved' && row.playbookId) {
      for (const contentItemId of res.output.preview.contentItemIds ?? []) {
        const d = await invoke(
          'content.draft',
          { genomeId, playbookId: row.playbookId, contentItemId, intent: row.intent ?? row.title },
          crypto.randomUUID(),
        );
        if (d.status !== 'succeeded') drafted = false;
      }
    }
    setBusyId(null);
    if (status === 'rejected') notify.info('Removed from the queue');
    else notify.success('Approved and scheduled', drafted ? undefined : { body: 'SPARK will write it before it goes out.' });
    void reload();
  }

  async function recipeAction(r: RecipeItem, action: 'run' | 'pause' | 'delete') {
    if (!genomeId || busyId) return;
    setBusyId(r.id);
    const res: ToolResult<unknown> =
      action === 'run'
        ? await invoke('recipe.run', { id: r.id, genomeId }, crypto.randomUUID())
        : action === 'delete'
          ? await invoke('recipe.delete', { id: r.id, genomeId })
          : await invoke('recipe.schedule', { id: r.id, genomeId, status: r.status === 'paused' ? 'active' : 'paused' });
    setBusyId(null);
    const failTitle = { run: `Couldn’t run ${r.name}`, delete: `Couldn’t delete ${r.name}`, pause: `Couldn’t update ${r.name}` }[action];
    if (!notifyResult(res, undefined, failTitle)) return;
    if (action === 'run') {
      /* A run says what it did — "scheduled 3 posts", "found nothing new" — in
         its own words, rather than a bare "ran". */
      const ranWhy = (res.output as { why?: { summary?: string } } | undefined)?.why?.summary;
      const kind = /fail/i.test(ranWhy ?? '') ? 'error' : /nothing/i.test(ranWhy ?? '') ? 'info' : 'success';
      notify[kind](`${r.name} ran`, ranWhy ? { body: ranWhy } : undefined);
    } else {
      notify.success(action === 'delete' ? `${r.name} deleted` : r.status === 'paused' ? `${r.name} resumed` : `${r.name} paused`);
    }
    void reload();
  }

  if (genomeLoading) return <SparkLoader label="Loading your recipes…" className="min-h-[60vh]" />;
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
          onAddNew={(kind) => openWizard(emptyDraft(kind), null)}
          onManage={(kind) => {
            setManageKind(kind);
            setView('manage');
            window.scrollTo(0, 0);
          }}
          onPreview={(row) =>
            row.contentItemId
              ? router.push(`/agents?draft=${encodeURIComponent(row.contentItemId)}`)
              : row.playbookId
                ? notify.info('Not written yet', {
                    body: `Approve it and SPARK writes${row.formatName ? ` the ${row.formatName} post` : ' it'} and schedules it.`,
                  })
                : notify.info('Nothing to preview', { body: 'No format fits this one, so there is no post to preview.' })
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
          genomeId={genomeId}
          {...(editing ? { editingId: editing.id } : {})}
          draft={draft}
          onDraft={setDraft}
          step={step}
          onStep={setStep}
          onBack={() => {
            if (step === 0) {
              setView(editing ? 'manage' : 'home');
              setDraft(null);
              setEditing(null);
              return;
            }
            setStep(step - 1);
          }}
          onLaunch={() => void launch()}
          busy={busy}
          validation={validation}
          canvaConnected={canvaConnected}
          connecting={connecting}
          onConnectCanva={() => void connectCanva()}
          connectNote={connectNote}
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
          onEdit={(r) => openWizard(draftFromRecipe(r), r)}
          onOpenDraft={(id) => router.push(`/agents?draft=${encodeURIComponent(id)}`)}
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
            openWizard(emptyDraft(kind), null);
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
          onDone={() => void activate()}
        />
      ) : null}

      {loadError ? (
        <p className="px-auto-inset pb-[20px] text-15 text-destructive">{loadError}</p>
      ) : null}
    </>
  );
}
