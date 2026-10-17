import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OBS-R2-81 (decision ت۴۰ item 4): three gaps of the SSRF guard are closed. On v10.1.58 an AAAA record pointing inside
 * was never read when the name also had an A record, a system port such as 21 was accepted, and any host merely
 * containing «example.com» or «webhook.site» was accepted in production when its DNS failed.
 */
const dnsAnswers: { v4: Record<string, string[]>; v6: Record<string, string[]> } = { v4: {}, v6: {} };

vi.mock('dns', () => {
  const answer = (table: Record<string, string[]>) => (host: string, cb: (err: Error | null, addrs?: string[]) => void) => {
    const found = table[host];
    if (found) cb(null, found); else cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
  };
  const lookup = (host: string, _opts: unknown, cb: (err: Error | null) => void) => cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
  const mod = { resolve4: answer(dnsAnswers.v4), resolve6: answer(dnsAnswers.v6), lookup };
  return { default: mod, ...mod };
});

const reasonOf = async (url: string): Promise<string> => {
  const { assertSafeExternalUrl } = await import('../../lib/ssrfGuard');
  try {
    await assertSafeExternalUrl(url);
    return 'accepted';
  } catch (err) {
    return String((err as { details?: { reason?: string } }).details?.reason ?? (err as Error).message);
  }
};

describe('ssrf_guard_gaps_obs_r2_81', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    dnsAnswers.v4 = { 'dual.partner.test': ['93.184.216.34'], 'public.partner.test': ['93.184.216.34'] };
    dnsAnswers.v6 = { 'dual.partner.test': ['fd00::1'] };
  });
  afterEach(() => { process.env.NODE_ENV = env; });

  it('reads the AAAA records too: a name with a public A and an internal AAAA record is refused', async () => {
    expect(await reasonOf('https://dual.partner.test/hook')).toBe('private_resolution');
    expect(await reasonOf('https://public.partner.test/hook')).toBe('accepted');
  });

  it('accepts only 80, 443 and unprivileged ports outside the database list', async () => {
    expect(await reasonOf('https://public.partner.test:21/')).toBe('port');
    expect(await reasonOf('https://public.partner.test:445/')).toBe('port');
    expect(await reasonOf('https://public.partner.test:5432/')).toBe('port');
    expect(await reasonOf('https://public.partner.test:443/')).toBe('accepted');
    expect(await reasonOf('https://public.partner.test:8443/')).toBe('accepted');
  });

  it('accepts an unresolved example.com host only in test and development, and never a look-alike', async () => {
    process.env.NODE_ENV = 'test';
    expect(await reasonOf('https://partner.example.com/hook')).toBe('accepted');
    expect(await reasonOf('https://example.com.attacker.test/hook')).toBe('dns_failed');
    expect(await reasonOf('https://my.webhook.site/hook')).toBe('dns_failed');
    process.env.NODE_ENV = 'production';
    expect(await reasonOf('https://partner.example.com/hook')).toBe('dns_failed');
  });
});
