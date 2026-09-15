import dns from 'node:dns/promises';
import { isIP } from 'node:net';

// SSRF guard for user-supplied webhook URLs. The server fetches these URLs
// (runner.ts), so without this a registered user could point the webhook at
// loopback / private / link-local hosts and use the server as a confused deputy
// to read internal services or the cloud metadata endpoint.
//
// Boundary: the authoritative check is validateWebhookUrl() in the runner,
// which resolves DNS right before the fetch. settings.ts also does the cheap
// synchronous checkWebhookUrlSyntax() on write for immediate user feedback.
//
// ponytail: resolves DNS once and checks the result. A determined attacker can
// still DNS-rebind (return a public IP here, a private IP at TCP connect time).
// Upgrade path if that ever matters: an undici Agent with a connect-time
// `lookup` that re-validates the pinned IP, defeating the TOCTOU window.

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return (
    inRange(n, '0.0.0.0', 8) ||        // "this" network / unspecified
    inRange(n, '10.0.0.0', 8) ||       // private
    inRange(n, '100.64.0.0', 10) ||    // CGNAT
    inRange(n, '127.0.0.0', 8) ||      // loopback
    inRange(n, '169.254.0.0', 16) ||   // link-local (incl. cloud metadata)
    inRange(n, '172.16.0.0', 12) ||    // private
    inRange(n, '192.0.0.0', 24) ||     // IETF protocol assignments
    inRange(n, '192.168.0.0', 16) ||   // private
    inRange(n, '198.18.0.0', 15) ||    // benchmarking
    n === ipv4ToInt('255.255.255.255') // broadcast
  );
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  const first = parseInt(addr.split(':')[0] || '0', 16);
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not a parseable IP → block defensively
}

// Cheap, DNS-free validation for the settings-write path: scheme + literal IPs.
// Returns an error message, or null if the URL passes the syntactic checks.
export function checkWebhookUrlSyntax(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Webhook URL is not a valid URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Webhook URL must use http or https.';
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedIp(host)) {
    return 'Webhook URL must not point to a private or loopback address.';
  }
  return null;
}

// Authoritative check used right before the server fetches the webhook. Adds
// DNS resolution on top of the syntax check so a hostname pointing at an
// internal IP is rejected too. Throws on any failure.
export async function validateWebhookUrl(raw: string): Promise<void> {
  const syntaxError = checkWebhookUrlSyntax(raw);
  if (syntaxError) throw new Error(syntaxError);

  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return; // literal IP already validated by the syntax check

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Webhook host could not be resolved.');
  }
  for (const { address } of resolved) {
    if (isBlockedIp(address)) {
      throw new Error('Webhook URL resolves to a private or loopback address.');
    }
  }
}

// Runnable check: `npx tsx server/src/lib/urlGuard.ts`. Asserts the IP
// classification (the security-critical part) so a broken range check fails loud.
if (require.main === module) {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('FAIL: ' + msg); };
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254',
                    '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert(isBlockedIp(ip), `${ip} should be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert(!isBlockedIp(ip), `${ip} should be allowed`);
  }
  assert(checkWebhookUrlSyntax('ftp://x') !== null, 'non-http rejected');
  assert(checkWebhookUrlSyntax('file:///etc/passwd') !== null, 'file scheme rejected');
  assert(checkWebhookUrlSyntax('http://169.254.169.254/') !== null, 'literal metadata IP rejected');
  assert(checkWebhookUrlSyntax('https://example.com/webhook') === null, 'public https allowed');
  console.log('urlGuard self-check passed');
}
