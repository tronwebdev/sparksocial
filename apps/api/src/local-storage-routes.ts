import type { Hono } from 'hono';
import { LOCAL_STORAGE_ROUTE_PREFIX, type LocalDiskBlobStore } from '@sparksocial/storage';

/**
 * The dev-only HTTP surface `createLocalDiskBlobStore`'s URLs actually point
 * at. Deliberately not a tool: this is the local stand-in for Blob Storage's
 * own HTTPS endpoint, the same category of infrastructure as `/health` or the
 * WhatsApp webhook (CLAUDE.md invariant 1 is about capabilities, and serving
 * raw bytes for a presigned URL isn't one — `asset.upload_url` is the
 * capability, this is just what it points a client at when there's no Azure
 * account yet).
 *
 * CORS is scoped to this route only, not the whole app: the browser PUTs
 * directly here from `localhost:3000` (bytes never transit the Next.js
 * server), which real Blob Storage would need its own CORS rule for too —
 * this mirrors that, it doesn't invent a new hole.
 */
export function registerLocalStorageRoutes(app: Hono, store: LocalDiskBlobStore): void {
  const path = `${LOCAL_STORAGE_ROUTE_PREFIX}/*`;

  app.options(path, (c) =>
    // Reflects whatever headers the browser is asking to send, rather than a
    // fixed allowlist — `AssetUploadForm.tsx` sends `x-ms-blob-type`
    // (Azure's own SAS-upload requirement, harmless noise here) alongside
    // `Content-Type`, and a real Blob Storage CORS rule has to cope with the
    // same client sending that header regardless of which backend is live.
    c.body(null, 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': c.req.header('access-control-request-headers') ?? 'Content-Type',
    }),
  );

  app.put(path, async (c) => {
    const key = keyFromPath(c.req.path);
    const contentType = c.req.header('content-type') ?? 'application/octet-stream';
    const bytes = Buffer.from(await c.req.arrayBuffer());
    await store.write(key, bytes, contentType);
    return c.body(null, 201, { 'Access-Control-Allow-Origin': '*' });
  });

  app.get(path, async (c) => {
    const key = keyFromPath(c.req.path);
    const found = await store.read(key);
    if (!found) return c.body(null, 404, { 'Access-Control-Allow-Origin': '*' });
    return c.body(new Uint8Array(found.bytes), 200, {
      'Content-Type': found.contentType,
      'Access-Control-Allow-Origin': '*',
    });
  });
}

/** Reverses the per-segment `encodeURIComponent` `createLocalDiskBlobStore` applies when building a URL. */
function keyFromPath(requestPath: string): string {
  return requestPath
    .slice(LOCAL_STORAGE_ROUTE_PREFIX.length + 1)
    .split('/')
    .map(decodeURIComponent)
    .join('/');
}
