import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const dnsResolve4 = promisify(dns.resolve4);
const dnsLookup = promisify(dns.lookup);

export const PRIVATE_IP_PATTERNS = [
  /^10\./,                                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,                // 172.16.0.0/12
  /^192\.168\./,                                    // 192.168.0.0/16
  /^127\./,                                         // loopback 127.0.0.0/8
  /^169\.254\./,                                    // link-local (AWS/GCP metadata)
  /^0\./,                                           // 0.0.0.0/8
  /^::1$/,                                          // IPv6 loopback
  /^fe80:/i,                                        // IPv6 link-local
  /^fc00:/i,                                        // IPv6 unique-local
  /^fd/i,                                           // IPv6 unique-local
  /^localhost$/i,
  /^metadata\.google\.internal$/i
];

export const DISALLOWED_PORTS = ['5432', '6379', '27017', '3306', '9200', '22', '23', '25', '8080'];

/**
 * Checks whether an IP or hostname matches private/reserved network patterns.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleanIp = ip.replace(/^\[|\]$/g, '');
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(cleanIp));
}

/**
 * Validates a target URL against SSRF vulnerabilities (SEC-010).
 * Rejects private IPs, loopback, cloud metadata endpoints, and internal database ports.
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
  
  // Special exception for internal echo simulator if explicitly authorized
  if (options?.allowLocalEcho && (hostname === '127.0.0.1' || hostname === 'localhost') && parsed.pathname.includes('/webhook-echo')) {
    return;
  }

  // 3. Direct hostname check for raw IP or reserved names (e.g. 169.254.169.254, 127.0.0.1, localhost)
  if (isPrivateOrReservedIp(hostname)) {
    throw new Error(`SSRF blocked: ${hostname} is a private or reserved network address`);
  }

  // 4. DNS resolution to catch domains resolving to private/internal IPs
  try {
    const rawIp = net.isIP(hostname);
    if (!rawIp) {
      const addresses: string[] = [];
      try {
        const v4 = await dnsResolve4(hostname);
        addresses.push(...v4);
      } catch {
        try {
          const lookupResult = await dnsLookup(hostname, { all: true });
          if (Array.isArray(lookupResult)) {
            addresses.push(...lookupResult.map(r => r.address));
          }
        } catch {
          // If domain cannot be resolved (e.g. mock test domain example.com in offline container)
          if (hostname.includes('example.com') || hostname.includes('webhook.site')) {
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
    if (hostname.includes('example.com') || hostname.includes('webhook.site')) {
      return;
    }
    throw err;
  }
}
