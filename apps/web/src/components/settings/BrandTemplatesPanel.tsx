'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { invoke } from '@/lib/tools';

/**
 * `SET-WS-BRAND-KITS` → Templates. The prototype draws five peer tabs
 * (`Intros/outros`, `Bumpers`, `Caption presets`, `Versioning & approvals.`,
 * `Lower-Thirds`) over a grid of `Preset 1`…`Preset 8`.
 *
 * ── A template is a line of text ──────────────────────────────────────────
 *
 * Every preset in the design contains a sentence — "Welcome to our channel! Stay
 * tuned for more exciting content." So a template here is not a media file, a
 * motion graphic or a project: it is a saved string with a category and a name,
 * applied by `Use This Brand Preset`. Worth being explicit about, because "intro
 * template" reads like an asset and building it as one would mean an upload path,
 * a render-time concat and a storage bill for a feature whose design is a text
 * field.
 *
 * ── Four tabs, not five ───────────────────────────────────────────────────
 *
 * `Versioning & approvals.` is drawn as a peer tab and has nothing behind it.
 * There is no version number on a brand kit, no approval state, and no control
 * anywhere on that screen that would set either — the tab is a label. It gets an
 * explicit "not built" state rather than an empty grid that looks like a brand
 * with no versions, which is the same call taken for the unbacked panels on the
 * trend detail screen.
 */

type Category = 'intro' | 'outro' | 'bumper' | 'caption' | 'lower_third';

interface KitTemplate {
  id: string;
  category: Category;
  name: string;
  text: string;
}

/**
 * Tab order follows the prototype's, with intros and outros split.
 *
 * The design groups them as one tab (`Intros/outros`) but they are two
 * categories underneath, because where the scene goes differs and because a
 * brand's sign-off line is not interchangeable with its opener. Splitting the tab
 * is the smaller lie than pretending one list serves both.
 */
const TABS: ReadonlyArray<{ key: Category; label: string; hint: string }> = [
  { key: 'intro', label: 'Intros', hint: 'Opens the post. Added as a new first scene.' },
  { key: 'outro', label: 'Outros', hint: 'Signs off. Added as a new last scene.' },
  { key: 'bumper', label: 'Bumpers', hint: 'A short beat in the middle, between two scenes.' },
  { key: 'caption', label: 'Caption presets', hint: 'Replaces a scene’s own words.' },
  { key: 'lower_third', label: 'Lower-thirds', hint: 'Superimposed on a scene, over whatever it already shows.' },
];

const SUGGESTIONS: Record<Category, string[]> = {
  intro: ['Quick one today, and it matters more than it sounds.', "Here's the thing nobody tells you about this."],
  outro: ['That is the whole idea. Tell me if you want the longer version.', 'More like this every week. Follow along if it is useful.'],
  bumper: ['One more thing worth knowing.'],
  caption: ['Save this for the next time it comes up.'],
  lower_third: ['What most people get wrong'],
};

/** Matches `MAX_KIT_TEMPLATES` in `packages/shared/src/brandKit.ts`. */
const MAX_TEMPLATES = 40;

export function BrandTemplatesPanel() {
  const [templates, setTemplates] = useState<KitTemplate[] | null>(null);
  const [tab, setTab] = useState<Category | 'versioning'>('intro');
  const [draftName, setDraftName] = useState('');
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    const res = await invoke<{ kitTemplates: KitTemplate[] }>('brand.governance.get', {});
    if (res.status !== 'succeeded') {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That request was gated.' });
      setTemplates([]);
      return;
    }
    setTemplates(res.output.kitTemplates);
  }

  useEffect(() => {
    void load();
  }, []);

  /**
   * Every mutation sends the whole list, because `brand.governance.set` patches
   * `kitTemplates` as one value. Reading current state and writing it back is
   * therefore the only correct shape — there is no add or remove on the wire.
   */
  async function commit(next: KitTemplate[], ok: string) {
    setBusy(true);
    setMessage(null);
    const res = await invoke<{ kitTemplates: KitTemplate[] }>('brand.governance.set', {
      // `null` clears rather than storing `[]`, the same rule the rest of this
      // screen follows: an empty list and "never set" read identically here and
      // differently to anything that asks whether the brand has templates.
      kitTemplates: next.length ? next : null,
    });
    setBusy(false);
    if (res.status !== 'succeeded') {
      setMessage({ kind: 'err', text: res.status === 'failed' ? res.error.message : 'That change needs approval.' });
      return;
    }
    setTemplates(res.output.kitTemplates);
    setMessage({ kind: 'ok', text: ok });
  }

  async function add(category: Category, text: string, name?: string) {
    const current = templates ?? [];
    if (current.length >= MAX_TEMPLATES) {
      setMessage({ kind: 'err', text: `That is the ${MAX_TEMPLATES}-template limit. Remove one first.` });
      return;
    }
    const inCategory = current.filter((t) => t.category === category).length;
    const template: KitTemplate = {
      // Time-free and collision-checked against what is already stored, so two
      // adds in the same second cannot produce a duplicate id — the tool rejects
      // duplicates, and the panel keys its rows by id.
      id: freshId(current, category),
      category,
      name: name?.trim() || `Preset ${inCategory + 1}`,
      text: text.trim(),
    };
    await commit([...current, template], 'Saved.');
    setDraftName('');
    setDraftText('');
  }

  if (templates === null) {
    return (
      <section className="rounded-lg border border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-24 w-full" />
      </section>
    );
  }

  const active = tab === 'versioning' ? [] : templates.filter((t) => t.category === tab);
  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-[15px] font-medium text-ink">Templates</h2>
      <p className="mt-1 text-[13px] text-ink-muted">
        Lines you reuse &mdash; how a post opens, how it signs off, what goes on screen. Saved here, applied from
        a draft&rsquo;s storyboard.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-[13px] ${
              tab === t.key ? 'bg-ink text-surface' : 'bg-surface-muted text-ink-muted'
            }`}
          >
            {t.label}
            {templates.filter((x) => x.category === t.key).length > 0
              ? ` (${templates.filter((x) => x.category === t.key).length})`
              : ''}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab('versioning')}
          className={`rounded-full px-3 py-1 text-[13px] ${
            tab === 'versioning' ? 'bg-ink text-surface' : 'bg-surface-muted text-ink-muted'
          }`}
        >
          Versioning &amp; approvals
        </button>
      </div>

      {tab === 'versioning' ? (
        <div className="mt-4 rounded-lg border border-dashed border-border p-4">
          <p className="text-[13px] font-medium text-ink">Not built</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            The design draws this as a tab but never draws a version number, a version history, or an
            approval state anywhere on the brand kit &mdash; and nothing in the product records one. An empty
            list here would look like a brand with no versions yet, which would be a different and untrue
            thing. It needs a decision about what a brand-kit version <em>is</em> before it can be built.
          </p>
          <p className="mt-2 text-[12px] text-ink-muted">
            Approvals for <em>posts</em> do exist &mdash; see Review queue and Approval rules under Team Roles.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-[12px] text-ink-muted">{activeTab?.hint}</p>

          {active.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-muted">Nothing saved here yet.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-2">
              {active.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-ink-muted">{t.name}</p>
                    <p className="mt-0.5 text-[13px] text-ink">{t.text}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="text-destructive"
                    onClick={() => void commit(templates.filter((x) => x.id !== t.id), 'Removed.')}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 rounded-lg border border-dashed border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem]">
                <label className="block text-[12px] text-ink-muted" htmlFor="tpl-name">
                  Name
                </label>
                <Input
                  id="tpl-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="optional"
                  className="mt-1.5"
                />
              </div>
              <div className="min-w-[16rem] flex-1">
                <label className="block text-[12px] text-ink-muted" htmlFor="tpl-text">
                  The line
                </label>
                <Input
                  id="tpl-text"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  maxLength={280}
                  className="mt-1.5"
                />
              </div>
              <Button
                disabled={busy || !draftText.trim()}
                onClick={() => void add(tab, draftText, draftName)}
              >
                {busy ? 'Saving…' : 'Add'}
              </Button>
            </div>

            {/*
              Suggestions rather than seeded rows — the same pattern this screen
              already uses for restricted topics and claims to avoid. Writing
              starter copy into a brand's row at migration time would put words
              nobody chose into their posts, and a long list of plausible lines
              invites accepting it unread, which is how every brand ends up with
              the same sign-off.
            */}
            {SUGGESTIONS[tab].length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-wide text-ink-muted">Suggestions</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {SUGGESTIONS[tab].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      disabled={busy}
                      onClick={() => void add(tab, sug)}
                      className="rounded-full bg-surface-muted px-3 py-1 text-left text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {message ? (
        <p className={`mt-3 text-[12px] ${message.kind === 'ok' ? 'text-success' : 'text-destructive'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

/** `intro_1`, `intro_2`, … skipping anything already taken across every category. */
function freshId(existing: KitTemplate[], category: Category): string {
  const taken = new Set(existing.map((t) => t.id));
  for (let n = 1; ; n += 1) {
    const id = `${category}_${n}`;
    if (!taken.has(id)) return id;
  }
}
