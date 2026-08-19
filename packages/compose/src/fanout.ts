import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';
import {
  startCanvaAutofill,
  getCanvaAutofillJob,
  startCanvaExport,
  getCanvaExportJob,
  pollCanvaJob,
  type CanvaFetch,
  type CanvaAutofillField,
} from '@sparksocial/agency/canvaDesign';

/**
 * `compose.fanout` — the third of the plan's three `compose.*` tools
 * (alongside `compose.render` and `compose.static`), and the one gated on a
 * per-brand connection rather than a vendor key: Canva designs are per
 * account (`packages/agency/src/canva.ts`'s own header), so this is always
 * registered and fails per call, not at startup, when the genome hasn't
 * connected Canva yet (`brand.oauth.connect`) — the same "gate at call time"
 * posture `content.generate_avatar_video` takes for consent.
 *
 * ── Why the caller supplies the field mapping, not this tool ─────────────
 * Canva's Autofill API fills a *specific Brand Template*'s own named fields
 * — which fields exist and what they're called is a fact about that
 * template, not something this codebase's content model can derive from a
 * draft's beats (the same gap `link.shorten`'s own doc comment names for CTA
 * URLs: "no playbook beat resolves that path today"). So `data` is the
 * caller's own field-name → value mapping (already Canva-shaped), and
 * `brandTemplateId` is the caller's own choice of which template — this tool
 * orchestrates the two async Canva jobs (autofill, then export per format)
 * and persists the results; it does not invent a beat-to-field mapping that
 * does not exist anywhere in the data model yet.
 *
 * ── "Fan-out to formats" means file formats, not arbitrary pixel sizes ────
 * Canva's public Connect API exports a design to a file FORMAT (png/jpg/pdf)
 * at the template's own dimensions — it has no public endpoint for resizing
 * to arbitrary aspect ratios (that is Canva's own "Magic Resize", not part
 * of the Connect API). One design, exported to up to three formats, is the
 * real, buildable interpretation of "format fan-out" against what Canva's
 * API actually offers.
 */

export const ComposeFanoutInput = z.object({
  genomeId: z.string().min(1),
  contentItemId: z.string().min(1),
  brandTemplateId: z.string().min(1),
  /** Canva's own field-name → value mapping for the template. `image` fields take a Canva-side asset id, not an Asset Graph id — see the module comment. */
  data: z.record(z.string(), z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), assetId: z.string() }),
  ])),
  formats: z.array(z.enum(['png', 'jpg', 'pdf'])).min(1).max(3).default(['png']),
});

const FanoutRender = z.object({ format: z.string(), url: z.string() });

export const ComposeFanoutOutput = z.object({
  contentItemId: z.string(),
  designId: z.string(),
  editUrl: z.string().optional(),
  renders: z.array(FanoutRender),
  why: Explanation,
});

export interface ComposeFanoutDeps {
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: CanvaFetch;
}

function toCanvaField(field: z.infer<typeof ComposeFanoutInput>['data'][string]): CanvaAutofillField {
  return field.type === 'text' ? { type: 'text', text: field.text } : { type: 'image', asset_id: field.assetId };
}

export function makeComposeFanout(deps: ComposeFanoutDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return defineTool({
    name: 'compose.fanout',
    version: 1,

    summary:
      'Autofill a Canva Brand Template with the given field data and export the result to up to three file ' +
      'formats (png/jpg/pdf). Requires this genome to have connected Canva via brand.oauth.connect first.',

    input: ComposeFanoutInput,
    output: ComposeFanoutOutput,

    effect: 'write',
    autonomy: 'auto',
    scopes: ['owner', 'admin', 'editor'],
    // A re-run creates a new Canva design and new exports, not a safe replay.
    idempotent: false,

    // Canva's own pricing for Autofill/Export API calls is not published per-call;
    // this is a placeholder ceiling, same honest-approximation posture
    // `compose.render`'s own estimate takes for compute it does not meter.
    estimateCents: () => 2,

    async handler(input, ctx) {
      const item = await ctx.db.content.get(input.contentItemId, input.genomeId, ctx.orgId);
      if (!item) throw new ToolError('NOT_FOUND', 'That content item is not open.', { contentItemId: input.contentItemId });

      const connection = await ctx.db.oauthConnections.get(input.genomeId, ctx.orgId, 'canva');
      if (!connection) {
        throw new ToolError(
          'FORBIDDEN',
          'This genome has not connected a Canva account. Use brand.oauth.connect (Canva) first.',
          { genomeId: input.genomeId },
        );
      }
      // No token-refresh path exists yet (packages/agency/src/canva.ts tracks
      // `refreshToken` but nothing consumes it) — an expired token surfaces
      // as a plain Canva 401, not a special error here.
      const accessToken = connection.accessToken;

      const canvaData: Record<string, CanvaAutofillField> = {};
      for (const [key, field] of Object.entries(input.data)) canvaData[key] = toCanvaField(field);

      const { jobId: autofillJobId } = await startCanvaAutofill(fetchImpl, {
        accessToken,
        brandTemplateId: input.brandTemplateId,
        data: canvaData,
      });
      const { designId, editUrl } = await pollCanvaJob(
        () => getCanvaAutofillJob(fetchImpl, { accessToken, jobId: autofillJobId }),
        'autofill',
      );

      const renders: Array<{ format: string; url: string }> = [];
      for (const format of input.formats) {
        const { jobId: exportJobId } = await startCanvaExport(fetchImpl, { accessToken, designId, format });
        const { urls } = await pollCanvaJob(
          () => getCanvaExportJob(fetchImpl, { accessToken, jobId: exportJobId }),
          `export (${format})`,
        );
        for (const url of urls) renders.push({ format, url });
      }

      await Promise.all(
        renders.map((r) =>
          ctx.db.content.recordRender({
            contentItemId: item.id,
            genomeId: input.genomeId,
            orgId: ctx.orgId,
            aspect: r.format,
            storageUrl: r.url,
            engine: 'canva',
            costCents: 0, // Canva's own metering, not ours to attribute per-format here.
          }),
        ),
      );

      ctx.logger.info('composed fanout', { genomeId: input.genomeId, contentItemId: item.id, designId, formats: input.formats });

      return {
        contentItemId: item.id,
        designId,
        ...(editUrl ? { editUrl } : {}),
        renders,
        why: {
          summary: `Autofilled Canva template "${input.brandTemplateId}" and exported ${renders.length} file${renders.length === 1 ? '' : 's'} (${input.formats.join(', ')}).`,
          factors: [
            { label: 'brand template', detail: input.brandTemplateId },
            { label: 'formats', detail: input.formats.join(', ') },
          ],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}
