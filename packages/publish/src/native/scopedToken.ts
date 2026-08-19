/**
 * Several native platforms need more than a bare access token to publish —
 * Instagram needs the numeric ig-user-id, LinkedIn needs the author's
 * person/organization URN. `PublishRequest.accessToken` only has room for one
 * credential string, so `integration.ts`'s connect flow packs the extra id
 * into it as `{id}:{token}` at connect time, and the adapter that needs the
 * id unpacks it here — rather than adding a platform-specific field to the
 * shared `PublishRequest` for the two adapters that need one.
 */
export function joinScopedToken(id: string, token: string): string {
  return `${id}:${token}`;
}

/**
 * Splits on the LAST colon, not the first — an id can itself contain colons
 * (a LinkedIn URN is `urn:li:person:abc`), while an OAuth access token is a
 * single opaque, colon-free string. `join(id, token).split` round-trips
 * correctly as long as that holds, which it does for every token format
 * these adapters see in practice.
 */
export function splitScopedToken(scoped: string): [id: string, token: string] {
  const idx = scoped.lastIndexOf(':');
  if (idx === -1) return ['', scoped];
  return [scoped.slice(0, idx), scoped.slice(idx + 1)];
}
