/**
 * Receives layout dumps from the browser and writes them to disk.
 *
 *   node scripts/fidelity/collector.mjs          # listens on :4388
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The live app needs a signed-in session, and the only signed-in browser is
 * the one a person is using. So the extractor (`extract.js`) runs inside that
 * page and POSTs what it measured here, rather than a headless browser trying
 * to log in — which would mean handling somebody's credentials to read a
 * stylesheet.
 *
 * The prototypes need no session, but go through the same path anyway so the
 * two dumps are produced by identical code at an identical viewport. A
 * difference between them is then a difference between the designs, not
 * between two measuring tools.
 *
 * ── The two headers that make a public page able to reach localhost ─────
 *
 * The live site is https on a public origin; this is http on localhost.
 * Browsers allow that particular mixed request, because localhost is a
 * "potentially trustworthy" origin, but Chrome's Private Network Access rule
 * sends a preflight first and refuses unless the answer opts in with
 * `Access-Control-Allow-Private-Network`. Without it every POST fails before
 * it is sent, with a CORS error that says nothing about private networks.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.FIDELITY_PORT ?? 4388);
const OUT = join(process.cwd(), 'scripts', 'fidelity', 'dumps');
mkdirSync(OUT, { recursive: true });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS, GET',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-private-network': 'true',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  const script = /^\/(extract|responsive)\.js(\?|$)/.exec(req.url ?? '');
  if (req.method === 'GET' && script) {
    /*
     * Served fresh on every request rather than cached, so editing the
     * extractor between two measurements changes the second one. A stale
     * module here would make two dumps disagree for a reason that is not in
     * either design.
     */
    res.writeHead(200, { ...cors, 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(readFileSync(join(process.cwd(), 'scripts', 'fidelity', `${script[1]}.js`), 'utf8'));
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { ...cors, 'content-type': 'text/plain' });
    res.end('fidelity collector up\n');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, cors);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  // A name is a file name; anything that could walk out of the dump folder is refused.
  const name = (url.searchParams.get('name') ?? '').replace(/[^a-z0-9._-]/gi, '_');
  if (!name) {
    res.writeHead(400, cors);
    res.end('name required');
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    writeFileSync(join(OUT, `${name}.json`), body);
    console.log(`saved ${name}.json (${(body.length / 1024).toFixed(1)} KB)`);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name }));
  });
}).listen(PORT, () => console.log(`fidelity collector on http://localhost:${PORT}`));
