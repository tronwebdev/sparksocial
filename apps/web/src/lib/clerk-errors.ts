/**
 * Clerk throws `{ errors: [{ code, longMessage, meta: { paramName } }] }`.
 *
 * Mapping by `paramName` puts the message under the field that caused it, which
 * is the difference between "Password is incorrect" appearing next to the password
 * box and a red banner the user has to interpret. Anything without a `paramName`
 * (rate limits, provider outages) falls out as a form-level message.
 *
 * Raw `error.message` is never rendered: for network failures it is a stack-shaped
 * string, and for Clerk errors it is less specific than `longMessage`.
 */
export interface FieldErrors {
  fields: Record<string, string>;
  form: string | undefined;
}

interface ClerkErrorShape {
  errors?: Array<{ code?: string; longMessage?: string; message?: string; meta?: { paramName?: string } }>;
}

export function toFieldErrors(err: unknown): FieldErrors {
  const errors = (err as ClerkErrorShape)?.errors;

  if (!Array.isArray(errors) || errors.length === 0) {
    return { fields: {}, form: 'Something went wrong. Please try again.' };
  }

  const fields: Record<string, string> = {};
  let form: string | undefined;

  for (const e of errors) {
    const text = e.longMessage ?? e.message ?? 'Invalid value.';
    const param = e.meta?.paramName;
    if (param) fields[param] = text;
    else form ??= text;
  }

  return { fields, form };
}
