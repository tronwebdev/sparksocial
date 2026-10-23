/**
 * Why `npm run migrate` will not connect, in words.
 *
 *   node scripts/check-db.mjs
 *
 * Reads DATABASE_URL from the environment or `apps/api/.env`. Prints the host
 * and the user; never prints the password.
 *
 * ── Why this exists separately from the migrator ─────────────────────────
 *
 * The same reason `check-r2.mjs` does, and with a sharper edge here:
 * `drizzle-kit migrate` swallows the error. Run against an unreachable or
 * misconfigured database it prints
 *
 *   Using 'pg' driver for database querying
 *
 * and exits 1. Nothing else. `drizzle.config.ts` has a deliberate three-line
 * message for a missing DATABASE_URL — its own comment explains that the old
 * placeholder-host fallback "converted a missing configuration value into a
 * connection failure against a host that does not exist, which is the least
 * informative way to report it" — and that message never reaches the terminal
 * either, because the exception is thrown inside a getter drizzle-kit calls
 * behind its own try/catch.
 *
 * So an unset variable, a wrong password, a blocked IP and a missing `sslmode`
 * all look identical: one line about a driver, then nothing. This separates
 * them, and it does so before anybody starts editing migration files on the
 * theory that the SQL is at fault.
 *
 * ── What it checks, in order ─────────────────────────────────────────────
 *
 *   1. The variable is set, and is parseable as a URL.
 *   2. TCP + TLS + authentication — the connection itself, with the exact
 *      driver error when it fails and a reading of what that error means.
 *   3. `__drizzle_migrations`, which is how far the database actually got.
 *   4. That against `migrations/meta/_journal.json`, which is how far the repo
 *      expects it to be. The difference is the list of migrations that have
 *      never run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/** Same precedence `drizzle.config.ts` uses: a real env var wins over the file. */
function loadEnv() {
  const path = join(process.cwd(), 'apps/api/.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const raw = process.env.DATABASE_URL ?? '';
if (!raw) {
  console.error('DATABASE_URL is not set.');
  console.error('  PowerShell:  $env:DATABASE_URL = "postgresql://..."');
  console.error('  bash:        export DATABASE_URL="postgresql://..."');
  console.error('  or put it in apps/api/.env, which this and drizzle.config.ts both read.');
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error('DATABASE_URL is set but is not a URL. It should start with postgresql://');
  process.exit(1);
}

console.log(`host        ${url.hostname}${url.port ? `:${url.port}` : ''}`);
console.log(`database    ${url.pathname.replace(/^\//, '') || '(none in the url)'}`);
console.log(`user        ${url.username || '(none in the url)'} (password present: ${url.password ? 'yes' : 'NO'})`);
console.log(`sslmode     ${url.searchParams.get('sslmode') ?? '(unset)'}`);

/*
 * Render's managed Postgres requires TLS and presents a certificate the Node
 * default chain does not verify, so a bare connection fails with
 * `self-signed certificate in certificate chain` — which, through drizzle-kit,
 * is invisible. `rejectUnauthorized: false` is the same thing `sslmode=require`
 * means on the URL: encrypt, do not verify. Stated here rather than left
 * implicit, because "require" sounding stricter than "verify-full" is a trap
 * worth naming once.
 */
const needsSsl = /render\.com|neon\.tech|supabase/.test(url.hostname);
const client = new pg.Client({
  connectionString: raw,
  ...(needsSsl && !url.searchParams.has('sslmode') ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  await client.connect();
} catch (err) {
  const msg = String(err?.message ?? err);
  console.error(`\nconnect failed: ${msg}`);

  // The four that actually happen, each read back as what to do about it.
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) {
    console.error('→ The host does not resolve. This is usually Render\'s *internal* URL,');
    console.error('  which only works inside their network. Use the External Database URL.');
  } else if (/password authentication failed/.test(msg)) {
    console.error('→ The credential is wrong, or the password was rotated after this URL was copied.');
  } else if (/self.signed|certificate/i.test(msg)) {
    console.error('→ TLS. Append ?sslmode=require to the URL.');
  } else if (/ETIMEDOUT|ECONNREFUSED/.test(msg)) {
    console.error('→ Reachability, not credentials. Check the database is awake and that this');
    console.error('  machine is allowed — Render Postgres has an IP allow-list under Access Control.');
  } else if (/does not exist/.test(msg)) {
    console.error('→ The server answered: that database name is not on it. Check the path in the URL.');
  }
  process.exit(1);
}

const { rows: version } = await client.query('select version()');
console.log(`\nconnected   ${String(version[0].version).split(',')[0]}`);

/*
 * `__drizzle_migrations` lives in the `drizzle` schema and does not exist until
 * the first migration runs — an absent table means "none applied", which is a
 * real answer and not an error.
 */
let applied = [];
try {
  const { rows } = await client.query(
    'select hash, created_at from drizzle.__drizzle_migrations order by created_at',
  );
  applied = rows;
} catch {
  console.log('journal     drizzle.__drizzle_migrations does not exist — no migration has ever run here.');
}

const journalPath = join(process.cwd(), 'packages/db/migrations/meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const expected = journal.entries.length;

console.log(`applied     ${applied.length} of ${expected} in the repo`);

if (applied.length < expected) {
  /*
   * Matched by position, not by hash. The journal records a `when` timestamp
   * and the table records `created_at`, and the two are written by different
   * clocks — so the only thing that lines up reliably is the order, which
   * drizzle itself applies them in.
   */
  const pending = journal.entries.slice(applied.length).map((e) => e.tag);
  console.log(`pending     ${pending.join(', ')}`);
  console.log('\nRun: npm run migrate -w @sparksocial/db');
  process.exitCode = 1;
} else {
  console.log('\n✓ The schema is up to date.');
}

await client.end();
