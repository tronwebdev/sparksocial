/**
 * The @sparksocial/db public surface.
 *
 * `./schema.js` is deliberately NOT re-exported. The scoped tables must be
 * unreachable except by a deep import from `./schema.js`, which is what makes the
 * isolation guard in `test/isolation.test.ts` precise: any module that can touch a
 * scoped table has to name it in an import, and the guard reads imports.
 *
 * If you need a column type, export the inferred type from here rather than the
 * table object.
 */
export * from './scoped.js';

export type { assets as AssetsTable } from './schema.js';
