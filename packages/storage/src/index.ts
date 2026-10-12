export * from './types.js';
export * from './memory.js';
export * from './local.js';

/*
 * The two cloud backends are re-exported by name rather than with `*`.
 *
 * Each owns a `storageUnavailable` that turns *its* vendor's failures into one
 * `ToolError` — Azure reads a `ChainedTokenCredential` aggregate, R2 reads an
 * S3 error name — so they are backend-private helpers that happen to share a
 * sensible name, not two implementations of one thing. A wildcard export made
 * them collide and the barrel ambiguous; renaming either would have made the
 * name lie about what it does.
 *
 * Callers construct a store and never touch these; the tests import them from
 * their own module.
 */
export { createAzureBlobStore, type AzureBlobOptions } from './azure.js';
export { createR2BlobStore, type R2Options } from './r2.js';
