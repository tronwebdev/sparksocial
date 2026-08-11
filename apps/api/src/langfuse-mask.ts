/**
 * What may leave the building.
 *
 * Langfuse's own instrumentation guidance is explicit that sensitive data must
 * be masked before it is sent, and this codebase has a concrete reason to care:
 * tool inputs routinely carry an owner's phone number (`direct.session.send`),
 * a brand's private asset captions, and post copy that has not been published
 * yet. `redactRecipient` already exists in `packages/capture` precisely so the
 * *audit row* never holds a raw number — sending the same field to a
 * third-party observability vendor would undo that one layer up.
 *
 * The rule here is allow-list, not deny-list. A deny-list has to be updated
 * every time a tool gains a field, and the failure mode is silent: the field
 * ships to a vendor and nobody notices until someone reads a trace. An
 * allow-list fails the other way — a new field is invisible in Langfuse until
 * somebody deliberately adds it, which is a bug report rather than a breach.
 */

/** Fields safe to send verbatim: identifiers, enums, counts — never free text or PII. */
const SAFE_KEYS = new Set([
  'genomeId',
  'playbookId',
  'campaignId',
  'contentItemId',
  'callId',
  'runId',
  'assetId',
  'trendId',
  'platform',
  'objective',
  'mode',
  'pillar',
  'decision',
  'limit',
  'windowDays',
  'k',
  'requiredRoles',
  'assetRole',
  'mediaType',
  'rightsStatus',
  'status',
  'toolCalls',
  'model',
  'tool',
  'refused',
]);

/** Strings longer than this are summarised rather than sent — free text is where PII hides. */
const MAX_STRING = 120;

/**
 * Keeps structure and drops content.
 *
 * The shape of an input is what makes a trace readable — which tool, which
 * genome, how many assets. The *content* is what carries risk. So keys survive,
 * allow-listed scalars survive, and everything else becomes a type-and-size
 * placeholder that is still useful when reading a trace ("string(482)" tells
 * you a caption was long) without being the caption.
 */
export function maskValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `[string(${value.length})]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    // Arrays are summarised past a few entries: an embedding is 1536 floats and
    // a trace viewer is not improved by any of them.
    if (value.length > 5) return `[array(${value.length})]`;
    return value.map((v) => maskValue(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SAFE_KEYS.has(k) ? maskValue(v, depth + 1) : redact(v, depth);
    }
    return out;
  }
  return '[unserialisable]';
}

/** A non-allow-listed value: keep enough to debug the shape, none of the content. */
function redact(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return `[redacted string(${value.length})]`;
  if (typeof value === 'number') return '[redacted number]';
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return `[redacted array(${value.length})]`;
  if (typeof value === 'object') {
    // Recurse one level so nested identifiers still surface — a trace that
    // cannot say which genome a call touched is hard to act on.
    return maskValue(value, depth + 1);
  }
  return '[redacted]';
}
