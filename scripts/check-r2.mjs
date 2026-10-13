/**
 * Verify an R2 configuration end to end, from this machine.
 *
 *   node scripts/check-r2.mjs
 *
 * Reads R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY from
 * the environment (or from apps/api/.env, which is gitignored). Prints nothing
 * secret: keys are shown as a prefix only.
 *
 * ── Why this exists separately from the app ──────────────────────────────
 *
 * A failed upload in the browser has at least four possible causes and the
 * browser can only ever report the last one it hits: a wrong account id, a wrong
 * bucket, a token that lacks write, and a missing CORS rule all arrive as some
 * flavour of "failed to fetch". This separates them, because **CORS is a browser
 * rule and nothing else** — a PUT from Node is not subject to it. So if this
 * script passes and the browser still fails, the credentials are provably fine
 * and CORS is provably the only thing left. That is worth knowing before
 * changing anything.
 *
 * It uses the same `createR2BlobStore` the API uses, not a parallel
 * implementation, so a bug in the store's URL construction fails here too.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createR2BlobStore, normaliseAccountId } from '../packages/storage/src/r2.ts';

/** Same tiny reader `packages/db/drizzle.config.ts` uses, and for the same reason. */
function loadEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    const raw = trimmed.slice(eq + 1).trim();
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

loadEnvFile(new URL('../apps/api/.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const accountId = process.env.R2_ACCOUNT_ID ?? '';
const bucket = process.env.R2_BUCKET ?? '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';

/** A prefix is enough to compare against a dashboard; the whole value is not. */
const show = (v) => (v ? `${v.slice(0, 6)}… (${v.length} chars)` : '** MISSING **');

console.log('Configuration as this machine sees it');
console.log('  R2_ACCOUNT_ID        ', accountId || '** MISSING **');
console.log('  …normalised to       ', accountId ? normaliseAccountId(accountId) : '-');
console.log('  R2_BUCKET            ', bucket || '** MISSING **');
console.log('  R2_ACCESS_KEY_ID     ', show(accessKeyId));
console.log('  R2_SECRET_ACCESS_KEY ', show(secretAccessKey));
console.log('  endpoint             ', `https://${normaliseAccountId(accountId)}.r2.cloudflarestorage.com`);
console.log();

if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Set all four before running this. Nothing was attempted.');
  process.exit(1);
}

const store = createR2BlobStore({ accountId, bucket, accessKeyId, secretAccessKey });
const key = `_healthcheck/${randomUUID()}.txt`;
const body = `sparksocial r2 check ${new Date().toISOString()}`;

try {
  console.log('1/3  writing a small object…');
  const { url } = await store.put({ key, contentType: 'text/plain', bytes: new TextEncoder().encode(body) });
  console.log('     ok — wrote', key);

  console.log('2/3  reading it back through a presigned URL…');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`read came back ${res.status}`);
  const read = await res.text();
  if (read !== body) throw new Error('the bytes read back do not match the bytes written');
  console.log('     ok — contents match');

  console.log('3/3  checking the create-only guard rejects an overwrite…');
  const again = await store.presignUpload({ key, contentType: 'text/plain' });
  const overwrite = await fetch(again.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', 'if-none-match': '*' },
    body: 'second write',
  });
  console.log(
    overwrite.status === 412
      ? '     ok — refused with 412, as intended'
      : `     note — returned ${overwrite.status}, not 412. The bucket may not enforce If-None-Match.`,
  );

  console.log();
  console.log('PASS — the account id, bucket and token are all correct.');
  console.log('If the browser still fails, it is CORS: that rule applies to browsers only,');
  console.log('and this script just proved the credentials are not the problem.');
  console.log();
  console.log(`Leftover test object: ${key} — delete it from the dashboard if you like.`);
} catch (e) {
  console.error();
  /*
   * The operator detail, not the customer sentence.
   *
   * `ToolError`'s `message` is written for whoever is uploading a logo — it says
   * nothing is wrong with their file and to try again — and `storageUnavailable`
   * puts the part an operator needs in `meta.operator` and `meta.cause`, because
   * `app.ts` serialises only code and message to the client. Printing just the
   * message here reproduced that split in a tool whose entire purpose is to show
   * the other half, which is how the first run of this script reported a failure
   * and withheld the reason.
   */
  console.error('FAIL —', e instanceof Error ? e.message : String(e));
  const meta = e && typeof e === 'object' && 'meta' in e ? e.meta : undefined;
  if (meta && typeof meta === 'object') {
    if ('operator' in meta && meta.operator) console.error('       ', meta.operator);
    if ('cause' in meta && meta.cause) console.error('  cause:', meta.cause);
  }
  console.error();
  console.error('What the usual causes look like:');
  console.error('  InvalidAccessKeyId / SignatureDoesNotMatch  the key or secret is wrong, or the');
  console.error('                                             secret was truncated when copied');
  console.error('  NoSuchBucket                                R2_BUCKET is wrong, or the bucket');
  console.error('                                             lives in a different account');
  console.error('  AccessDenied on the write                   the token is read-only, or scoped');
  console.error('                                             to a different bucket');
  console.error('  ENOTFOUND / EAI_AGAIN                       R2_ACCOUNT_ID is wrong');
  process.exit(1);
}
