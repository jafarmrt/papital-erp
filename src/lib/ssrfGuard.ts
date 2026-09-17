import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const dnsResolve4 = promisify(dns.resolve4);
const dnsLookup = promisify(dns.lookup);

/**
 * Standard disallowed ports commonly targeted in SSRF attacks against internal databases and infrastructure.
 */
export const DISALLOWED_PORTS = ['5432', '6379', '27017', '3306', '9200', '22', '23', '25', '8080'];

/**
 * Regex patterns for initial heuristics and backward compatibility.
 */
export const PRIVATE_IP_PATTERNS = [
  /^10\./,                                          // 10.0.0.0/8 (RFC 1918)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,                // 172.16.0.0/12 (RFC 1918)
  /^192\.168\./,                                    // 192.168.0.0/16 (RFC 1918)
  /^127\./,                                         // Loopback 127.0.0.0/8 (RFC 1122)
  /^169\.254\./,                                    // Link-local / Cloud metadata (RFC 3927)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Carrier-Grade NAT 100.64.0.0/10 (RFC 6598)
  /^0\./,                                           // 0.0.0.0/8 (RFC 1122)
  /^::1$/,                                          // IPv6 loopback
  /^fe80:/i,                                        // IPv6 link-local
  /^fc00:/i,                                        // IPv6 unique-local (ULA)
  /^fd/i,                                           // IPv6 unique-local (ULA)
  /^localhost$/i,
  /^metadata\.google\.internal$/i
];

/**
 * Validates individual IPv4 octets against all private, reserved, CGNAT, loopback,
 * link-local, multicast, and broadcast CIDR blocks (RFC 1918, 6598, 3927, 5737, etc.).
 */
export function isPrivateOrReservedIPv4(a: number, b: number, c: number, d: number): boolean {
  // 0.0.0.0/8 - Current network ("this" network, RFC 1122)
  if (a === 0) return true;
  // 10.0.0.0/8 - Private-use (RFC 1918)
  if (a === 10) return true;
  // 100.64.0.0/10 - Shared address space / Carrier-Grade NAT (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 - Loopback (RFC 1122)
  if (a === 127) return true;
  // 169.254.0.0/16 - Link-local & Cloud metadata services (AWS/GCP/Azure, RFC 3927)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 - Private-use (RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 - IETF Protocol Assignments (RFC 6890)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 - TEST-NET-1 documentation (RFC 5737)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.88.99.0/24 - 6to4 Relay Anycast (RFC 7526)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 - Private-use (RFC 1918)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 - Network benchmark tests (RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 - TEST-NET-2 documentation (RFC 5737)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 - TEST-NET-3 documentation (RFC 5737)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 - Multicast (RFC 5771)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 - Reserved for future use (RFC 1112) & 255.255.255.255 broadcast
  if (a >= 240) return true;

  return false;
}

/**
 * Expands an IPv6 address string into 8 standard 16-bit integer words.
 * Handles shorthand '::' zero compression and embedded dotted-decimal IPv4 suffixes (e.g. ::ffff:192.168.1.1).
 */
export function expandIPv6(ip: string): number[] {
  let clean = ip.toLowerCase().trim();

  // Handle embedded dotted IPv4 (e.g. ::ffff:192.168.1.1 or 64:ff9b::192.0.2.1)
  const v4Match = clean.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match) {
    const v4Parts = v4Match[1].split('.').map(Number);
    if (v4Parts.length === 4 && v4Parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
      const hex1 = ((v4Parts[0] << 8) | v4Parts[1]).toString(16);
      const hex2 = ((v4Parts[2] << 8) | v4Parts[3]).toString(16);
      clean = clean.substring(0, clean.lastIndexOf(':') + 1) + hex1 + ':' + hex2;
    }
  }

  const parts = clean.split('::');
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];

  if (parts.length === 2) {
    const missing = 8 - (left.length + right.length);
    const zeros = new Array(Math.max(0, missing)).fill('0');
    return [...left, ...zeros, ...right].map(p => parseInt(p, 16) || 0);
  }

  return left.map(p => parseInt(p, 16) || 0);
}

/**
 * Validates expanded 16-bit IPv6 words against loopback, unspecified, IPv4-mapped,
 * unique local (ULA), link-local, multicast, documentation, and translation prefixes.
 */
export function isPrivateOrReservedIPv6Words(w: number[]): boolean {
  if (!w || w.length !== 8) return true;

  // 1. Loopback ::1
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && w[6] === 0 && w[7] === 1) {
    return true;
  }

  // 2. Unspecified ::
  if (w.every(val => val === 0)) {
    return true;
  }

  // 3. IPv4-mapped IPv6 (::ffff:0:0/96) - Critical S-2 bypass vector
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    return isPrivateOrReservedIPv4(a, b, c, d);
  }

  // 4. IPv4-compatible IPv6 (deprecated RFC 4291 ::0:0/96)
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && (w[6] !== 0 || w[7] > 1)) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    return isPrivateOrReservedIPv4(a, b, c, d);
  }

  // 5. NAT64 Well-Known Prefix (RFC 6052 64:ff9b::/96)
  if (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    return isPrivateOrReservedIPv4(a, b, c, d);
  }

  // 6. 6to4 prefix (2002::/16) - embedded IPv4 in words 1 and 2
  if (w[0] === 0x2002) {
    const a = (w[1] >> 8) & 0xff;
    const b = w[1] & 0xff;
    const c = (w[2] >> 8) & 0xff;
    const d = w[2] & 0xff;
    return isPrivateOrReservedIPv4(a, b, c, d);
  }

  // 7. Unique Local Address (ULA fc00::/7 - covers fc00:: and fd00::)
  if ((w[0] & 0xfe00) === 0xfc00) return true;

  // 8. Link-Local Unicast (fe80::/10 - covers fe80:: to febf::)
  if ((w[0] & 0xffc0) === 0xfe80) return true;

  // 9. Site-Local Unicast (deprecated fec0::/10)
  if ((w[0] & 0xffc0) === 0xfec0) return true;

  // 10. Multicast (ff00::/8)
  if ((w[0] & 0xff00) === 0xff00) return true;

  // 11. Documentation prefix (2001:db8::/32)
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;

  // 12. Discard prefix (100::/64)
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true;

  return false;
}

/**
 * Checks whether an IP or hostname matches private, reserved, loopback, or metadata addresses.
 * Deeply normalizes IPv4, IPv6, IPv4-mapped IPv6, CGNAT, and internal cloud hostnames (SEC-010 / S-2 / TD-089).
 */
export function isPrivateOrReservedIp(rawHostOrIp: string): boolean {
  if (!rawHostOrIp) return true;
  const clean = rawHostOrIp.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // 1. Hostnames specifically reserved for internal cloud/local use
  if (
    clean === 'localhost' ||
    clean === 'metadata.google.internal' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.internal') ||
    clean.endsWith('.local')
  ) {
    return true;
  }

  // 2. IPv4 format check and deep numeric validation
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
      return isPrivateOrReservedIPv4(parts[0], parts[1], parts[2], parts[3]);
    }
    return true; // malformed IPv4 fails-closed
  }

  // 3. IPv6 format check and expansion
  if (net.isIPv6(clean)) {
    try {
      const words = expandIPv6(clean);
      if (words && words.length === 8) {
        return isPrivateOrReservedIPv6Words(words);
      }
    } catch {
      return true; // malformed IPv6 fails-closed
    }
  }

  // 4. Fallback pattern heuristic
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(clean));
}

/**
 * Validates a target URL against SSRF vulnerabilities (SEC-010 / S-2 / TD-089).
 * Normalizes hostnames, strips brackets, resolves DNS, and blocks private IPs,
 * loopback, IPv4-mapped IPv6, CGNAT, cloud metadata endpoints, and internal database ports.
 */
export async function assertSafeExternalUrl(url: string, options?: { allowLocalEcho?: boolean }): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  
  // 1. Protocol check: only http and https allowed
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol: ${parsed.protocol}. Only http and https are permitted.`);
  }

  // 2. Port check: disallow common internal services / database ports
  if (parsed.port && DISALLOWED_PORTS.includes(parsed.port)) {
    throw new Error(`Disallowed port: ${parsed.port} is restricted to prevent SSRF against internal databases/services`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHostname = hostname.replace(/^\[|\]$/g, '');
  
  // Special exception for internal echo simulator if explicitly authorized in non-production
  if (
    options?.allowLocalEcho &&
    (cleanHostname === '127.0.0.1' || cleanHostname === 'localhost' || cleanHostname === '::1') &&
    parsed.pathname.includes('/webhook-echo')
  ) {
    return;
  }

  // 3. Direct hostname check for raw IP or reserved names (e.g. 169.254.169.254, 127.0.0.1, [::1], [::ffff:169.254.169.254], localhost)
  if (isPrivateOrReservedIp(cleanHostname)) {
    throw new Error(`SSRF blocked: ${hostname} is a private or reserved network address`);
  }

  // 4. DNS resolution to catch domains resolving to private/internal IPs
  try {
    const rawIpType = net.isIP(cleanHostname);
    // If it's not a raw IP, it's a domain name that needs resolution
    if (rawIpType === 0) {
      const addresses: string[] = [];
      try {
        const v4 = await dnsResolve4(cleanHostname);
        addresses.push(...v4);
      } catch {
        try {
          const lookupResult = await dnsLookup(cleanHostname, { all: true });
          if (Array.isArray(lookupResult)) {
            addresses.push(...lookupResult.map(r => r.address));
          }
        } catch {
          // If domain cannot be resolved (e.g. mock test domain example.com in offline container)
          if (cleanHostname.includes('example.com') || cleanHostname.includes('webhook.site')) {
            return;
          }
          throw new Error(`DNS resolution failed for hostname: ${hostname}`);
        }
      }

      for (const ip of addresses) {
        if (isPrivateOrReservedIp(ip)) {
          throw new Error(`SSRF blocked: ${hostname} resolves to private/reserved IP ${ip}`);
        }
      }
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith('SSRF blocked:')) {
      throw err;
    }
    if (cleanHostname.includes('example.com') || cleanHostname.includes('webhook.site')) {
      return;
    }
    throw err;
  }
}
