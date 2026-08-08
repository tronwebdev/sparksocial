import { describe, expect, it } from 'vitest';
import { PublicHttpUrl, checkPublicHttpUrl } from '../src/safeUrl.js';

/**
 * The threat this guards is specific: SparkSocial runs on Azure Container Apps
 * with Managed Identity, so any URL that makes the server fetch
 * `169.254.169.254` yields tokens for the app's own identity — Key Vault, the
 * storage account, the database. That is a whole-platform compromise, not a
 * single-tenant leak, which is why these cases are enumerated rather than
 * spot-checked.
 */

const blocked = (url: string) => expect(checkPublicHttpUrl(url).ok, url).toBe(false);
const allowed = (url: string) => expect(checkPublicHttpUrl(url).ok, url).toBe(true);

describe('checkPublicHttpUrl — cloud metadata endpoints', () => {
  it('blocks the IMDS address every major cloud shares', () => {
    blocked('http://169.254.169.254/metadata/instance?api-version=2021-02-01');
    blocked('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    blocked('https://169.254.169.254/');
    // Azure's IMDS also answers on the whole link-local /16.
    blocked('http://169.254.1.1/');
  });

  it('blocks metadata hostnames as well as addresses', () => {
    blocked('http://metadata.google.internal/computeMetadata/v1/');
    blocked('http://metadata.goog/');
  });

  it('blocks the IPv6 link-local metadata address', () => {
    blocked('http://[fe80::a9fe:a9fe]/metadata');
  });

  it('blocks IPv4-mapped IPv6, which the URL parser rewrites into hex', () => {
    // `new URL()` turns [::ffff:169.254.169.254] into [::ffff:a9fe:a9fe], so a
    // guard that only matches dotted quads lets the metadata endpoint straight
    // through. Both spellings, and the fully-expanded form, must be refused.
    blocked('http://[::ffff:169.254.169.254]/metadata');
    blocked('http://[::ffff:a9fe:a9fe]/metadata');
    blocked('http://[0:0:0:0:0:ffff:a9fe:a9fe]/metadata');
    blocked('http://[::ffff:127.0.0.1]/');
    blocked('http://[::ffff:7f00:1]/');
  });

  it('does not block an IPv4-mapped public address', () => {
    // 93.184.216.34 → ::ffff:5db8:d822. Blocking all mapped addresses would be
    // easier and would also break legitimate hosts.
    allowed('http://[::ffff:5db8:d822]/');
  });
});

describe('checkPublicHttpUrl — internal networks', () => {
  it('blocks loopback in every spelling', () => {
    blocked('http://localhost:8080/health');
    blocked('http://LOCALHOST/health');
    // Trailing dot is a valid FQDN that resolves identically.
    blocked('http://localhost./health');
    blocked('http://anything.localhost/');
    blocked('http://127.0.0.1:22');
    blocked('http://127.1.2.3/');
    blocked('http://[::1]:8080/');
  });

  it('blocks RFC1918 and carrier-grade NAT ranges', () => {
    blocked('http://10.0.0.5/');
    blocked('http://172.16.0.1/');
    blocked('http://172.31.255.254/');
    blocked('http://192.168.1.1/');
    blocked('http://100.64.0.1/');
    blocked('http://0.0.0.0/');
  });

  it('does not over-block public addresses that merely look similar', () => {
    // 172.32 is outside the private /12, and 100.128 outside the CGNAT /10.
    // An over-eager guard that blocked these would break real customer sites.
    allowed('http://172.32.0.1/');
    allowed('http://100.128.0.1/');
    allowed('http://11.0.0.1/');
    allowed('http://169.253.0.1/');
  });
});

describe('checkPublicHttpUrl — schemes and credentials', () => {
  it('blocks non-HTTP schemes that Zod\u2019s .url() would accept', () => {
    // This is the gap that motivated the module: `z.string().url()` passes all
    // of these.
    blocked('file:///etc/passwd');
    blocked('file://C:/Windows/win.ini');
    blocked('gopher://127.0.0.1:6379/_SET%20key%20value');
    blocked('ftp://internal.example.com/');
    blocked('data:text/html,<script>alert(1)</script>');
  });

  it('blocks embedded credentials, which are used to disguise the real host', () => {
    blocked('http://user:pass@example.com/');
    // The classic: everything before @ is userinfo, so this fetches 169.254.169.254.
    blocked('http://example.com@169.254.169.254/');
  });

  it('allows ordinary public sites, which is the entire point of the product', () => {
    allowed('https://emekacuts.example.com');
    allowed('https://www.example.co.uk/about/team?ref=x#top');
    allowed('http://example.com:8443/path');
  });
});

describe('PublicHttpUrl (Zod)', () => {
  it('rejects unsafe URLs at schema validation, before any handler runs', () => {
    // Rejecting in the schema means `invokeTool` refuses the call identically
    // whether it came from the UI or from SPARK, and no tool author can forget.
    expect(PublicHttpUrl.safeParse('http://169.254.169.254/').success).toBe(false);
    expect(PublicHttpUrl.safeParse('file:///etc/passwd').success).toBe(false);
    expect(PublicHttpUrl.safeParse('not a url').success).toBe(false);
  });

  it('accepts a normal site', () => {
    expect(PublicHttpUrl.safeParse('https://example.com/pricing').success).toBe(true);
  });

  it('explains why it refused, so the failure is actionable', () => {
    const result = PublicHttpUrl.safeParse('http://169.254.169.254/');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/private or link-local/i);
    }
  });
});
