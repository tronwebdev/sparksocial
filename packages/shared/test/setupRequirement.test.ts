import { describe, expect, it } from 'vitest';
import { genomeFieldRequirement, readSetupRequirement } from '../src/setupRequirement.js';

/**
 * `readSetupRequirement` is the gate on the one piece of `ToolError.meta` the
 * API sends to the browser. Everything that is not exactly a requirement must
 * come back as nothing — `meta` holds ids, vendor bodies and paths.
 */
describe('setup requirements', () => {
  it('describes a missing CTA in the words a person reads', () => {
    const r = genomeFieldRequirement('gen_1', 'offer.primary_cta');
    expect(r).toMatchObject({ kind: 'genome_field', genomeId: 'gen_1', path: 'offer.primary_cta', label: 'a call to action' });
  });

  it('reads each kind back out of meta', () => {
    expect(readSetupRequirement({ requires: { kind: 'canva', genomeId: 'gen_1' } })).toEqual({ kind: 'canva', genomeId: 'gen_1' });
    expect(readSetupRequirement({ requires: { kind: 'connection', genomeId: 'g', platform: 'x' } })?.kind).toBe('connection');
    expect(readSetupRequirement({ requires: { kind: 'consent', consent: 'voice_clone' } })?.kind).toBe('consent');
  });

  it('passes nothing else through', () => {
    expect(readSetupRequirement(undefined)).toBeUndefined();
    expect(readSetupRequirement({ genomeId: 'gen_1', vendorBody: '…' })).toBeUndefined();
    expect(readSetupRequirement({ requires: { kind: 'shell', cmd: 'rm' } })).toBeUndefined();
    expect(readSetupRequirement({ requires: { kind: 'consent', consent: 'anything' } })).toBeUndefined();
    // Extra keys on a valid requirement are stripped, not forwarded.
    expect(readSetupRequirement({ requires: { kind: 'canva', genomeId: 'g', token: 'secret' } })).toEqual({ kind: 'canva', genomeId: 'g' });
  });
});
