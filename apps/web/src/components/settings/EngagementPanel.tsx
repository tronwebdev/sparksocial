'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { invoke } from '@/lib/tools';

/**
 * ENGAGEMENT INTELLIGENCE — `SET-WS-EI-AUTONOMY` through `SET-WS-EI-SALES`.
 *
 * Five prototypes give this its own settings section. In the build it was two
 * blocks inside `GovernancePanel`, a 850-line component that also owned
 * guardrails, voice, posting windows and the brand kit — so the settings
 * navigation could not have named sections while one component spanned four of
 * them. This is the half that moved out.
 *
 * ── Two panels, one tool, and why that is fine ────────────────────────────
 *
 * Both this and `GovernancePanel` write through `brand.governance.set`, which
 * is a partial patch by contract: omitted fields are left alone. So each panel
 * sends only its own fields and neither can clobber the other.
 *
 * That is better than the single save it replaces, not merely equivalent.
 * Before, editing your voice sent the engagement and sales fields too — whatever
 * the form happened to be holding — so a stale value in a section you had not
 * looked at could be written back over a change made in another tab.
 *
 * ── What is enforced, and what is only recorded ───────────────────────────
 *
 * The autonomy level and the escalation list are both genuinely enforced:
 * `policy.ts` rule 6 reads the level, and `engage.classify` overrides itself
 * deterministically on an escalation keyword. The handoff rule is applied by
 * `engage.opportunity.create`. The qualification moves are the one group here
 * that is currently recorded and not yet read by anything — they describe what
 * the agent may do in a conversation, and the reply path does not consult them.
 */

interface Governance {
  engagementAutonomy: 'off' | 'suggest' | 'auto';
  engagementTypes: string[];
  salesQualification: string[];
  salesHandoff: { hot: string; warm: string; cold: string };
  usingDefaultHandoff: boolean;
  salesDestination?: string;
  salesEscalationKeywords: string[];
}

/**
 * PRD §8.8's autonomy level. `off` is not the same as unset — it is the
 * conservative rung, and it is what `policy.ts` rule 6 reads as
 * "autonomy has not been configured", which holds every reply for approval.
 */
const ENGAGEMENT_LEVELS = [
  { value: 'off', label: 'Draft only', hint: 'SPARK writes the reply. You send it.' },
  { value: 'suggest', label: 'Suggest and hold', hint: 'Replies queue for your approval before sending.' },
  { value: 'auto', label: 'Answer the safe ones', hint: 'SPARK sends replies it judged safe, on its own.' },
] as const;

const ENGAGEMENT_TYPES = [
  { value: 'comment', label: 'Comments' },
  { value: 'dm', label: 'DMs' },
  { value: 'story_reply', label: 'Story replies' },
] as const;


/**
 * Sales Assist (`SET-WS-EI-SALES`).
 *
 * Each option authorises the agent to *do* something specific, so the labels
 * say what will happen rather than naming a capability — "Share your booking
 * link" is a promise the owner is making, and it should read like one.
 */
const QUALIFICATION_OPTIONS = [
  { value: 'ask_qualifying_questions', label: 'Ask qualifying questions', hint: 'What they want, when, budget.' },
  { value: 'share_booking_link', label: 'Share your booking link', hint: 'Sends people straight to your calendar.' },
  { value: 'share_pricing_link', label: 'Share your pricing page', hint: 'Only if your prices are public.' },
  { value: 'collect_contact_details', label: 'Collect contact details', hint: 'Asks for a name and a way to reach them.' },
] as const;

const HANDOFF_DESTINATIONS = [
  { value: 'crm_notify', label: 'Send on + notify me' },
  { value: 'save_notify', label: 'Save + notify me' },
  { value: 'nurture_only', label: 'Nurture only' },
] as const;

const TEMPERATURES = [
  { value: 'hot', label: 'Hot', emoji: '\ud83d\udd25', hint: 'Ready to buy' },
  { value: 'warm', label: 'Warm', emoji: '\ud83c\udf21\ufe0f', hint: 'Interested, not yet' },
  { value: 'cold', label: 'Cold', emoji: '\u2744\ufe0f', hint: 'Just looking' },
] as const;

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function EngagementPanel() {
  const [loading, setLoading] = useState(true);
  const [engagementAutonomy, setEngagementAutonomy] = useState<'off' | 'suggest' | 'auto'>('off');
  const [engagementTypes, setEngagementTypes] = useState<string[]>([]);
  const [salesQualification, setSalesQualification] = useState<string[]>([]);
  const [salesHandoff, setSalesHandoff] = useState<{ hot: string; warm: string; cold: string }>({
    hot: 'crm_notify',
    warm: 'save_notify',
    cold: 'nurture_only',
  });
  const [usingDefaultHandoff, setUsingDefaultHandoff] = useState(true);
  const [salesDestination, setSalesDestination] = useState('');
  const [escalationText, setEscalationText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await invoke<Governance>('brand.governance.get', {});
      setLoading(false);
      if (res.status !== 'succeeded') return;
      const g = res.output;
      setEngagementAutonomy(g.engagementAutonomy);
      setEngagementTypes(g.engagementTypes);
      setSalesQualification(g.salesQualification);
      setSalesHandoff(g.salesHandoff);
      setUsingDefaultHandoff(g.usingDefaultHandoff);
      setSalesDestination(g.salesDestination ?? '');
      setEscalationText(g.salesEscalationKeywords.join(', '));
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);

    // Only this section's fields. `brand.governance.set` leaves the rest alone.
    const res = await invoke<Governance>('brand.governance.set', {
      engagementAutonomy,
      // Empty means every type, which is a different fact from "none" — so it
      // clears rather than storing an empty list.
      engagementTypes: engagementTypes.length ? engagementTypes : null,
      // Same `null`-clears rule: no qualification moves is the safe state, and
      // an empty list has to be able to mean that rather than being unsendable.
      salesQualification: salesQualification.length ? salesQualification : null,
      // Only send a handoff map the brand has actually chosen. Sending the
      // resolved default back would convert "no preference" into a choice, and
      // the default could then never move.
      salesHandoff: usingDefaultHandoff ? null : salesHandoff,
      salesDestination: salesDestination.trim() ? salesDestination.trim() : null,
      salesEscalationKeywords: splitList(escalationText).length ? splitList(escalationText) : null,
    });

    setBusy(false);
    if (res.status === 'succeeded') {
      // Resolved server-side, so an incomplete map the client sent comes back as
      // the defaults rather than leaving the screen claiming a rule nothing obeys.
      setUsingDefaultHandoff(res.output.usingDefaultHandoff);
      setSalesHandoff(res.output.salesHandoff);
      setMessage({ kind: 'ok', text: 'Saved.' });
      return;
    }
    setMessage({
      kind: 'err',
      text: res.status === 'failed' ? res.error.message : 'That change needs approval.',
    });
  }

  return (
    <section aria-busy={loading} className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-[18px] font-semibold text-ink">Engagement Intelligence</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
        What SPARK may say back to your audience on its own, and what it does when somebody sounds like a
        customer rather than a commenter.
      </p>

      {loading ? (
        <PanelSkeleton rows={2} />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-7">
      {/* ── Engagement (§8.8) ──────────────────────────────────────── */}
      <div>
        <h3 className="text-[14px] font-medium text-ink">Answering your audience</h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          How much SPARK may say back on its own. It cannot reply at all until a campaign has been
          running two weeks with five posts out — this decides what happens after that.
        </p>

        <ul className="mt-3 grid grid-cols-1 gap-2">
          {ENGAGEMENT_LEVELS.map((l) => (
            <li key={l.value}>
              <button
                type="button"
                aria-pressed={engagementAutonomy === l.value}
                onClick={() => setEngagementAutonomy(l.value)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  engagementAutonomy === l.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                <span className="block text-[14px] font-medium text-ink">{l.label}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">{l.hint}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[12px] font-medium text-ink-muted">Where it may answer</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ENGAGEMENT_TYPES.map((t) => {
            // Empty means all three, so nothing selected reads as "everywhere".
            const on = engagementTypes.length === 0 || engagementTypes.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setEngagementTypes((prev) => {
                    const current = prev.length ? prev : ENGAGEMENT_TYPES.map((x) => x.value);
                    const next = current.includes(t.value)
                      ? current.filter((x) => x !== t.value)
                      : [...current, t.value];
                    // Back to "all" rather than storing a list that happens
                    // to contain everything.
                    return next.length === ENGAGEMENT_TYPES.length ? [] : next;
                  })
                }
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-ink-muted hover:bg-surface-muted',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sales Assist (`SET-WS-EI-SALES`) ───────────────────────────
          The screen the design specified and nothing could store. Four
          qualification moves, a handoff rule per lead temperature, and the
          escalation list \u2014 which is the one hard guarantee here:
          `engage.classify` overrides itself deterministically on a match,
          rather than asking the model to weigh it against everything else. */}
      <div>
        <h3 className="text-[14px] font-medium text-ink">Turning interest into work</h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          When someone sounds like a customer rather than a commenter, this decides what SPARK may do
          about it and where the lead goes.
        </p>

        <p className="mt-3 text-[12px] font-medium text-ink-muted">What SPARK may do</p>
        <ul className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUALIFICATION_OPTIONS.map((o) => {
            const on = salesQualification.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSalesQualification((prev) =>
                      prev.includes(o.value) ? prev.filter((x) => x !== o.value) : [...prev, o.value],
                    )
                  }
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    on ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
                  )}
                >
                  <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {salesQualification.length === 0 && (
          <p className="mt-2 text-[12px] text-ink-muted">
            Nothing selected: SPARK will flag the lead and let you take it from there.
          </p>
        )}

        <p className="mt-4 text-[12px] font-medium text-ink-muted">Where each lead goes</p>
        <div className="mt-1.5 space-y-2">
          {TEMPERATURES.map((t) => (
            <div key={t.value} className="flex flex-wrap items-center gap-2">
              <span className="flex w-[132px] shrink-0 items-baseline gap-1.5">
                <span aria-hidden>{t.emoji}</span>
                <span className="text-[13px] font-medium text-ink">{t.label}</span>
                <span className="text-[11px] text-ink-muted">{t.hint}</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {HANDOFF_DESTINATIONS.map((d) => {
                  const on = salesHandoff[t.value] === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSalesHandoff((prev) => ({ ...prev, [t.value]: d.value }));
                        // Touching any row makes the whole map this brand's
                        // own choice. A partly-chosen map is a lead with no
                        // rule, so it is all three or the defaults.
                        setUsingDefaultHandoff(false);
                      }}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-ink-muted hover:bg-surface-muted',
                        usingDefaultHandoff && on && 'opacity-60',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {usingDefaultHandoff && (
          <p className="mt-2 text-[12px] text-ink-muted">
            These are the defaults. Change any row to make them yours.
          </p>
        )}

        <label className="mt-4 block text-[12px] font-medium text-ink-muted" htmlFor="gov-sales-destination">
          Send leads on to
        </label>
        <p className="mt-1 text-[12px] text-ink-muted">
          An email address or a CRM inbox. Only used for the rows set to &ldquo;send on&rdquo; \u2014 without
          it, those leads wait in Sales Opportunities instead.
        </p>
        <Input
          id="gov-sales-destination"
          value={salesDestination}
          onChange={(e) => setSalesDestination(e.target.value)}
          placeholder="sales@yourcompany.com"
          className="mt-1.5 max-w-md"
        />

        <label className="mt-4 block text-[12px] font-medium text-ink-muted" htmlFor="gov-escalation">
          Always send these to you
        </label>
        <p className="mt-1 text-[12px] text-ink-muted">
          A message containing any of these words goes to Needs Review and SPARK will not offer a reply for
          it \u2014 no matter how routine it looked. Comma separated.
        </p>
        <Input
          id="gov-escalation"
          value={escalationText}
          onChange={(e) => setEscalationText(e.target.value)}
          placeholder="refund, chargeback, lawsuit, complaint, scam"
          className="mt-1.5 max-w-xl"
        />
        {splitList(escalationText).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {splitList(escalationText).map((word) => (
              <span
                key={word}
                className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] text-ink"
              >
                {word}
              </span>
            ))}
          </div>
        )}
      </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button size="sm" disabled={busy || loading} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {message && (
          <span className={cn('text-[13px]', message.kind === 'ok' ? 'text-ink-muted' : 'text-destructive')}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
