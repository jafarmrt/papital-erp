import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

/**
 * 10.2 package 6 review M-5 (OBS-R2-81): the shop request checks the address the socket really connects to. Before, the
 * name was resolved once by `assertSafeExternalUrl` and again by the socket, so a name answering a public address to the
 * check and an inside one to the socket (DNS rebinding) reached the inside address. `guardedDnsLookup` is the lookup of
 * every shop request and refuses any private or reserved address at connect time.
 */
const answers: Record<string, Array<{ address: string; family: number }>> = {
  'public.shop.test': [{ address: '93.184.216.34', family: 4 }],
  'mixed.shop.test': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }],
  'inside.shop.test': [{ address: '127.0.0.1', family: 4 }],
  'v6inside.shop.test': [{ address: '::1', family: 6 }],
  'empty.shop.test': [],
};

vi.mock('dns', () => {
  const lookup = (host: string, opts: { all?: boolean }, cb: (err: Error | null, addrs?: unknown) => void) => {
    const found = answers[host];
    if (!found) cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
    else cb(null, opts.all ? found : found[0]?.address);
  };
  const mod = { lookup, resolve4: vi.fn(), resolve6: vi.fn() };
  return { default: mod, ...mod };
});

async function lookupOf(host: string): Promise<{ code?: string; addresses?: unknown }> {
  const { guardedDnsLookup } = await import('../../lib/ssrfGuard');
  return new Promise(resolve => {
    guardedDnsLookup(host, {}, (err, addresses) => resolve(err ? { code: err.code } : { addresses }));
  });
}

describe('wc_connect_time_lookup_d04_m5', () => {
  it('passes a public address through with every address listed', async () => {
    expect(await lookupOf('public.shop.test')).toEqual({ addresses: answers['public.shop.test'] });
  });

  it('refuses a name that resolves to any private or reserved address at connect time', async () => {
    for (const host of ['mixed.shop.test', 'inside.shop.test', 'v6inside.shop.test', 'empty.shop.test']) {
      expect((await lookupOf(host)).code).toBe('EUNSAFEADDRESS');
    }
  });

  it('keeps the resolver error of a name that does not resolve', async () => {
    expect((await lookupOf('missing.shop.test')).code).toBe('ENOTFOUND');
  });

  it('every shop request carries the guarded lookup, a deadline signal and a size cap', () => {
    const src = readFileSync(path.resolve(__dirname, '../../services/woocommerce/wcClient.ts'), 'utf8');
    expect(src).toMatch(/lookup:\s*guardedDnsLookup/);
    expect(src).toMatch(/maxContentLength:\s*WC_MAX_RESPONSE_BYTES/);
    expect(src).toMatch(/signal/);
  });
});
