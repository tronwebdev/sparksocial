import { describe, expect, it } from 'vitest';
import { createTelemetry } from '../src/telemetry.js';
import type { ToolCallRecord } from '@sparksocial/tools';

/**
 * Two properties, both about what happens when observability is *not* working.
 *
 * A clean checkout has none of these keys, and a deployment can lose a vendor at
 * any time. Neither may cost a tool call — telemetry that can fail a request is
 * worse than no telemetry, because it converts an outage in a reporting service
 * into an outage in the product.
 */

const record = (over: Partial<ToolCallRecord> = {}): ToolCallRecord =>
  ({
    id: '00000000-0000-0000-0000-000000000001',
    tool: 'genome.list',
    version: 1,
    caller: 'user',
    orgId: 'org_1',
    role: 'owner',
    input: {},
    effect: 'read',
    decision: 'allow',
    status: 'succeeded',
    costCents: 0,
    at: new Date(),
    ...over,
  }) as ToolCallRecord;

describe('telemetry with no keys configured', () => {
  const telemetry = createTelemetry({} as NodeJS.ProcessEnv);

  it('reports every sink as off', () => {
    expect(telemetry.status()).toEqual({ sentry: false, posthog: false, langfuse: false });
  });

  it('accepts tool calls without throwing', () => {
    // The clean-checkout path. `npm run dev:api` must work with an empty .env.
    expect(() => telemetry.toolCall(record())).not.toThrow();
  });

  it('accepts errors without throwing', () => {
    expect(() => telemetry.error(new Error('boom'))).not.toThrow();
  });

  it('shuts down cleanly', async () => {
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe('telemetry status reflects configuration', () => {
  it('turns a sink on only when its key is present', () => {
    expect(createTelemetry({ SENTRY_DSN: 'https://x@y.ingest.sentry.io/1' } as NodeJS.ProcessEnv).status())
      .toMatchObject({ sentry: true, posthog: false, langfuse: false });

    expect(createTelemetry({ POSTHOG_API_KEY: 'phc_x' } as NodeJS.ProcessEnv).status())
      .toMatchObject({ posthog: true, sentry: false });
  });

  it('requires BOTH Langfuse keys, not either', () => {
    // A half-configured tracer is the failure mode that looks configured on
    // /health and silently records nothing.
    const publicOnly = createTelemetry({ LANGFUSE_PUBLIC_KEY: 'pk' } as NodeJS.ProcessEnv);
    const secretOnly = createTelemetry({ LANGFUSE_SECRET_KEY: 'sk' } as NodeJS.ProcessEnv);
    const both = createTelemetry({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    } as NodeJS.ProcessEnv);

    expect(publicOnly.status().langfuse).toBe(false);
    expect(secretOnly.status().langfuse).toBe(false);
    expect(both.status().langfuse).toBe(true);
  });

  it('treats a whitespace-only key as unset', () => {
    // `.env` templates leave `KEY=` on every line; an editor or a shell can turn
    // that into `KEY= `. Trimming means a blank line never half-enables a sink.
    expect(createTelemetry({ SENTRY_DSN: '   ' } as NodeJS.ProcessEnv).status().sentry).toBe(false);
  });
});

describe('a broken sink never reaches the caller', () => {
  it('swallows a failure inside toolCall', () => {
    const telemetry = createTelemetry({ POSTHOG_API_KEY: 'phc_x' } as NodeJS.ProcessEnv);
    // A record with a payload that cannot be serialised — a circular structure
    // is the realistic version of "the sink threw on something we passed it".
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => telemetry.toolCall(record({ input: circular }))).not.toThrow();
  });
});
