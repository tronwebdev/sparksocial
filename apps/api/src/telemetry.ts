import * as Sentry from '@sentry/node';
import { PostHog } from 'posthog-node';
import { Langfuse } from 'langfuse';
import type { ToolCallRecord } from '@sparksocial/tools';
import { maskValue } from './langfuse-mask.js';

/**
 * OBSERVABILITY — master plan §2.2, §11.
 *
 *   *"Langfuse (traces/prompts/cost) + OpenTelemetry + Sentry. **Every agent run
 *   replayable** — required for the 'why' surface."*
 *
 * Three sinks, one interface, and every one of them optional. A missing key
 * disables exactly that sink and nothing else — the server still boots, the
 * tools still run, and `/health` reports which are live. Local development on a
 * clean checkout must not require four vendor accounts.
 *
 * ── What goes where, and why it is not one sink ────────────────────────────
 *
 *   **Langfuse** — agent runs, prompts, token cost. The plan's replayability
 *   requirement is about *reasoning*, and generic APM cannot represent a
 *   model call.
 *
 *   **Sentry** — unhandled errors only. A `ToolError` is a *decision* the
 *   product made (denied, gated, rate-limited) and is already on the audit
 *   row; reporting those as exceptions would bury the real ones under
 *   thousands of working refusals.
 *
 *   **PostHog** — product analytics. §11 gates the autonomy rollout on it,
 *   which means it needs tool-level events, not page views.
 *
 * OTLP export is deliberately not wired here. Langfuse already covers the agent
 * traces that matter, and adding an OTel pipeline before there is a collector to
 * receive it is infrastructure with no reader.
 */

export interface Telemetry {
  /** Called for every tool invocation, whatever the outcome. */
  toolCall(record: ToolCallRecord): void;
  /** Unhandled failures only — never a governance decision. */
  error(err: unknown, context?: Record<string, unknown>): void;
  /** Which sinks are live, for /health. */
  status(): { sentry: boolean; posthog: boolean; langfuse: boolean };
  /** The raw client, for tracing agent runs — see langfuse-recorder.ts. Null when unconfigured. */
  langfuse: Langfuse | null;
  /** Flush before exit; serverless and containers both kill without warning. */
  shutdown(): Promise<void>;
}

export function createTelemetry(env: NodeJS.ProcessEnv = process.env): Telemetry {
  const sentryDsn = env.SENTRY_DSN?.trim();
  const posthogKey = env.POSTHOG_API_KEY?.trim();
  const langfusePublic = env.LANGFUSE_PUBLIC_KEY?.trim();
  const langfuseSecret = env.LANGFUSE_SECRET_KEY?.trim();

  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: env.NODE_ENV ?? 'development',
      // The deploy workflow stamps this from the commit SHA, so an error in
      // production is traceable to a build without guessing.
      release: env.REVISION || undefined,
      tracesSampleRate: 0,
    });
  }

  const posthog = posthogKey
    ? new PostHog(posthogKey, { host: env.POSTHOG_HOST || 'https://eu.i.posthog.com' })
    : null;

  const langfuse =
    langfusePublic && langfuseSecret
      ? new Langfuse({
          publicKey: langfusePublic,
          secretKey: langfuseSecret,
          baseUrl: env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        })
      : null;

  return {
    langfuse,

    toolCall(record) {
      // Guarded individually: one misconfigured sink must not stop the others,
      // and none of them may ever throw into the request path. Telemetry that
      // can fail a tool call is worse than no telemetry.
      try {
        posthog?.capture({
          distinctId: record.userId ?? `agent:${record.orgId}`,
          event: 'tool_call',
          properties: {
            tool: record.tool,
            caller: record.caller,
            effect: record.effect,
            decision: record.decision,
            status: record.status,
            costCents: record.costCents,
            orgId: record.orgId,
            genomeId: record.genomeId,
            ruleId: record.ruleId,
          },
        });
      } catch {
        /* analytics is never load-bearing */
      }

      try {
        if (langfuse && record.runId) {
          // Keyed on runId so every tool call the agent made lands on one
          // replayable trace — which is the §11 requirement, not a log line
          // per call.
          langfuse.trace({ id: record.runId, name: 'agent.run', userId: record.userId }).span({
            name: record.tool,
            // Masked: tool inputs carry phone numbers, private captions and
            // unpublished copy. `redactRecipient` keeps those out of the audit
            // row; sending them to a vendor would undo that one layer up.
            input: maskValue(record.input),
            output: maskValue(record.output),
            metadata: {
              effect: record.effect,
              decision: record.decision,
              status: record.status,
              costCents: record.costCents,
              why: record.why,
            },
          });
        }
      } catch {
        /* tracing is never load-bearing */
      }
    },

    error(err, context) {
      if (!sentryDsn) return;
      try {
        Sentry.captureException(err, context ? { extra: context } : undefined);
      } catch {
        /* reporting an error must not raise one */
      }
    },

    status: () => ({
      sentry: Boolean(sentryDsn),
      posthog: Boolean(posthog),
      langfuse: Boolean(langfuse),
    }),

    async shutdown() {
      await Promise.allSettled([
        posthog ? posthog.shutdown() : Promise.resolve(),
        langfuse ? langfuse.shutdownAsync() : Promise.resolve(),
        sentryDsn ? Sentry.close(2000) : Promise.resolve(),
      ]);
    },
  };
}
