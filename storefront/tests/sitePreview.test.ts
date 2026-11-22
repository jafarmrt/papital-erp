// v12 phase 10c («پیش‌نمایش»): a colleague's one-hour link to a page's draft, on the built site against the mock Storefront
// API (MOCK_PREVIEWS). Run `npm run build` first. Before this the site had no `/preview/<key>` at all.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3934;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

// keys in the shape the ERP makes (43 characters of base64url); these open nothing anywhere but in this mock
const TOKEN = 'Ab3_dE5-gH7jK9mN1pQ3sT5vX7zB9dF1hJ3lM5oP7rS';
const ENDED = 'Zz9_yX7-wV5uT3sR1qP9oN7mL5kJ3iH1gF9eD7cB5aA';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const image = (sha256: string, alt: string) => ({ sha256, width: 1600, height: 1000, alt, thumb: true });
const DRAFT = {
  slug: 'new-collection', kind: 'custom', title: 'کالکشن تازه', noindex: false, updatedAt: '2026-11-22T08:00:00.000Z', expiresAt: '2026-11-22T09:30:00.000Z',
  seoTitle: 'عنوان جست‌وجوی پیش‌نویس', seoDescription: 'توضیح پیش‌نویس', shareImage: image(A, ''),
  sections: [
    { kind: 'hero', background: 'brand', title: 'به‌زودی', text: 'هنوز منتشر نشده است.', image: image(A, ''), buttonLabel: 'محصولات', buttonHref: '/products' },
    { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن پیش‌نویس' }] }, { type: 'libraryImage', attrs: { sha256: B, width: 800, height: 600, alt: 'عکس درون متن', thumb: 0 } }] } },
    { kind: 'products', background: 'white', title: 'برگزیده‌ها', collection: '', products: ['tile-necklace-sample'] },
  ],
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: {
      ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PREVIEWS: JSON.stringify({ [TOKEN]: DRAFT }), MOCK_PREVIEW_MEDIA: `${A}.webp,${A}-thumb.webp,${B}.webp`,
      // visit statistics are on, as on the live site: the preview must still load none
      MOCK_SEO: JSON.stringify({ verification: { google: '', bing: '' }, analytics: { provider: 'ga4', id: 'G-TEST123', url: '' }, alternateSiteUrl: '' }),
    },
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

const ask = (pathname: string) => handle(new Request(`http://localhost${pathname}`));
const reads = async () => Number((await (await fetch(`http://127.0.0.1:${PORT}/__mock/preview-reads`)).json() as { reads: number }).reads);

describe('the preview of a page\'s draft', () => {
  it('draws the draft as a page, says that it is a preview and until when, and is for no search engine and no cache', async () => {
    const res = await ask(`/preview/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    // the key is in the address: the browser tells no other site where a click came from
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).toContain('<title>پیش‌نمایش: کالکشن تازه | گالری پاپیتال</title>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain('<meta name="referrer" content="no-referrer"/>');
    // 09:30 UTC is 13:00 in Tehran
    expect(html).toMatch(/data-preview-note[^>]*>پیش‌نمایش پیش‌نویس است و هنوز روی سایت نیست\. این نشانی تا ساعت ۱۳:۰۰ کار می‌کند\./);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>به‌زودی<\/h1>/);
    expect(html).toContain('متن پیش‌نویس');
    expect([...html.matchAll(/data-page-section="([a-zA-Z]+)"/g)].map(m => m[1])).toEqual(['hero', 'text', 'products']);
    // nothing that would put the draft's address or words into a search engine
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('BreadcrumbList');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('/pages/new-collection');
    expect(html).not.toContain('name="description"');
  });

  it('loads no visit statistics, which would read the key from the address, though every other page does', async () => {
    const home = await (await ask('/')).text();
    expect(home).toContain('googletagmanager.com/gtag/js?id=G-TEST123');
    const html = await (await ask(`/preview/${TOKEN}`)).text();
    expect(html).not.toContain('googletagmanager');
    expect(html).not.toContain('gtag(');
    expect(html).not.toContain('_paq');
    // an ended link's «پیدا نشد» has the key in its address too
    const ended = await ask(`/preview/${ENDED}`);
    expect(ended.status).toBe(404);
    expect(await ended.text()).not.toContain('googletagmanager');
  });

  it('reads the draft\'s own images under the key, and a product\'s photo from the site as always', async () => {
    const html = await (await ask(`/preview/${TOKEN}`)).text();
    expect(html).toContain(`src="/preview/${TOKEN}/media/${A}.webp"`);
    expect(html).toContain(`/preview/${TOKEN}/media/${A}-thumb.webp 400w`);
    expect(html).toContain(`src="/preview/${TOKEN}/media/${B}.webp" alt="عکس درون متن"`);
    // the draft's images are not on the site: no address of the site's own image route names them
    expect(html).not.toContain(`"/media/${A}`);
    expect(html).not.toContain(`"/media/${B}`);
    const card = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    expect(card).toContain('href="/p/tile-necklace-sample"');
    expect(card).not.toContain('/preview/');
    const good = await ask(`/preview/${TOKEN}/media/${A}.webp`);
    expect(good.status).toBe(200);
    expect(good.headers.get('content-type')).toBe('image/webp');
    expect(good.headers.get('cache-control')).toBe('private, no-store');
    expect(good.headers.get('x-robots-tag')).toBe('noindex');
    expect(await good.text()).toBe(`preview-image-${A}.webp`);
    // an image the draft does not name, a name that is no file, and the site's own route for the same file
    expect((await ask(`/preview/${TOKEN}/media/${'c'.repeat(64)}.webp`)).status).toBe(404);
    // a name that climbs out of the image route to another answer of the ERP (its settings, the site's pages) is not asked for
    for (const climb of ['..%2F..%2Fsettings', '..%2F..%2F..%2Fsettings', '..%2Fmedia%2F..%2F..%2Fpages', '%2e%2e%2f%2e%2e%2fsettings']) {
      expect((await ask(`/preview/${TOKEN}/media/${climb}`)).status, climb).toBe(404);
    }
    expect((await ask(`/media/${A}.webp`)).status).toBe(404);
    expect((await ask(`/preview/${ENDED}/media/${A}.webp`)).status).toBe(404);
  });

  it('reads the ERP each time it is opened and keeps nothing, so a saved draft shows at once and an ended link stops at once', async () => {
    const before = await reads();
    await ask(`/preview/${TOKEN}`);
    await ask(`/preview/${TOKEN}`);
    expect(await reads()).toBe(before + 2);
  });

  it('is the same 404 for an unknown or ended key and for a key in another shape, which is never sent to the ERP', async () => {
    // an ended key has the right shape: the ERP is asked, and says no
    const first = await reads();
    expect((await ask(`/preview/${ENDED}`)).status).toBe(404);
    expect(await reads()).toBe(first + 1);
    const before = await reads();
    for (const wrong of ['short', `${TOKEN}x`, `${TOKEN.slice(0, 42)}.`, '..%2Fpages', 'x'.repeat(200)]) {
      expect((await ask(`/preview/${wrong}`)).status, wrong).toBe(404);
      expect((await ask(`/preview/${wrong}/media/${A}.webp`)).status, `${wrong} image`).toBe(404);
    }
    expect((await ask('/preview')).status).toBe(404);
    // nor is a file name in another shape, under a good key
    expect((await ask(`/preview/${TOKEN}/media/${A}.png`)).status).toBe(404);
    expect(await reads()).toBe(before);
    // and it is in no list of the site's pages
    const xml = await (await ask('/sitemap.xml')).text();
    expect(xml).not.toContain('preview');
    expect((await (await ask('/robots.txt')).text())).not.toContain('preview');
  });
});
