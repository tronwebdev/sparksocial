/**
 * Generate one real clip through Higgsfield, from this machine.
 *
 *   node scripts/check-higgsfield.mjs
 *   node scripts/check-higgsfield.mjs --duration 4 --aspect 9:16
 *   node scripts/check-higgsfield.mjs --estimate-only
 *
 * Reads HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET from the environment, or
 * from `apps/api/.env`, which is gitignored. Prints nothing secret: the key id
 * is shown as a prefix and the secret is never shown at all.
 *
 * ── Why this exists separately from the app ──────────────────────────────
 *
 * The same reason `check-r2.mjs` does. A failed clip inside the product has
 * several possible causes and the UI can only report the last one: a wrong key,
 * an unfunded account, a model id that does not exist on this account, a
 * duration the model refuses, a concurrency cap. This separates them, and it
 * does so **before** spending the ~$1 a five-second Seedance clip costs — the
 * default run asks their `/estimate` endpoint first and prints the price it was
 * quoted.
 *
 * ── The thing it exists to check that unit tests cannot ──────────────────
 *
 * The codec. fal's Seedance returns HEVC Main 10 under `codec: auto`, which
 * headless Chrome cannot decode: every clip reached the renderer and died as
 * `Code 4 -` with an empty message, a paid-for file no part of the pipeline
 * could read. Higgsfield's schema has no codec field, so what it returns is
 * unknown and cannot be asked for. This downloads the clip and reads the codec
 * out of it with ffprobe, because "it downloaded fine" is exactly what was true
 * the last time this went wrong.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = 'https://api.higgsfield.ai';
const DEFAULT_MODEL = 'bytedance/seedance-2.5/text-to-video';

/** Same precedence the app has: a real env var wins over the file. */
function loadEnv() {
  const path = join(process.cwd(), 'apps/api/.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

loadEnv();

const keyId = process.env.HIGGSFIELD_KEY_ID ?? '';
const keySecret = process.env.HIGGSFIELD_KEY_SECRET ?? '';
const model = process.env.HIGGSFIELD_VIDEO_MODEL || DEFAULT_MODEL;

if (!keyId || !keySecret) {
  console.error(
    'Set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET (in the environment or apps/api/.env).\n' +
      `  id: ${keyId ? 'set' : 'MISSING'}  secret: ${keySecret ? 'set' : 'MISSING'}`,
  );
  process.exit(1);
}

const auth = `Key ${keyId}:${keySecret}`;
const duration = Number(arg('duration', '4'));
const aspect = arg('aspect', '9:16');
const prompt = arg(
  'prompt',
  'A slow handheld shot across a small bakery counter at golden hour, warm light, steam rising from fresh bread.',
);

/*
 * Whatever the deploy sends, so this tests the configuration rather than a
 * tidier version of it. The recommended value turns the model's own audio off;
 * if it is unset here, that is itself worth seeing in the output.
 */
let extra = {};
try {
  extra = JSON.parse(process.env.HIGGSFIELD_VIDEO_EXTRA_PARAMS || '{}');
} catch {
  console.error('HIGGSFIELD_VIDEO_EXTRA_PARAMS is not valid JSON; sending nothing extra.');
}

const input = { prompt, aspect_ratio: aspect, duration, ...extra };

console.log(`key id      ${keyId.slice(0, 6)}… (secret present, not shown)`);
console.log(`model       ${model}`);
console.log(`input       ${JSON.stringify({ ...input, prompt: `${prompt.slice(0, 40)}…` })}`);
if (!('generate_audio' in extra) && !('sound' in extra)) {
  console.log('            ⚠ no audio switch set — this model generates its own audio by default');
}

const estimate = await fetch(`${BASE}/estimate/${model}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: auth },
  body: JSON.stringify(input),
});
if (estimate.ok) {
  const q = await estimate.json();
  console.log(`estimate    ${q.credits} credits / $${q.usd}`);
} else {
  console.log(`estimate    unavailable (${estimate.status}: ${(await estimate.text()).slice(0, 120)})`);
}

if (process.argv.includes('--estimate-only')) process.exit(0);

const submitted = await fetch(`${BASE}/${model}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: auth,
    'idempotency-key': crypto.randomUUID(),
  },
  body: JSON.stringify(input),
});

if (!submitted.ok) {
  const body = await submitted.text();
  console.error(`\nsubmit failed ${submitted.status}: ${body.slice(0, 400)}`);
  if (submitted.status === 401) console.error('→ the credential is wrong or revoked.');
  if (submitted.status === 403) console.error('→ the account has no credit.');
  if (submitted.status === 404) console.error(`→ "${model}" is not a model this account can reach.`);
  if (submitted.status === 400 && /concurrent/i.test(body)) console.error('→ concurrency cap, not a bad request. Wait and retry.');
  process.exit(1);
}

const { request_id: requestId, status_url: statusUrl } = await submitted.json();
console.log(`\nrequest     ${requestId}`);

const started = Date.now();
let delay = 2_000;
let result;

for (let attempt = 0; attempt < 120; attempt++) {
  const res = await fetch(statusUrl, { headers: { authorization: auth } });
  if (!res.ok) {
    console.error(`status check failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  result = await res.json();
  const secs = Math.round((Date.now() - started) / 1000);
  process.stdout.write(`\r            ${result.status} (${secs}s)        `);
  if (['completed', 'failed', 'nsfw', 'canceled'].includes(result.status)) break;
  await new Promise((r) => setTimeout(r, delay + Math.round(Math.random() * 500)));
  delay = Math.min(delay * 1.5, 10_000);
}

console.log('');

if (result?.status !== 'completed') {
  console.error(`\nended as ${result?.status}${result?.error ? `: ${result.error}` : ''}`);
  if (result?.status === 'nsfw') console.error('→ moderation refused the prompt. Not charged.');
  process.exit(1);
}

const url = result.video?.url;
if (!url) {
  console.error('\ncompleted with no video url — the response shape is not what the client expects.');
  console.error(JSON.stringify(result).slice(0, 400));
  process.exit(1);
}

console.log(`\nclip        ${url}`);

/*
 * The codec check. Downloaded and probed rather than trusted, because a file
 * that downloads perfectly and cannot be decoded by the renderer is the exact
 * failure this project has already paid for once on the same model.
 */
const out = join(process.cwd(), 'higgsfield-check.mp4');
const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync(out, bytes);
console.log(`saved       ${out} (${(bytes.length / 1_048_576).toFixed(2)} MB)`);

try {
  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,duration', '-of', 'json', out],
    { encoding: 'utf8' },
  );
  const streams = JSON.parse(probe).streams ?? [];
  for (const s of streams) {
    console.log(
      `stream      ${s.codec_name} ${s.profile ?? ''} ${s.pix_fmt ?? ''} ${s.width ?? ''}x${s.height ?? ''} ${s.duration ?? ''}s`.replace(
        /\s+/g,
        ' ',
      ),
    );
  }
  const video = streams.find((s) => s.width);
  if (video && /hevc|h265/i.test(video.codec_name ?? '')) {
    console.log('\n⚠ HEVC. This is the codec headless Chrome could not decode on fal — the composer will fail on it.');
  } else if (video) {
    console.log('\n✓ playable codec.');
  }
  if (streams.some((s) => !s.width)) {
    console.log('⚠ the clip carries an audio stream — set {"generate_audio": false} or it talks over the narration.');
  }
} catch {
  console.log('ffprobe not available — codec unverified. That is the one thing this script exists to check.');
}
