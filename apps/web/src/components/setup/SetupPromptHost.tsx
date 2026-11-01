'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetupRequirement } from '@sparksocial/shared';
import { Button } from '@/components/ui/button';
import { Busy } from '@/components/brand/SparkLoader';
import { PlatformIcon } from '@/components/common/PlatformIcon';
import { CredentialConnectModal } from '@/components/settings/CredentialConnectModal';
import { invoke } from '@/lib/tools';
import { notifyResult } from '@/lib/notify';
import { platformLabel } from '@/lib/platforms';
import { registerSetupResolver } from '@/lib/setupPrompt';
import { openConsentPopup, useConsentPopupResult } from '@/lib/oauthPopup';

/**
 * The dialogs `lib/setupPrompt.ts` opens — one per kind of missing setup.
 *
 * Each says what is missing and why the action needs it, takes the one thing
 * that fixes it, and resolves `true` once it is saved; `invoke` then runs the
 * action the person had asked for. Cancel resolves `false` and the action's
 * own failure is shown as before, so nothing is worse than it was.
 *
 * Mounted once, in `AppProviders`.
 */
export function SetupPromptHost() {
  const [open, setOpen] = useState<{ requirement: SetupRequirement; done: (fixed: boolean) => void } | null>(null);

  useEffect(
    () =>
      registerSetupResolver(
        (requirement) =>
          new Promise<boolean>((resolve) => {
            setOpen({ requirement, done: resolve });
          }),
      ),
    [],
  );

  const finish = useCallback(
    (fixed: boolean) => {
      open?.done(fixed);
      setOpen(null);
    },
    [open],
  );

  if (!open) return null;
  const r = open.requirement;
  if (r.kind === 'genome_field') return <GenomeFieldPrompt requirement={r} onDone={finish} />;
  if (r.kind === 'connection') return <ConnectPrompt genomeId={r.genomeId} provider={r.platform} onDone={finish} />;
  if (r.kind === 'canva') return <ConnectPrompt genomeId={r.genomeId} provider="canva" onDone={finish} />;
  return <ConsentPrompt consent={r.consent} onDone={finish} />;
}

/* ── The shell ─────────────────────────────────────────────────────────── */

/**
 * A small dialog of its own rather than `ModalShell`.
 *
 * These open *over* other dialogs — a trend's repurpose panel, a draft — and
 * `ModalShell` closes on any Escape heard by the document, so one Escape would
 * have closed both. This listens first (capture, on window) and keeps the key
 * to itself; it also sits a layer above `ModalShell`'s z-80.
 */
function PromptShell({
  label,
  onCancel,
  children,
}: {
  label: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 animate-fade-in cursor-default border-0 motion-reduce:animate-none"
        style={{ background: 'rgba(40,40,40,0.45)' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative w-[480px] max-w-full animate-modal-in rounded-[20px] bg-white p-[28px] motion-reduce:animate-none"
        style={{ boxShadow: '0 40px 100px -30px rgba(0,0,0,0.45)' }}
      >
        {children}
      </div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="text-20 font-semibold leading-snug text-ink">{children}</h2>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="mt-[8px] text-15 leading-[1.5] text-ink-muted">{children}</p>;
}

const fieldClass =
  'mt-[18px] h-[52px] w-full rounded-[10px] border-0 bg-[#F3F4F8] px-[18px] text-16 text-ink outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ss-accent-purple)]';

/* ── A genome text field — the CTA ─────────────────────────────────────── */

/**
 * Which tool writes a genome path. `offer.*` and `identity.*` are flat string
 * fields both setters merge one key at a time; anything else has no setter
 * that takes a single string, so the dialog says where to set it instead.
 */
function setterFor(genomeId: string, path: string, value: string): { tool: string; input: unknown } | null {
  const [section, key, ...rest] = path.split('.');
  if (!key || rest.length) return null;
  if (section === 'offer') return { tool: 'genome.offer.set', input: { genomeId, offer: { [key]: value } } };
  if (section === 'identity') return { tool: 'genome.identity.set', input: { genomeId, identity: { [key]: value } } };
  return null;
}

function GenomeFieldPrompt({
  requirement,
  onDone,
}: {
  requirement: Extract<SetupRequirement, { kind: 'genome_field' }>;
  onDone: (fixed: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const setter = setterFor(requirement.genomeId, requirement.path, value.trim());
  // Whether this path can be set from here at all — not whether anything is typed yet.
  const settable = setterFor(requirement.genomeId, requirement.path, '') !== null;
  const cancel = useCallback(() => onDone(false), [onDone]);

  async function save() {
    if (!setter || !value.trim() || saving) return;
    setSaving(true);
    const res = await invoke(setter.tool, setter.input);
    setSaving(false);
    if (notifyResult(res, undefined, `Couldn’t save ${requirement.label}`)) onDone(true);
  }

  const isCta = requirement.path === 'offer.primary_cta';
  return (
    <PromptShell label={`Add ${requirement.label}`} onCancel={cancel}>
      <Title>Add {requirement.label} to carry on</Title>
      <Body>
        {requirement.hint}{' '}
        {settable ? (
          'It is saved to your brand, so you will not be asked again.'
        ) : (
          <>
            It is set in{' '}
            <a href="/settings" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">
              Settings
            </a>
            ; this stays open while you do.
          </>
        )}
      </Body>
      {settable ? (
        <input
          autoFocus
          type="text"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder={isCta ? 'e.g. Book your table today' : 'Type it here'}
          aria-label={requirement.label}
          className={fieldClass}
        />
      ) : null}
      <div className="mt-[22px] flex justify-end gap-[10px]">
        <Button variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        {settable ? (
          <Button onClick={() => void save()} disabled={!value.trim() || saving}>
            {saving ? <Busy>Saving…</Busy> : 'Save and continue'}
          </Button>
        ) : (
          <Button onClick={() => onDone(true)}>I have set it — try again</Button>
        )}
      </div>
    </PromptShell>
  );
}

/* ── An account: a publishing platform, or Canva ───────────────────────── */

const CREDENTIAL_PROVIDERS = new Set(['bluesky']);

function ConnectPrompt({
  genomeId,
  provider,
  onDone,
}: {
  genomeId: string;
  provider: string;
  onDone: (fixed: boolean) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [credentials, setCredentials] = useState(false);
  const label = provider === 'canva' ? 'Canva' : platformLabel(provider);
  const cancel = useCallback(() => onDone(false), [onDone]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  /* The popup's verdict. Anything but "connected" leaves the dialog open, so
     the person can try again or cancel; the toast has already said why. */
  useConsentPopupResult((result) => {
    if (result?.provider === provider && result.social === 'connected') doneRef.current(true);
  }, waiting);

  async function connect() {
    if (CREDENTIAL_PROVIDERS.has(provider)) {
      setCredentials(true);
      return;
    }
    setOpening(true);
    const opened = await openConsentPopup(async () => {
      const res =
        provider === 'canva'
          ? await invoke<{ authorizeUrl: string }>('brand.oauth.connect', { genomeId, provider: 'canva' })
          : await invoke<{ authorizeUrl: string }>('integration.connect', { genomeId, provider });
      return notifyResult(res, undefined, `Couldn’t connect ${label}`) ? res.output.authorizeUrl : null;
    });
    setOpening(false);
    if (opened === 'opened') setWaiting(true);
  }

  if (credentials) {
    return (
      <CredentialConnectModal
        platform={provider}
        genomeId={genomeId}
        onClose={() => setCredentials(false)}
        onConnected={() => onDone(true)}
      />
    );
  }

  return (
    <PromptShell label={`Connect ${label}`} onCancel={cancel}>
      <div className="flex items-center gap-[12px]">
        {provider === 'canva' ? null : <PlatformIcon platform={provider} size={34} />}
        <Title>Connect {label} to carry on</Title>
      </div>
      <Body>
        {provider === 'canva'
          ? 'This uses your own Canva account, and this brand has not connected one yet. Connect it here and SPARK picks up where it stopped.'
          : `This goes to ${label}, and this brand has no ${label} account connected yet. Connect it here and SPARK picks up where it stopped.`}
      </Body>
      {waiting ? (
        <p className="mt-[14px] text-14 text-ink-muted">Finish in the sign-in window — this closes on its own when you are done.</p>
      ) : null}
      <div className="mt-[22px] flex justify-end gap-[10px]">
        <Button variant="outline" onClick={cancel}>
          Cancel
        </Button>
        <Button onClick={() => void connect()} disabled={opening}>
          {opening ? <Busy>Opening…</Busy> : waiting ? `Open ${label} again` : `Connect ${label}`}
        </Button>
      </div>
    </PromptShell>
  );
}

/* ── Consent to use a real person's likeness or voice ──────────────────── */

function ConsentPrompt({
  consent,
  onDone,
}: {
  consent: 'avatar_clone' | 'voice_clone';
  onDone: (fixed: boolean) => void;
}) {
  const [subject, setSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const what = consent === 'avatar_clone' ? 'likeness' : 'voice';
  const cancel = useCallback(() => onDone(false), [onDone]);

  async function grant() {
    const who = subject.trim();
    if (!who || saving) return;
    setSaving(true);
    // Not idempotent: each grant is its own record, so each press is its own key.
    const res = await invoke('genome.consent.grant', { kind: consent, subject: who }, crypto.randomUUID());
    setSaving(false);
    if (notifyResult(res, undefined, 'Couldn’t record consent')) onDone(true);
  }

  return (
    <PromptShell label={`Record consent for a ${what}`} onCancel={cancel}>
      <Title>Whose {what} is this?</Title>
      <Body>
        SPARK records who gave permission before it uses a real person&rsquo;s {what}. Name them and it carries on.
      </Body>
      <input
        autoFocus
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void grant()}
        placeholder="Full name"
        aria-label="Name of the person"
        className={fieldClass}
      />
      <p className="mt-[12px] text-13 leading-[1.45] text-ink-muted">
        By continuing you confirm this person has agreed to their {what} being used in this brand&rsquo;s content. You
        can withdraw it at any time in Settings → Brand Kit.
      </p>
      <div className="mt-[22px] flex justify-end gap-[10px]">
        <Button variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void grant()} disabled={!subject.trim() || saving}>
          {saving ? <Busy>Saving…</Busy> : 'Confirm and continue'}
        </Button>
      </div>
    </PromptShell>
  );
}
