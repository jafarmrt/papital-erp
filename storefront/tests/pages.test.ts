// The pages as a buyer's browser gets them: rendered on the server from the mock Storefront API with the synthetic
// sample (mock/sample), without running any JavaScript. Run `npm run build` first (`npm test` does).
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3911;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    mock.stdout?.on('data', () => resolve());
    mock.on('error', reject);
  });
  process.env.STOREFRONT_API_URL = `http://127.0.0.1:${PORT}/api/storefront/v1`;
  process.env.STOREFRONT_API_KEY = KEY;
  process.env.STOREFRONT_SITE_URL = 'https://shop.example';
  const build = await import(path.join(import.meta.dirname, '../build/server/index.js')) as ServerBuild;
  handle = createRequestHandler(build, 'production');
});

afterAll(() => {
  mock?.kill();
});

const page = async (pathname: string) => {
  const res = await handle(new Request(`http://localhost${pathname}`));
  return { status: res.status, html: await res.text() };
};

describe('storefront pages', () => {
  it('renders the home page in Persian, right to left, with the products and their prices in the HTML', async () => {
    const { status, html } = await page('/');
    expect(status).toBe(200);
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain('گردنبند کاشی نمونه');
    expect(html).toContain('۱٬۴۵۰٬۰۰۰ تومان');
  });

  it('lists, filters and sorts on the server, so the list works without JavaScript', async () => {
    const all = await page('/products');
    expect(all.status).toBe(200);
    expect(all.html).toContain('۳ محصول');
    const filtered = await page(`/products?category=${encodeURIComponent('گوشواره')}`);
    expect(filtered.html).toContain('گوشوارهٔ کاشی نمونه');
    expect(filtered.html).not.toContain('ست هدیهٔ نمونه</a>');
    const cheapest = await page('/products?sort=price_asc');
    expect(cheapest.html.indexOf('گوشوارهٔ کاشی نمونه')).toBeLessThan(cheapest.html.indexOf('ست هدیهٔ نمونه</a>'));
  });

  it('renders a product with its price, stock, details and structured data', async () => {
    const { status, html } = await page('/p/tile-necklace-sample');
    expect(status).toBe(200);
    expect(html).toContain('<h1');
    expect(html).toContain('۱٬۴۵۰٬۰۰۰');
    expect(html).toContain('موجود');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"priceCurrency":"IRR"');
    expect(html).toContain('<link rel="canonical" href="https://shop.example/p/tile-necklace-sample"');
  });

  it('answers 404 for an unknown product, collection or address', async () => {
    expect((await page('/p/no-such-item')).status).toBe(404);
    expect((await page(`/collections/${encodeURIComponent('نیست')}`)).status).toBe(404);
    expect((await page('/no/such/page')).status).toBe(404);
    // a name longer than the ERP takes is a 404 here, not the ERP's 400 shown as «not available»
    expect((await page(`/p/${'a'.repeat(121)}`)).status).toBe(404);
    expect((await page(`/collections/${'ب'.repeat(101)}`)).status).toBe(404);
    expect((await page(`/products?category=${'ب'.repeat(101)}`)).status).toBe(404);
  });

  it('keeps a real collection a page when a filter empties it', async () => {
    const { status, html } = await page(`/collections/${encodeURIComponent('نمونه‌الف')}?category=${encodeURIComponent('ست هدیه')}`);
    expect(status).toBe(200);
    expect(html).not.toContain('گردنبند کاشی نمونه</a>');
  });

  it('underlines only the open category in the header', async () => {
    const { html } = await page(`/products?category=${encodeURIComponent('گوشواره')}`);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/products\?category=[^"]+"|<a[^>]*href="\/products\?category=[^"]+"[^>]*aria-current="page"/);
  });

  it('never puts the API key or the ERP address in a page', async () => {
    for (const p of ['/', '/products', '/p/tile-necklace-sample']) {
      const { html } = await page(p);
      expect(html).not.toContain(KEY);
      expect(html).not.toContain(`127.0.0.1:${PORT}`);
    }
  });

  it('hides the WhatsApp button while the ERP sends no number (switched off)', async () => {
    const { html } = await page('/p/tile-necklace-sample');
    expect(html).not.toContain('wa.me');
  });

  it('shows the logo set in the ERP, served as an image that can run nothing, with the default icon while none is set', async () => {
    const { html } = await page('/');
    const logo = /<img src="(\/brand\/logo\?v=[0-9a-f]{12})"/.exec(html);
    expect(logo).not.toBeNull();
    expect(html).toContain('<link rel="icon" href="/favicon.svg"');
    const res = await handle(new Request(`http://localhost${logo![1]}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect((await handle(new Request('http://localhost/brand/favicon'))).status).toBe(404);
    expect((await handle(new Request('http://localhost/brand/other'))).status).toBe(404);
  });

  it('refuses an image name that is not a content hash, without calling the ERP', async () => {
    expect((await page('/media/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await page('/media/abc.webp')).status).toBe(404);
  });
});
