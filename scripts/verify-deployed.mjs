#!/usr/bin/env node
/**
 * VERIFY A DEPLOYED SPARKSOCIAL — Phase 0, task 0.4.
 *
 * ── Why this exists as a script ───────────────────────────────────────────
 *
 * The test suite passes 2,207 assertions and cannot see the class of failure
 * this catches. `compose.render` had never once worked: Remotion bundles the
 * composition for a browser, the bundle pulled in `node:crypto` through a
 * barrel re-export, and every render died on `UnhandledSchemeError`. The suite
 * missed it for weeks because it injects a fake renderer and never bundles.
 *
 * Everything that class of bug needs is a real process, real dependency
 * resolution, and a real database. That is a deployed environment, and nothing
 * short of one substitutes. So this walks the product against a live base URL
 * and reports what actually answered.
 *
 * ── What it does and does not do ──────────────────────────────────────────
 *
 * Read-only by default. It calls `read`-effect tools, checks the health and
 * manifest surfaces, and confirms that the tools whose absence would silently
 * degrade the product are registered. It does **not** publish, spend, or write
 * — `--write` opts into the two cheap writes that prove the database is
 * reachable for more than SELECT, and it cleans up after itself.
 *
 * It is a smoke test, not the walkthrough. A person still has to click through
 * onboarding and look at a generated post: this cannot tell you whether the
 * copy is any good, only whether the machinery answers.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   node scripts/verify-deployed.mjs --api https://<api-host> --token <jwt>
 *   node scripts/verify-deployed.mjs --api http://localhost:8787 --dev-headers
 *
 * `--dev-headers` forges the `x-org-id`/`x-genome-id` headers that
 * `makeDevResolveCtx` accepts, for an instance running with `ALLOW_DEV_AUTH`.
 * Against a real deployment you want `--token`, because the point is to
 * exercise the path a browser takes.
 */

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const API = (opt('api') ?? '').replace(/\/$/, '');
const TOKEN = opt('token');
const ORG = opt('org', 'org_verify');
const GENOME = opt('genome');
const DEV = flag('dev-headers');
const WRITE = flag('write');

if (!API) {
  console.error('usage: node scripts/verify-deployed.mjs --api <base-url> [--token <jwt> | --dev-headers]');
  console.error('       [--org <id>] [--genome <id>] [--write]');
  process.exit(2);
}

/* ── reporting ──────────────────────────────────────────────────────────── */

const results = [];
let group = '';

const g = (name) => {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
};

function record(status, label, detail) {
  results.push({ group, status, label, detail });
  const mark = status === 'ok' ? '\x1b[32m  ok  \x1b[0m' : status === 'skip' ? '\x1b[90m skip \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
  console.log(`${mark} ${label}${detail ? `\n         ${detail}` : ''}`);
}

/**
 * Every check is wrapped, because a script that throws on its third assertion
 * tells you about one problem. The whole point is a list.
 */
async function check(label, fn) {
  try {
    const detail = await fn();
    if (detail === SKIP) return;
    record('ok', label, typeof detail === 'string' ? detail : undefined);
  } catch (e) {
    record('fail', label, e instanceof Error ? e.message : String(e));
  }
}

const SKIP = Symbol('skip');
const skip = (label, why) => {
  record('skip', label, why);
  return SKIP;
};

/* ── transport ──────────────────────────────────────────────────────────── */

function headers() {
  const h = { 'content-type': 'application/json' };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  if (DEV) {
    h['x-org-id'] = ORG;
    h['x-role'] = 'admin';
    if (GENOME) h['x-genome-id'] = GENOME;
  }
  return h;
}

async function http(path, init = {}) {
  const started = Date.now();
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  const ms = Date.now() - started;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* left undefined — some surfaces answer in plain text */
  }
  return { res, json, text, ms };
}

/** One tool call through the real middleware chain, exactly as the web app makes it. */
async function tool(name, input) {
  const { res, json, text, ms } = await http(`/v1/tools/${name}`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} in ${ms}ms — ${text.slice(0, 200)}`);
  return { out: json, ms };
}

/* ── the checks ─────────────────────────────────────────────────────────── */

g('Reachability');

await check('the API answers', async () => {
  const { res, ms } = await http('/health');
  if (!res.ok) throw new Error(`/health returned ${res.status}`);
  return `${ms}ms`;
});

let manifest = [];
await check('the tool registry is served', async () => {
  const { res, json } = await http('/v1/tools');
  if (!res.ok) throw new Error(`/v1/tools returned ${res.status}`);
  manifest = json?.tools ?? [];
  if (manifest.length < 100) throw new Error(`only ${manifest.length} tools in the manifest — expected ~150`);
  return `${manifest.length} tools registered`;
});

/**
 * The registry is the honest report of what this deployment can do. A tool
 * missing here is a capability silently absent — every one of these gates on an
 * environment variable, and a missing key degrades quietly rather than loudly.
 */
g('Capabilities that gate on configuration');

const names = () => new Set(manifest.map((t) => t.name));
const expect = (name, why) => async () => {
  if (!manifest.length) return skip(name, 'no manifest to check against');
  if (!names().has(name)) throw new Error(why);
  return 'registered';
};

await check('publish.now', expect('publish.now', 'no publishing adapter — check the aggregator key'));
await check('analytics.sync', expect('analytics.sync', 'absent, so the learning loop has no metrics to learn from — check AYRSHARE_API_KEY'));
await check('learning.record_outcome', expect('learning.record_outcome', 'absent, so nothing scores a published post'));
await check('engage.ingest', expect('engage.ingest', 'absent, so the engagement inbox has no write side'));
await check('compose.render', expect('compose.render', 'absent, so nothing can render a video'));
await check('assemble.plan', expect('assemble.plan', 'absent, so the Assemble pipeline has no entry point'));
await check('whatsapp.send', expect('whatsapp.send', 'absent, so the capture loop cannot reach an owner'));

g('Inbound webhook routes');

/**
 * Checked by their refusal, which is the only safe probe: an unsigned POST must
 * be rejected. A 404 means the route is not registered — the secret is unset —
 * and a 200 would mean it accepts unsigned writes, which is worse than missing.
 */
for (const [path, label] of [
  ['/v1/webhooks/engage/meta', 'Meta engagement webhook'],
  ['/v1/webhooks/engage/aggregator', 'Aggregator engagement webhook'],
  ['/v1/webhooks/whatsapp', 'WhatsApp webhook'],
]) {
  await check(label, async () => {
    const { res } = await http(path, { method: 'POST', body: '{}' });
    if (res.status === 404) return skip(label, 'not registered — its signing secret is unset');
    if (res.status === 403) return 'registered, and rejects an unsigned body';
    throw new Error(`answered ${res.status} to an unsigned POST — expected 403`);
  });
}

g('Reads through the real middleware');

/**
 * `read`-effect tools only. Each one proves a different layer: the genome read
 * proves the scoped repository resolves, the playbook resolve proves the engine
 * runs, and the manifest above proved the registry loaded.
 */
let genomeId = GENOME;

await check('genome.list', async () => {
  const { out, ms } = await tool('genome.list', {});
  const list = out?.output?.genomes ?? out?.genomes ?? [];
  if (!genomeId && list.length) genomeId = list[0].genomeId ?? list[0].id;
  return `${list.length} genome(s) in ${ms}ms${genomeId ? `, using ${String(genomeId).slice(0, 8)}` : ''}`;
});

await check('playbook.resolve', async () => {
  if (!genomeId) return skip('playbook.resolve', 'no genome to resolve against');
  const { out, ms } = await tool('playbook.resolve', { genomeId });
  const formats = out?.output?.formats ?? out?.formats ?? [];
  if (!formats.length) throw new Error('resolved zero formats — the mix engine has nothing to offer');
  return `${formats.length} format(s) in ${ms}ms`;
});

await check('asset.list', async () => {
  if (!genomeId) return skip('asset.list', 'no genome');
  const { out, ms } = await tool('asset.list', { genomeId, limit: 5 });
  const assets = out?.output?.assets ?? out?.assets ?? [];
  return `${assets.length} asset(s) in ${ms}ms`;
});

await check('learning.confidence', async () => {
  if (!genomeId) return skip('learning.confidence', 'no genome');
  const { out } = await tool('learning.confidence', { genomeId });
  const o = out?.output ?? out;
  const arms = o?.arms?.length ?? 0;
  // Not a failure: a fresh brand has no arms. But it is the number that tells
  // you whether the outcome observer has ever run against real data.
  return arms
    ? `${arms} arm(s), confidence ${o.confidence}`
    : 'no arms yet — expected until the observer has scored a matured post';
});

g('The database accepts writes');

if (!WRITE) {
  record('skip', 'write probe', 'pass --write to run it');
} else {
  await check('brand.governance.get then set', async () => {
    const before = await tool('brand.governance.get', {});
    const tz = (before.out?.output ?? before.out)?.timezone;
    if (!tz) throw new Error('governance read returned no timezone');
    // Writing the value it already has: proves the write path end to end and
    // changes nothing, so there is nothing to clean up.
    const after = await tool('brand.governance.set', { timezone: tz });
    const status = after.out?.status ?? 'succeeded';
    if (status === 'failed') throw new Error(`set failed: ${JSON.stringify(after.out?.error ?? {}).slice(0, 160)}`);
    return `round-tripped timezone ${tz}`;
  });

  await check('team.group.create then delete', async () => {
    const label = `verify-${Date.now()}`;
    const made = await tool('team.group.create', { name: label, capabilities: [], members: [] });
    const id = (made.out?.output ?? made.out)?.id;
    if (!id) throw new Error(`create returned no id: ${JSON.stringify(made.out).slice(0, 160)}`);
    await tool('team.group.delete', { groupId: id });
    // Proves migration 0037 landed and the tables take a write, which the
    // schema probe alone cannot show.
    return 'created and removed a group, so 0037 is applied and writable';
  });
}

/* ── summary ────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');

console.log(`\n${'─'.repeat(64)}`);
console.log(
  `\x1b[1m${results.length - failed.length - skipped.length} ok · ${failed.length} failed · ${skipped.length} skipped\x1b[0m`,
);

if (failed.length) {
  console.log('\n\x1b[31mFailures:\x1b[0m');
  for (const f of failed) console.log(`  ${f.group} → ${f.label}\n    ${f.detail ?? ''}`);
}
if (skipped.length) {
  // Deliberately not labelled "absent capability": a skip can also mean the
  // probe never got far enough to ask, and conflating the two would report a
  // dead host as a feature-complete one with nothing configured.
  console.log('\n\x1b[90mSkipped — read the reason, not the count:\x1b[0m');
  for (const s of skipped) console.log(`  ${s.label}: ${s.detail ?? ''}`);
}

console.log(
  '\nThis is a smoke test. It shows the machinery answers; it cannot tell you whether a generated post ' +
    'is worth publishing. Walk onboarding and read one.',
);

process.exit(failed.length ? 1 : 0);
