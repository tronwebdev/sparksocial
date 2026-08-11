import { describe, expect, it } from 'vitest';
import { maskValue } from '../src/langfuse-mask.js';

/**
 * Masking is the one part of the Langfuse wiring with a security consequence,
 * so it is the part with tests.
 *
 * The concrete risk is not hypothetical: `direct.session.send` takes an owner's
 * phone number, asset captions describe a brand's private material, and post
 * copy is unpublished until it is not. `redactRecipient` already keeps the
 * number out of `tool_calls`; sending the same field to a third-party vendor
 * would undo that a layer up.
 */

const asJson = (v: unknown) => JSON.stringify(maskValue(v));

describe('maskValue', () => {
  it('does not leak a phone number', () => {
    // The exact field `direct.session.send` receives.
    const out = asJson({ to: '+2348012345678', genomeId: 'gen_barber' });
    expect(out).not.toContain('2348012345678');
    // The identifier survives, because a trace that cannot say which brand a
    // call touched is not worth reading.
    expect(out).toContain('gen_barber');
  });

  it('does not leak unpublished post copy', () => {
    const copy = 'The fade finishing, up close, no talking — book your Saturday slot now.';
    expect(asJson({ text: copy })).not.toContain('fade finishing');
  });

  it('keeps identifiers and enums, which are what make a trace navigable', () => {
    const out = maskValue({
      genomeId: 'gen_saas',
      playbookId: 'pb_workflow_clip',
      platform: 'instagram',
      mode: 'assemble',
      limit: 25,
    }) as Record<string, unknown>;

    expect(out).toEqual({
      genomeId: 'gen_saas',
      playbookId: 'pb_workflow_clip',
      platform: 'instagram',
      mode: 'assemble',
      limit: 25,
    });
  });

  it('is allow-list, so an unknown field is redacted by default', () => {
    // The property that matters as the codebase grows: a tool gaining a field
    // must not silently start shipping it. New fields are invisible in Langfuse
    // until someone adds them deliberately — a bug report, not a breach.
    const out = maskValue({ someNewSecretField: 'sk-live-abc123' }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('sk-live-abc123');
    // But the key survives, so the gap is visible in a trace.
    expect(Object.keys(out)).toEqual(['someNewSecretField']);
  });

  it('summarises an embedding rather than sending 1536 floats', () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => i / 1536);
    expect(maskValue({ embedding })).toEqual({ embedding: '[redacted array(1536)]' });
  });

  it('reports the size of long strings, which is useful without being the content', () => {
    const long = 'x'.repeat(482);
    expect(maskValue(long)).toBe('[string(482)]');
    // Short strings pass through — an enum or an id is not a leak.
    expect(maskValue('assemble')).toBe('assemble');
  });

  it('recurses into nested objects so nested identifiers still surface', () => {
    const out = JSON.stringify(maskValue({ plan: { genomeId: 'gen_x', caption: 'a private caption' } }));
    expect(out).toContain('gen_x');
    expect(out).not.toContain('a private caption');
  });

  it('terminates on deeply nested and circular structures', () => {
    // A trace sink that hangs or blows the stack takes the request with it.
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 50; i++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => maskValue(deep)).not.toThrow();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => maskValue(circular)).not.toThrow();
  });

  it('passes null and undefined through untouched', () => {
    expect(maskValue(null)).toBeNull();
    expect(maskValue(undefined)).toBeUndefined();
  });
});
