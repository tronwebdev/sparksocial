'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { PersonalizeStep } from './PersonalizeStep';
import { invoke } from '@/lib/tools';

/**
 * `F6`'s fourth group — "Name your agent", and the face it uses.
 *
 * The naming step is the one the prototype puts most weight on and the build had
 * nowhere to ask: `brands.agent_name` arrived with `F4` (the agent-identity
 * record) and only the settings screen ever wrote it, so every brand met an
 * "Unnamed agent" on its Command Center and the campaign wizard's "Here's what
 * *{name}* will do" had no name to use.
 *
 * ── Why the name saves on blur and not on Continue ────────────────────────
 *
 * Every optional step in this flow saves as it goes, so leaving early loses
 * nothing. It also means the completion screen can greet the agent by name
 * without threading the value through three screens of state.
 *
 * The avatar and voice sit below it, unchanged — `PersonalizeStep` already owns
 * that and it is the same question ("what does it look and sound like") one
 * screen down.
 */
export function AgentStep({ genomeId, brandName }: { genomeId: string; brandName: string }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read once, because somebody may have named it already and an empty field
  // would read as "not set" and then overwrite it with nothing on blur.
  useEffect(() => {
    void (async () => {
      const res = await invoke<{ agentName?: string }>('brand.governance.get', {});
      if (res.status === 'succeeded' && res.output.agentName) {
        setName(res.output.agentName);
        setSaved(res.output.agentName);
      }
    })();
  }, []);

  async function save() {
    const next = name.trim();
    if (next === (saved ?? '')) return;
    setError(null);
    const res = await invoke('brand.governance.set', { agentName: next || null });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? res.error.message : 'Naming it needs approval first.');
      return;
    }
    setSaved(next);
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <label className="text-[13px] font-medium text-ink-muted" htmlFor="onb-agent-name">
          Name your agent
        </label>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          It works {brandName || 'this brand'} on your behalf and signs its work. A name makes the
          difference between reviewing a system and reviewing somebody&rsquo;s work.
        </p>
        <Input
          id="onb-agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          maxLength={60}
          placeholder="Spark"
          className="mt-2 sm:max-w-[320px]"
        />
        {saved ? <p className="mt-1.5 text-[12.5px] text-ink-muted">Saved as {saved}.</p> : null}
        {error ? <p className="mt-1.5 text-[12.5px] text-warn">{error}</p> : null}
      </div>

      <PersonalizeStep genomeId={genomeId} />
    </div>
  );
}
