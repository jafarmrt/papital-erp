import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { followShopRedirects, shopRedirectTarget, WC_MAX_REDIRECTS, type ShopHop } from '../../lib/woocommerce/wcRedirect';
import { allowTestLoopbackOrigin, assertSafeExternalUrl, isTestLoopbackOrigin, withDnsTimeout } from '../../lib/ssrfGuard';
import { buildSecretsAtRestHealthTest } from '../../services/system/secretsAtRestHealth';

const SET_KEY_FIRST = 'نخست کلید ERP_SECRETS_KEY';
const KEY_NOT_DEFINED = 'روی کارساز تعریف نشده است';

const shop = 'http://shop.example.com/wp-json/wc/v3/products';

function scripted(answers: Array<ShopHop<unknown>>) {
  const sent: string[] = [];
  const send = vi.fn(async (url: string) => {
    sent.push(url);
    const next = answers.shift();
    if (!next) throw new Error('no scripted answer left');
    return next;
  });
  return { send, sent };
}

describe('OBS-R2-82: shop redirects are followed by hand, same site only, each through the guard', () => {
  it('accepts http -> https, adding or removing www and a path change, and drops the query', () => {
    expect(shopRedirectTarget(shop, 'https://shop.example.com/wp-json/wc/v3/products?consumer_key=x'))
      .toBe('https://shop.example.com/wp-json/wc/v3/products');
    expect(shopRedirectTarget(shop, 'http://www.shop.example.com/wp-json/wc/v3/products')).toBe('http://www.shop.example.com/wp-json/wc/v3/products');
    expect(shopRedirectTarget('https://www.Shop.example.com/a', '/store/wp-json/wc/v3/products')).toBe('https://www.shop.example.com/store/wp-json/wc/v3/products');
  });

  it('refuses another host, https -> http, another port, credentials or no Location', () => {
    expect(shopRedirectTarget(shop, 'https://evil.example.net/wp-json')).toBeNull();
    expect(shopRedirectTarget(shop, 'http://shop.example.com.evil.net/')).toBeNull();
    expect(shopRedirectTarget('https://shop.example.com/a', 'http://shop.example.com/a')).toBeNull();
    expect(shopRedirectTarget(shop, 'http://shop.example.com:8443/a')).toBeNull();
    expect(shopRedirectTarget(shop, 'http://user:pw@shop.example.com/a')).toBeNull();
    expect(shopRedirectTarget(shop, 'http://169.254.169.254/latest/meta-data')).toBeNull();
    expect(shopRedirectTarget(shop, undefined)).toBeNull();
  });

  it('follows an allowed hop after the guard has checked it', async () => {
    const { send, sent } = scripted([
      { status: 301, location: 'https://www.shop.example.com/wp-json/wc/v3/products', data: '' },
      { status: 200, data: [{ id: 1 }] },
    ]);
    const guard = vi.fn(async () => undefined);
    await expect(followShopRedirects(shop, send, guard)).resolves.toEqual([{ id: 1 }]);
    expect(sent).toEqual([shop, 'https://www.shop.example.com/wp-json/wc/v3/products']);
    expect(guard).toHaveBeenCalledWith('https://www.shop.example.com/wp-json/wc/v3/products');
  });

  it('refuses a cross-host redirect with 422 WC_REDIRECT_REFUSED and sends nothing there', async () => {
    const { send, sent } = scripted([{ status: 302, location: 'https://attacker.example.net/collect', data: '' }]);
    const guard = vi.fn(async () => undefined);
    await expect(followShopRedirects(shop, send, guard)).rejects.toMatchObject({ statusCode: 422, code: 'WC_REDIRECT_REFUSED' });
    expect(sent).toEqual([shop]);
    expect(guard).not.toHaveBeenCalled();
  });

  it('stops when the guard refuses a same-site hop (a name resolving inside), before sending', async () => {
    const { send, sent } = scripted([{ status: 301, location: 'https://shop.example.com/wp-json/wc/v3/products', data: '' }]);
    const guard = vi.fn(async () => { throw Object.assign(new Error('private'), { code: 'UNSAFE_TARGET_URL' }); });
    await expect(followShopRedirects(shop, send, guard)).rejects.toMatchObject({ code: 'UNSAFE_TARGET_URL' });
    expect(sent).toEqual([shop]);
  });

  it('the real guard refuses a hop to an internal address of the same shop IP host', async () => {
    const ipShop = 'http://10.0.0.5/wp-json/wc/v3/products';
    const { send, sent } = scripted([{ status: 301, location: 'https://10.0.0.5/wp-json/wc/v3/products', data: '' }]);
    await expect(followShopRedirects(ipShop, send, (url) => assertSafeExternalUrl(url, { allowLocalEcho: false })))
      .rejects.toMatchObject({ code: 'UNSAFE_TARGET_URL' });
    expect(sent).toEqual([ipShop]);
  });

  it(`stops after ${WC_MAX_REDIRECTS} hops with 422 WC_REDIRECT_LIMIT`, async () => {
    const loop = Array.from({ length: WC_MAX_REDIRECTS + 1 }, (_, i) => ({
      status: 302, location: `https://shop.example.com/hop${i}`, data: '',
    }));
    const { send, sent } = scripted(loop);
    await expect(followShopRedirects(shop, send, async () => undefined)).rejects.toMatchObject({ code: 'WC_REDIRECT_LIMIT' });
    expect(sent).toHaveLength(WC_MAX_REDIRECTS + 1);
  });

  it('makeWcRequest sends every shop request through the manual redirect loop', () => {
    const src = readFileSync('src/routes/woocommerce.routes.ts', 'utf8');
    const start = src.indexOf('async function makeWcRequest');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('followShopRedirects(');
    expect(body).toContain('maxRedirects: 0');
    expect(body).toContain('wcAuthQueryParams(url,');
    expect(body).toContain("assertSafeExternalUrl(url, { allowLocalEcho: false })");
  });
});

describe('OBS-R2-82: a test stand-in shop passes the guard only by its exact origin', () => {
  it('is refused outside NODE_ENV test and lets no other loopback port through', async () => {
    expect(() => allowTestLoopbackOrigin('http://127.0.0.1:40123', { NODE_ENV: 'production' })).toThrow('tests only');
    const undo = allowTestLoopbackOrigin('http://127.0.0.1:40123');
    try {
      await expect(assertSafeExternalUrl('http://127.0.0.1:40123/wp-json/wc/v3/products', { allowLocalEcho: false })).resolves.toBeUndefined();
      expect(isTestLoopbackOrigin(new URL('http://127.0.0.1:40123/x'), { NODE_ENV: 'production' })).toBe(false);
      await expect(assertSafeExternalUrl('http://127.0.0.1:40124/', { allowLocalEcho: false })).rejects.toMatchObject({ code: 'UNSAFE_TARGET_URL' });
    } finally {
      undo();
    }
    await expect(assertSafeExternalUrl('http://127.0.0.1:40123/', { allowLocalEcho: false })).rejects.toMatchObject({ code: 'UNSAFE_TARGET_URL' });
  });
});

describe('OBS-R2-81: DNS lookups of the SSRF guard have a short timeout', () => {
  it('rejects a lookup that does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = withDnsTimeout(new Promise<string[]>(() => undefined), 3000);
      const settled = expect(pending).rejects.toThrow('DNS lookup timed out');
      await vi.advanceTimersByTimeAsync(3000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes a timely answer through', async () => {
    await expect(withDnsTimeout(Promise.resolve(['93.184.216.34']), 3000)).resolves.toEqual(['93.184.216.34']);
  });
});

describe('OBS-PR-07: secrets at rest says to set ERP_SECRETS_KEY first when it is missing', () => {
  it('names the key in the plain-text and unreadable items only when no key is set', () => {
    const counts = { plaintext: { personnel: 0, settings: 0, webhooks: 2 }, unreadable: 1, nonBcryptPasswords: 0 };
    const noKey = buildSecretsAtRestHealthTest({ ...counts, keyConfigured: false });
    expect(noKey.status).toBe('warning');
    expect(noKey.items?.find(i => i.id === 'plaintext_secrets')?.details).toContain(SET_KEY_FIRST);
    expect(noKey.items?.find(i => i.id === 'unreadable_secrets')?.details).toContain(KEY_NOT_DEFINED);
    const withKey = buildSecretsAtRestHealthTest({ ...counts, keyConfigured: true });
    expect(withKey.items?.find(i => i.id === 'plaintext_secrets')?.details).not.toContain(SET_KEY_FIRST);
    expect(withKey.items?.find(i => i.id === 'unreadable_secrets')?.details).not.toContain(KEY_NOT_DEFINED);
  });
});
