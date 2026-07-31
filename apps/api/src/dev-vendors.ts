import { deterministicEmbedding } from './dev-store.js';

/**
 * DEVELOPMENT VENDOR STUBS — captioning and embedding.
 *
 * `asset.retrieve` and `asset.ingest_url` take these as injected deps (see
 * `packages/assetgraph`), so the tools themselves never import a vendor SDK.
 * These stand in for a real multimodal captioner and the `text-embedding-3-large`
 * endpoint until those are wired.
 *
 * Deliberately deterministic — same input always produces the same embedding —
 * so retrieval results are reproducible in dev and in tests that hit the API.
 */

export function devCaptionClient() {
  return {
    async caption(url: string, mediaType: 'image' | 'video' | 'audio'): Promise<string> {
      return `${mediaType} at ${url}`;
    },
  };
}

export function devEmbedClient() {
  return {
    async embed(text: string): Promise<number[]> {
      return deterministicEmbedding(text);
    },
  };
}
