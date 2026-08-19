import { z } from 'zod';

/**
 * SSRF GUARD for user-supplied URLs.
 *
 * Several tools take a URL and fetch it server-side: `genome.bootstrap_from_url`
 * crawls a prospect's site, `asset.ingest_url` pulls media. `z.string().url()`
 * is not a security control — it accepts `file:///etc/passwd`,
 * `http://localhost:8080/…`, and `http://169.254.169.254/…` quite happily.
 *
 * That last one is the reason this file exists. SparkSocial runs on Azure
 * Container Apps with Managed Identity (CLAUDE.md § Infrastructure), where
 * `169.254.169.254` is the Instance Metadata Service: anything that can make the
 * server fetch that address can mint tokens for the app's own identity — the
 * Key Vault, the storage account, the database. Not a leak of one tenant's data;
 * a leak of every tenant's.
 *
 * The check is deliberately a *denylist of network locations* rather than an
 * allowlist of domains, because the product's whole premise is pointing it at an
 * arbitrary business's website.
 *
 * ── What this does not do ──────────────────────────────────────────────────
 * It cannot stop DNS rebinding, or a public hostname whose A record resolves to
 * a private address: this validates the URL, and resolution happens later inside
 * the fetch. Closing that requires resolving the host and pinning the socket to
 * the checked IP, which belongs in the crawl/fetch implementation itself. When
 * `crawl()` lands (P2) it must re-check the resolved address before connecting,
 * and follow redirects through this same guard — a 302 to the metadata endpoint
 * bypasses any check that only ran on the original input.
 */

/** Only schemes that make sense for fetching public web content. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Hostnames that are never legitimate targets. Matched case-insensitively and
 * with the trailing dot stripped, because `LOCALHOST.` and `localhost` resolve
 * identically but compare differently.
 */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);

/** IPv4 ranges that must never be fetched. */
function isBlockedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];

  return (
    a === 0 ||                        // 0.0.0.0/8 "this network"
    a === 10 ||                       // private
    a === 127 ||                      // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 carrier-grade NAT
    (a === 169 && b === 254) ||       // link-local — Azure/AWS/GCP IMDS lives here
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) ||       // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                          // multicast + reserved
  );
}

function isBlockedIpv6(host: string): boolean {
  // URL parsing leaves IPv6 literals in brackets.
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1' || h === '::') return true;
  // fc00::/7 unique-local, fe80::/10 link-local (incl. the IPv6 IMDS address).
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;

  // IPv4-mapped addresses. The dotted form a caller types
  // (`::ffff:169.254.169.254`) is *not* what arrives here: WHATWG URL parsing
  // normalises it to hex (`::ffff:a9fe:a9fe`), so matching on dotted quads
  // silently misses the exact bypass this branch exists to catch. Decode the
  // two hex groups back into an address and run the IPv4 rules on it.
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    const dotted = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
    return isBlockedIpv4(dotted);
  }

  // Some parsers leave the dotted form intact; handle it rather than assume.
  const mappedDotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mappedDotted ? isBlockedIpv4(mappedDotted[1]!) : false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export function checkPublicHttpUrl(raw: string): UrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `Only http and https are allowed, not ${parsed.protocol}` };
  }

  // Credentials in the URL are a redirect-laundering trick and have no
  // legitimate use for a public marketing site.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'URL has no host.' };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: `${host} is not a public address.` };
  // `.localhost` is reserved and resolves to loopback per RFC 6761.
  if (host.endsWith('.localhost')) return { ok: false, reason: `${host} is not a public address.` };
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
    return { ok: false, reason: `${host} is a private or link-local address.` };
  }

  return { ok: true };
}

/**
 * Drop-in replacement for `z.string().url()` on any field the server will fetch.
 * Using a Zod refinement rather than a check inside each handler means the
 * rejection happens in `invokeTool`'s validation step — before the tool runs,
 * and identically whether the call came from the UI or from SPARK.
 */
export const PublicHttpUrl = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    const result = checkPublicHttpUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason ?? 'Unsafe URL.' });
    }
  });
