/**
 * Delete five duplicate AG brands from the user's Clerk org, keeping 10-09 20:56.
 *
 * Scoped by explicit genome id — never by name — so a brand in another org with
 * a similar name cannot be caught by accident.
 */
const { Client } = require('pg');
const fs = require('fs');
const url = (fs.readFileSync('apps/api/.env', 'utf8').match(/^DATABASE_URL=(.*)$/m) || [])[1].trim();

const ORG = 'org_3JQXFs0NLUov7It7zvQZHTUS6Wi';
const KEEP_GENOME = '7e273b1f-7cbf-4b5d-a25d-b56d9b524d67';
const KEEP_BRAND = 'brand_023e6584-8666-4bac-91ef-a0e3c4671276';

const DELETE = [
  ['d7a77110-1c13-44d9-959d-b8a71e08e666', 'brand_6ca6c443-8d44-40a7-8eed-f8c59c54b004', 'AG Accessories 18:12'],
  ['b2244b1b-f154-4add-9026-a13736854b01', 'brand_17502569-78a0-4e78-b016-81ff9a84a3c4', 'AG Accessories and Jewelries 19:11'],
  ['5e21c83c-4dd7-42e1-9c42-50f597a04935', 'brand_00e77315-ced3-4a0c-848c-a9717043135e', 'AG Kit Test'],
  ['b4af36c4-e12d-4f14-b0fc-2f86a72b212c', 'brand_678be2fc-bacd-4957-8fe9-839f266e0b7a', 'AG Accessories and Jewelries 14:13'],
  ['6556a453-cf8d-4ccd-898c-1b7267750080', 'brand_ee5daa01-8e4c-4c74-9d59-3dd1f85242e3', 'AG Save Test'],
];

/** Child tables that carry a genome_id, deepest first. */
const BY_GENOME = [
  'renders', 'content_links', 'content_metrics', 'content_items',
  'knowledge_chunks', 'assets', 'asset_folders',
  'campaigns', 'memories', 'oauth_connections', 'consent_records',
  'leads', 'opportunities', 'engagement_messages', 'human_messages',
  'recipe_outputs', 'recipe_runs', 'recipes',
  'learning_outcomes', 'learning_arms', 'proposals', 'review_links',
  'agent_steps', 'agent_runs', 'approvals', 'tool_calls',
  'trend_observations', 'trend_watchlist', 'trend_source_mutes',
  'influencer_watchlist', 'brand_engagement_settings',
];

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();

  // Which of those tables actually have a genome_id column in this schema.
  const cols = (
    await c.query(
      `select table_name from information_schema.columns
       where table_schema='public' and column_name='genome_id'`,
    )
  ).rows.map((r) => r.table_name);

  for (const [genomeId, brandId, label] of DELETE) {
    if (genomeId === KEEP_GENOME || brandId === KEEP_BRAND) {
      console.log('REFUSING to delete the keeper:', label);
      continue;
    }
    const owned = await c.query('select org_id from genomes where id=$1', [genomeId]);
    if (owned.rows[0]?.org_id !== ORG) {
      console.log('SKIP (wrong org):', label, owned.rows[0]?.org_id);
      continue;
    }

    let removed = 0;
    for (const t of BY_GENOME) {
      if (!cols.includes(t)) continue;
      const r = await c.query(`delete from ${t} where genome_id=$1`, [genomeId]);
      removed += r.rowCount;
    }
    await c.query('delete from genomes where id=$1 and org_id=$2', [genomeId, ORG]);
    // brand_members then the brand itself
    await c.query('delete from brand_members where brand_id=$1', [brandId]).catch(() => {});
    await c.query('delete from brands where id=$1 and org_id=$2', [brandId, ORG]);
    console.log(`deleted ${label} — ${removed} child rows`);
  }

  const left = (
    await c.query(
      `select b.name, to_char(g.created_at,'MM-DD HH24:MI') t
       from genomes g join brands b on b.id=g.brand_id where g.org_id=$1 order by g.created_at`,
      [ORG],
    )
  ).rows;
  console.log('\nremaining in your org:');
  for (const r of left) console.log('  ', r.t, '|', r.name);
  await c.end();
})().catch((e) => console.error('ERR', e.message));
