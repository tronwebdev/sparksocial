const { Client } = require('pg');
const fs = require('fs');
const url = (fs.readFileSync('apps/api/.env', 'utf8').match(/^DATABASE_URL=(.*)$/m) || [])[1].trim();
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  const rows = (
    await c.query(`
      select g.id genome_id, g.brand_id, b.name,
             to_char(g.created_at,'MM-DD HH24:MI') created,
             coalesce(b.logo_url,'') logo,
             coalesce(b.brand_colors::text,'') colours,
             coalesce(b.timezone,'') tz,
             (select count(*) from assets a where a.genome_id = g.id) assets,
             (select count(*) from knowledge_chunks k where k.genome_id = g.id) chunks,
             (select count(*) from campaigns ca where ca.genome_id = g.id) campaigns,
             (select count(*) from content_items ci where ci.genome_id = g.id) posts
      from genomes g join brands b on b.id = g.brand_id
      order by g.created_at
    `)
  ).rows;
  for (const r of rows) {
    console.log(
      `${r.created} | ${String(r.name).padEnd(30)} | assets=${r.assets} chunks=${r.chunks} camp=${r.campaigns} posts=${r.posts}` +
        ` | logo=${r.logo ? 'yes' : 'no'} colours=${r.colours || 'none'} tz=${r.tz}`,
    );
    console.log(`           genome=${r.genome_id}  brand=${r.brand_id}`);
  }
  console.log('\ntotal:', rows.length);
  await c.end();
})().catch((e) => console.error(e.message));
