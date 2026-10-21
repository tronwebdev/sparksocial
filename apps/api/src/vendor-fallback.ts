import { ToolError } from '@sparksocial/shared';

/**
 * Try `primary`; on a vendor failure, try `backup` once.
 *
 * Lifted out of `image-client.ts` unchanged when video generation grew a second
 * provider, because the interesting part of it is a judgement rather than a
 * mechanism, and that judgement is identical for pixels and for frames.
 *
 * ── What counts as worth retrying elsewhere ──────────────────────────────
 *
 * Only `UPSTREAM_FAILED`. A `GUARDRAIL_BLOCKED` or an `INVALID_INPUT` means the
 * *request* is the problem, and asking a second vendor the same bad question
 * wastes money to get the same answer — twice as slowly. An exhausted balance,
 * a rate limit, a vendor outage: those are about the vendor, and a different
 * vendor is the only retry that can succeed.
 *
 * Video makes that distinction worth more than image did. A rejected clip can
 * be five minutes of waiting and a few tens of cents, so sending a prompt the
 * first model already refused to a second one is not a cheap mistake.
 *
 * ── Why the first error is what surfaces if both fail ────────────────────
 *
 * The backup's failure is almost always less interesting — it is the second
 * thing tried, often unconfigured or rejecting for its own unrelated reason —
 * while the primary's carries the cause anyone would act on ("fal is out of
 * credit"). Both are logged; one is thrown.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * Generic over the call rather than typed to `ImageClient`, so the one copy
 * serves both. `kind` is only ever a log label: it is what tells an operator
 * reading the warning whether they are looking at an image or a clip.
 */
export interface Generates<A, R> {
  generate(args: A): Promise<R>;
}

export function withFallback<A, R>(kind: string, primary: Generates<A, R>, backup: Generates<A, R>): Generates<A, R> {
  return {
    async generate(args: A): Promise<R> {
      try {
        return await primary.generate(args);
      } catch (e) {
        if (!(e instanceof ToolError) || e.code !== 'UPSTREAM_FAILED') throw e;
        console.warn(`[warn] ${kind}: the primary provider failed, trying the backup`, {
          reason: e.message,
          operator: (e.meta as { operator?: string } | undefined)?.operator,
        });
        try {
          return await backup.generate(args);
        } catch (second) {
          console.error(`[error] ${kind}: the backup provider failed too`, {
            reason: second instanceof Error ? second.message : String(second),
          });
          throw e;
        }
      }
    },
  };
}
