import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { checkMediaQuality, DEFAULT_THRESHOLDS, type QualityMetrics, type QualityThresholds } from './qualityCheck.js';
import { buildFinishPipeline, type FinishPlan } from './pipeline.js';
import type { AspectRatio, CaptionCue, HookOverlaySpec, MusicBedSpec } from './ffmpeg.js';

/**
 * `direct.media.ingest` — engine spec §6.1 steps 5–7:
 *
 *   *"Ingest → Asset Graph as physical_capture. FINISH pipeline: trim,
 *   stabilize, colour, caption, hook overlay, music, aspect variants. Draft
 *   returned for approval or autopublished per genome.constraints.approval_mode."*
 *
 * This is the single tool a submitted WhatsApp reply resolves to: quality-gate
 * the footage first (§6.3 — "reject-and-reshoot with a specific reason"), and
 * only if it clears, run it through the Finish pipeline and land one asset per
 * requested aspect ratio in the Asset Graph.
 *
 * Four injected clients, none imported at module scope — same pattern as
 * `genome/bootstrap.ts` and `asset.ingest_url`. `QualityAnalyzer` and
 * `DeadSpaceDetector` are real signal-processing work this repo does not fake;
 * `FfmpegRunner` is the one that actually shells out.
 */

export interface QualityAnalyzer {
  analyze(mediaUrl: string): Promise<QualityMetrics>;
}
export interface DeadSpaceDetector {
  detect(mediaUrl: string): Promise<{ startSec: number; endSec: number }>;
}
export interface SourceDimensions {
  dimensions(mediaUrl: string): Promise<{ width: number; height: number }>;
}
export interface FfmpegRunner {
  run(plan: FinishPlan, sourceUrl: string): Promise<Partial<Record<AspectRatio, string>>>;
}
export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

export type MediaIngestDeps = QualityAnalyzer & DeadSpaceDetector & SourceDimensions & FfmpegRunner & EmbedClient;

const AspectRatioSchema = z.enum(['9:16', '1:1', '16:9']);
const CaptionCueSchema = z.object({ text: z.string(), startSec: z.number(), endSec: z.number() });
const HookSchema = z.object({ text: z.string(), fontFile: z.string(), colorHex: z.string(), durationSec: z.number().optional() });
const MusicSchema = z.object({ trackPath: z.string(), volumeDb: z.number() });

export const MediaIngestInput = z.object({
  genomeId: z.string(),
  briefId: z.string(),
  mediaUrl: z.string().url(),
  aspects: z.array(AspectRatioSchema).min(1),
  captions: z.array(CaptionCueSchema).default([]),
  hook: HookSchema,
  music: MusicSchema.optional(),
});

export const MediaIngestOutput = z.union([
  z.object({
    status: z.literal('finished'),
    assetIds: z.record(AspectRatioSchema, z.string()),
    why: z.object({
      summary: z.string(),
      factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
      evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
      alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
    }),
  }),
  z.object({
    status: z.literal('reshoot_requested'),
    reasons: z.array(z.string()),
    why: z.object({
      summary: z.string(),
      factors: z.array(z.object({ label: z.string(), detail: z.string().optional() })),
      evidence: z.array(z.object({ kind: z.enum(['rule']), id: z.string(), note: z.string().optional() })).default([]),
      alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })).default([]),
    }),
  }),
]);

export function makeMediaIngest(deps: MediaIngestDeps, thresholds: QualityThresholds = DEFAULT_THRESHOLDS) {
  return defineTool({
    name: 'direct.media.ingest',
    version: 1,

    summary:
      'Take a raw WhatsApp video reply, quality-gate it, and if it passes run the Finish pipeline ' +
      '(trim, stabilize, captions, hook, music, aspect export) into finished assets. Rejects with a ' +
      'specific reshoot reason rather than shipping unusable footage.',

    input: MediaIngestInput,
    output: MediaIngestOutput,

    effect: 'external',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    idempotent: false,
    surfaces: ['CMP-01.3'],
    estimateCents: (i) => 3 * i.aspects.length,

    async handler(input, ctx) {
      const metrics = await deps.analyze(input.mediaUrl);
      const verdict = checkMediaQuality(metrics, thresholds);

      if (verdict.verdict === 'reshoot') {
        ctx.logger.info('media rejected', { genomeId: input.genomeId, briefId: input.briefId, reasons: verdict.reasons });
        return {
          status: 'reshoot_requested' as const,
          reasons: verdict.reasons,
          why: {
            summary: `This clip needs a reshoot: ${verdict.reasons[0]}`,
            factors: verdict.reasons.map((r) => ({ label: 'quality', detail: r })),
            evidence: [{ kind: 'rule' as const, id: 'engine_spec.§6.3', note: 'Reject-and-reshoot with a specific reason.' }],
            alternatives: [],
          },
        };
      }

      const [trim, dims] = await Promise.all([deps.detect(input.mediaUrl), deps.dimensions(input.mediaUrl)]);

      const plan = buildFinishPipeline({
        trim,
        sourceWidth: dims.width,
        sourceHeight: dims.height,
        captions: input.captions as CaptionCue[],
        hook: input.hook as HookOverlaySpec,
        ...(input.music ? { music: input.music as MusicBedSpec } : {}),
        aspects: input.aspects as AspectRatio[],
        transformsPath: `${input.briefId}.trf`,
        srtPath: `${input.briefId}.srt`,
      });

      const outputs = await deps.run(plan, input.mediaUrl);

      const assetIds: Partial<Record<AspectRatio, string>> = {};
      for (const aspect of input.aspects as AspectRatio[]) {
        const url = outputs[aspect];
        if (!url) continue; // runner declined this aspect — do not fabricate an asset for it
        const caption = `finished clip for brief ${input.briefId} (${aspect})`;
        const embedding = await deps.embed(caption);
        const asset = await ctx.db.assets.create({
          genomeId: input.genomeId,
          orgId: ctx.orgId,
          url,
          assetRole: 'physical_capture',
          mediaType: 'video',
          rightsStatus: 'cleared', // the business's own footage of themselves
          caption,
          embedding,
          source: `direct.media.ingest:${input.briefId}`,
        });
        assetIds[aspect] = asset.id;
      }

      ctx.logger.info('media finished', { genomeId: input.genomeId, briefId: input.briefId, aspects: Object.keys(assetIds) });

      return {
        status: 'finished' as const,
        assetIds: assetIds as Record<AspectRatio, string>,
        why: {
          summary: `Finished into ${Object.keys(assetIds).length} aspect ratio(s): ${Object.keys(assetIds).join(', ')}.`,
          factors: [
            { label: 'trim', detail: `kept ${trim.startSec}s–${trim.endSec}s` },
            { label: 'stages', detail: plan.stages.map((s) => s.name).join(' → ') },
          ],
          evidence: [{ kind: 'rule' as const, id: 'engine_spec.§6.3', note: 'Raw phone footage in, publishable post out.' }],
          alternatives: [],
        },
      };
    },
  });
}
