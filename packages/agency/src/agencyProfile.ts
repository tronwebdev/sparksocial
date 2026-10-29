import { z } from 'zod';
import { defineTool } from '@sparksocial/tools/defineTool';
import { Explanation, ToolError } from '@sparksocial/shared';

/**
 * `agency.profile.*` — the Agency Portal's launch wizard, saved.
 *
 * ── What was there before ─────────────────────────────────────────────────
 *
 * The wizard collected a name, contact details, a tagline, a tone, a timezone
 * and the website choices, and "Launch" wrote `ss-agency-launched=1` to the
 * browser's `localStorage` — the prototype's own latch. Nothing else. So the
 * answers vanished on reload, the portal believed it had launched in one
 * browser and not in any other, and "Edit Wizard" opened an empty form.
 *
 * Now the answers live on the org (`org_settings.agency_profile`), and having
 * a `launchedAt` is what "launched" means, on every device.
 *
 * ── What it still is not ──────────────────────────────────────────────────
 *
 * A website. The layout, template, font and domain choices are recorded so the
 * wizard remembers them, but nothing builds or hosts a site from them yet, and
 * the portal says "Not connected yet" rather than inventing a URL.
 *
 * The agency's logo is not here either: it is the Clerk organisation's own
 * image, set from the browser like a profile photo, so the account switcher and
 * the portal show the same mark without a second copy that could disagree.
 */

export const AGENCY_TONES = ['Professional', 'Friendly', 'Bold', 'Playful', 'Authoritative'] as const;
export const AGENCY_MODELS = ['local_business', 'personal_brand'] as const;

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'A colour is a six-digit hex value, like #3157D6.');

export const AgencyProfile = z.object({
  model: z.enum(AGENCY_MODELS),
  name: z.string().trim().max(120),
  yourName: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  /** Empty is allowed — the wizard can be launched before it is filled in. */
  email: z.union([z.literal(''), z.string().trim().email().max(200)]),
  tagline: z.string().trim().max(300),
  tone: z.enum(AGENCY_TONES),
  timezone: z.string().max(80),
  /** The design's "Selected Colors" — up to five swatches. */
  colors: z.array(Hex).max(5),
  titleFont: z.string().max(60),
  service: z.string().max(80),
  layout: z.number().int().min(0).max(5),
  template: z.number().int().min(0).max(2),
  domain: z.string().trim().max(253),
  /** Set by the first launch and never moved by later edits. */
  launchedAt: z.string().datetime().optional(),
});
export type AgencyProfile = z.infer<typeof AgencyProfile>;

export const DEFAULT_AGENCY_PROFILE: AgencyProfile = {
  model: 'local_business',
  name: '',
  yourName: '',
  phone: '',
  email: '',
  tagline: '',
  tone: 'Professional',
  timezone: '',
  colors: [],
  titleFont: 'Asgard',
  service: 'Content creation',
  layout: 0,
  template: 0,
  domain: '',
};

/**
 * What is stored, read leniently. A field the schema later tightens must not
 * make an agency's whole saved profile unreadable, so each field falls back to
 * its default on its own rather than the record failing as one.
 */
function readStored(raw: unknown): AgencyProfile {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_AGENCY_PROFILE };
  for (const [key, field] of Object.entries(AgencyProfile.shape)) {
    if (!(key in obj)) continue;
    const parsed = (field as z.ZodTypeAny).safeParse(obj[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return AgencyProfile.parse(out);
}

export const AgencyProfileGetOutput = z.object({
  profile: AgencyProfile.nullable(),
  launched: z.boolean(),
});

export const agencyProfileGet = defineTool({
  name: 'agency.profile.get',
  version: 1,

  summary:
    'Read this agency’s own profile — what the Agency Portal launch wizard saved: name, contact, tagline, ' +
    'tone, colours and website choices. Null when the wizard has never been launched.',

  input: z.object({}),
  output: AgencyProfileGetOutput,

  effect: 'read',
  autonomy: 'auto',
  /** The Agency Portal is an administrator's screen — see `agency.roster`. */
  scopes: ['owner', 'admin'],
  idempotent: true,
  surfaces: ['AG-WIZ-01'],

  async handler(_input, ctx) {
    const stored = await ctx.db.agencyProfiles.get(ctx.orgId);
    if (!stored) return { profile: null, launched: false };
    const profile = readStored(stored.profile);
    return { profile, launched: Boolean(profile.launchedAt) };
  },
});

export const AgencyProfileSetInput = z.object({
  profile: AgencyProfile.omit({ launchedAt: true }),
  /** True from the wizard's Launch button. Stamps `launchedAt` the first time only. */
  launch: z.boolean().default(false),
});

export const agencyProfileSet = defineTool({
  name: 'agency.profile.set',
  version: 1,

  summary:
    'Save this agency’s profile from the launch wizard. A whole-profile replace. With launch=true it also ' +
    'marks the agency launched, once. Owner or admin.',

  input: AgencyProfileSetInput,
  output: AgencyProfileGetOutput,

  effect: 'write',
  /**
   * A person's answers about their own business. SPARK has nothing to put in an
   * agency's phone number or email, and an agent that could rewrite them could
   * make an agency's contact details somebody else's.
   */
  autonomy: 'human_only',
  scopes: ['owner', 'admin'],
  /** Sending the same profile twice stores the same profile; `launchedAt` never moves. */
  idempotent: true,
  surfaces: ['AG-WIZ-01'],

  async handler(input, ctx) {
    const existing = await ctx.db.agencyProfiles.get(ctx.orgId);
    const previousLaunch = existing ? readStored(existing.profile).launchedAt : undefined;
    const launchedAt = previousLaunch ?? (input.launch ? new Date().toISOString() : undefined);

    const profile: AgencyProfile = { ...input.profile, ...(launchedAt ? { launchedAt } : {}) };
    await ctx.db.agencyProfiles.set(ctx.orgId, profile);
    ctx.logger.info('agency profile saved', { orgId: ctx.orgId, launched: Boolean(launchedAt) });
    return { profile, launched: Boolean(launchedAt) };
  },
});

/* ── Generate With Ai ─────────────────────────────────────────────────── */

/**
 * The wizard's two "Generate With Ai" buttons. Injected, like every vendor
 * seam: the API wires a forced-tool-call model writer, tests a fake.
 */
export interface AgencyIdentityWriter {
  write(args: { part: 'identity' | 'theme'; prompt: string }): Promise<{
    name?: string;
    tagline?: string;
    tone?: string;
    colors?: string[];
  }>;
}

export const AgencyIdentityGenerateInput = z.object({
  /** `identity` fills the name (only if blank) and tagline; `theme` picks a tone and colours. */
  part: z.enum(['identity', 'theme']),
  model: z.enum(AGENCY_MODELS),
  name: z.string().trim().max(120).default(''),
  service: z.string().max(80).default(''),
  tagline: z.string().trim().max(300).default(''),
  tone: z.enum(AGENCY_TONES).optional(),
});

export const AgencyIdentityGenerateOutput = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  tone: z.enum(AGENCY_TONES).optional(),
  colors: z.array(Hex).optional(),
  why: Explanation,
});

const MODEL_LABEL: Record<(typeof AGENCY_MODELS)[number], string> = {
  local_business: 'a social media agency for local businesses',
  personal_brand: 'a social media agency for coaches, creators and personal brands',
};

export function makeAgencyIdentityGenerate(writer: AgencyIdentityWriter) {
  return defineTool({
    name: 'agency.identity.generate',
    version: 1,

    summary:
      'Suggest an agency’s identity (a name if it has none, and a tagline) or its brand theme (a tone and ' +
      'colours) for the Agency Portal wizard. A suggestion only: nothing is saved until the wizard is. ' +
      'Spends real money.',

    input: AgencyIdentityGenerateInput,
    output: AgencyIdentityGenerateOutput,

    effect: 'read',
    autonomy: 'auto',
    scopes: ['owner', 'admin'],
    /** Pressing it again is asking for a different suggestion. */
    idempotent: false,
    surfaces: ['AG-WIZ-01'],
    /** One short model call. */
    estimateCents: () => 1,

    async handler(input, ctx) {
      const keepName = input.name !== '';
      const prompt = [
        `The agency is ${MODEL_LABEL[input.model]}.`,
        keepName ? `Its name is: ${input.name}` : 'It has no name yet.',
        input.service ? `Its main service: ${input.service}` : '',
        input.tagline ? `Its current tagline: ${input.tagline}` : '',
        input.tone ? `Its chosen tone: ${input.tone}` : '',
        '',
        input.part === 'identity'
          ? keepName
            ? 'Write one tagline for this agency, under 90 characters.'
            : 'Suggest one name for this agency and one tagline, under 90 characters.'
          : `Choose a tone from: ${AGENCY_TONES.join(', ')}. Then choose three brand colours as hex values that ` +
            'work together and read well on white.',
        'Do not invent clients, results, prices or awards.',
      ]
        .filter(Boolean)
        .join('\n');

      const raw = await writer.write({ part: input.part, prompt });

      if (input.part === 'identity') {
        const tagline = raw.tagline?.trim();
        if (!tagline) throw new ToolError('UPSTREAM_FAILED', 'The writer returned no tagline.', {});
        const name = keepName ? undefined : raw.name?.trim() || undefined;
        return {
          ...(name ? { name } : {}),
          tagline: tagline.slice(0, 300),
          why: {
            summary: keepName
              ? `A tagline for ${input.name}, written from the agency model and service you chose.`
              : 'A name and tagline, written from the agency model and service you chose.',
            factors: [
              { label: 'Agency model', detail: MODEL_LABEL[input.model] },
              ...(input.service ? [{ label: 'Service', detail: input.service }] : []),
            ],
            evidence: [],
            alternatives: [],
          },
        };
      }

      const tone = AGENCY_TONES.find((t) => t.toLowerCase() === raw.tone?.trim().toLowerCase());
      const colors = (raw.colors ?? [])
        .map((c) => c.trim())
        .filter((c) => Hex.safeParse(c).success)
        .slice(0, 5);
      if (!tone && colors.length === 0) {
        throw new ToolError('UPSTREAM_FAILED', 'The writer returned no usable tone or colours.', {});
      }
      return {
        ...(tone ? { tone } : {}),
        ...(colors.length ? { colors } : {}),
        why: {
          summary: 'A tone and colours chosen to suit the agency model and service, as a starting point to edit.',
          factors: [
            { label: 'Agency model', detail: MODEL_LABEL[input.model] },
            ...(input.service ? [{ label: 'Service', detail: input.service }] : []),
          ],
          evidence: [],
          alternatives: [],
        },
      };
    },
  });
}
