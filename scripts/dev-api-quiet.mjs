/**
 * The API, serving screens and nothing else.
 *
 *   node scripts/dev-api-quiet.mjs
 *
 * For working on the web app against real data. Two differences from
 * `npm run start -w @sparksocial/api`, both set in this process's environment
 * rather than written to `apps/api/.env`:
 *
 *   * `BACKGROUND_WORKERS=off` — no scheduler, no draft or render queue, no
 *     token refresher. `apps/api/.env` points at the shared database, and a
 *     second API running those against it publishes scheduled posts and spends
 *     credits in parallel with the deployed one.
 *
 *   * `sslmode=require` on the database URL, when it is missing. The hosted
 *     Postgres refuses plaintext and the driver's refusal is swallowed by the
 *     workers' tick logs as "Failed query" — see `scripts/check-db.mjs`.
 *
 * The connection string is read and passed on; it is never printed.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const env = { ...process.env, BACKGROUND_WORKERS: 'off' };

const envFile = join(process.cwd(), 'apps', 'api', '.env');
if (!env.DATABASE_URL && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^DATABASE_URL=(.*)$/.exec(line.trim());
    if (m) env.DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
  }
}
/*
 * Only for a remote host. A local Postgres usually has no TLS at all, and
 * forcing `sslmode=require` onto it turns a working connection into a
 * refused one — the opposite of the reason this is here.
 */
const isLocal = (() => {
  try {
    const host = new URL(env.DATABASE_URL ?? '').hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  } catch {
    return true;
  }
})();
if (env.DATABASE_URL && !isLocal && !/sslmode=/.test(env.DATABASE_URL)) {
  env.DATABASE_URL += (env.DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=require';
}

const child = spawn('npm', ['run', 'start', '-w', '@sparksocial/api'], {
  env,
  stdio: 'inherit',
  // npm is a .cmd shim on Windows, which spawn will not find without a shell.
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
