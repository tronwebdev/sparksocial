import type { KnowledgeStore } from '@sparksocial/tools/defineTool';
import type { Database } from './client.js';
import * as scoped from './scoped.js';

/** `knowledge_chunks` backed by Postgres — `brand.knowledge.attach`'s one write. Genome-scoped through `scoped.ts`: a client's source material is exactly the kind of thing isolation exists to wall off. */
export function createKnowledgeRepository(db: Database): KnowledgeStore {
  return {
    async attach({ genomeId, orgId, docId, text, embedding, citation }) {
      const row = await scoped.createKnowledgeChunk(db, { orgId, brandId: orgId, genomeId }, { docId, text, embedding, citation });
      return toChunk(row);
    },
    async listForDoc(genomeId, orgId, docId) {
      const rows = await scoped.listKnowledgeChunks(db, { orgId, brandId: orgId, genomeId }, docId);
      return rows.map(toChunk);
    },

    async listAll(genomeId, orgId) {
      const rows = await scoped.listKnowledgeChunks(db, { orgId, brandId: orgId, genomeId });
      return rows.map(toChunk);
    },
  };
}

function toChunk(row: scoped.KnowledgeChunkRow) {
  return { id: row.id, genomeId: row.genomeId, docId: row.docId, text: row.text, createdAt: row.createdAt, ...(row.citation ? { citation: row.citation } : {}) };
}
