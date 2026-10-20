/** Finish the kept AG brand: colours, timezone, identity, then a campaign. */
import { invokeTool } from '@sparksocial/tools';
import { connectPostgresStore } from '../apps/api/src/pg-store.js';
import { makeSystemCtx } from '../apps/api/src/system-ctx.js';
import { makeBrandGovernance } from '../apps/api/src/dev-auth.js';
import { memoryInvokeDeps } from '../apps/api/src/app.js';
import { registerAlphaTools, registerAgencyTools } from '../apps/api/src/tools.js';
import { makeRunGuardrails } from '@sparksocial/guardrails';
import { embedClient } from '../apps/api/src/embed-client.js';

const ORG = 'org_3JQXFs0NLUov7It7zvQZHTUS6Wi';
const BRAND = 'brand_023e6584-8666-4bac-91ef-a0e3c4671276';
const GENOME = '7e273b1f-7cbf-4b5d-a25d-b56d9b524d67';

const pg = connectPostgresStore();
registerAlphaTools();
registerAgencyTools({ credits: pg.credits });
const deps = memoryInvokeDeps({ runGuardrails: makeRunGuardrails(embedClient()) });
const gov = makeBrandGovernance(pg.scopedDb);

async function call(tool: string, input: unknown) {
  const ctx = await makeSystemCtx({
    db: pg.scopedDb, credits: pg.credits, orgId: ORG, brandId: BRAND, genomeId: GENOME, role: 'admin',
  });
  const res = await invokeTool(
    { tool, input, caller: 'user', ctx, brand: await gov(ORG, BRAND), idempotencyKey: crypto.randomUUID() },
    deps,
  );
  if (res.status !== 'succeeded') {
    console.error('FAILED', tool, JSON.stringify(res).slice(0, 400));
    return undefined;
  }
  return res.output as any;
}

/* Brand kit: the four colours from the profile, Playfair, UTC. */
await call('brand.governance.set', {
  brandColors: ['#080808', '#D4A642', '#F4D58A', '#FFFFFF'],
  brandFonts: { display: 'playfair', body: 'playfair' },
  timezone: 'UTC',
  toneVector: { formal: 0.6, playful: 0.3, technical: 0.15, bold: 0.45 },
});

/* Identity + dimensions, so the resolver has something to work with. */
await call('genome.identity.set', {
  genomeId: GENOME,
  identity: {
    business_name: 'AG Accessories and Jewelries',
    category: 'Fashion accessories and jewelry',
    sub_category: 'Jewelry and fashion accessories retailer',
    one_liner:
      'Elegant jewelry and fashion accessories, selected to finish an outfit for every day and for occasions. We sell; we do not manufacture.',
    price_tier: 'mid',
    languages: ['en'],
    geography: { scope: 'national', locale: 'en', radius_km: null },
  },
});

await call('genome.dimensions.set', {
  genomeId: GENOME,
  proof_asset: ['physical_product'],
  capture_capability: ['product'],
  objective: 'sales',
  secondary_objectives: ['audience'],
  talent_availability: 'no',
});

await call('genome.offer.set', {
  genomeId: GENOME,
  offer: {
    products: [
      { name: 'Jewelry — necklaces, earrings, rings, bracelets, sets' },
      { name: 'Fashion accessories — watches, sunglasses, handbags, hair accessories' },
      { name: 'Gifting selections for birthdays, anniversaries and celebrations' },
    ],
    primary_cta: 'Send us a message to explore our collections',
  },
});

/* The campaign. */
const camp = await call('campaign.create', {
  genomeId: GENOME,
  name: 'Elegance in Every Detail',
  objective: 'sales',
  windowDays: 30,
  targetCount: 30,
  targetLabel: 'enquiries',
});
console.log('campaign:', camp?.campaignId);

const cal = await call('calendar.generate', { genomeId: GENOME, campaignId: camp?.campaignId });
const slots = cal?.slots ?? [];
console.log('slots:', slots.length);
for (const s of slots) console.log('   ', s.playbookId ?? s.playbook_id);

const b = await pg.scopedDb.brands.get(BRAND, ORG);
console.log('\nbrand colours:', JSON.stringify((b as { brandColors?: unknown })?.brandColors));
console.log('timezone     :', (b as { timezone?: string })?.timezone);
process.exit(0);
