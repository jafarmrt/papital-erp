// v12 phase 10e: «پیش‌نمایش» of the draft of «صفحهٔ اصلی»: the colleague's one-hour link draws the draft as the home page
// it would be, with its images read under the key, while the site's own home page stays as it is. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3944;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

// keys in the shape the ERP makes (43 characters of base64url); these open nothing anywhere but in this mock
const TOKEN = 'Hm3_dE5-gH7jK9mN1pQ3sT5vX7zB9dF1hJ3lM5oP7rS';
const EMPTY = 'Em9_yX7-wV5uT3sR1qP9oN7mL5kJ3iH1gF9eD7cB5aA';
const UNTITLED = 'Un5_kL2-pQ8rS4tU6vW1xY3zA7bC9dE2fG4hJ6mN8oP';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const image = (sha256: string, alt: string) => ({ sha256, width: 1600, height: 600, alt, thumb: false });
// as the ERP answers: the page's own summary (its parts of every page alone) and the home page the draft would be
const page = { slug: 'fixed-home', kind: 'custom', title: 'صفحهٔ اصلی', noindex: true, updatedAt: '2026-11-24T08:00:00.000Z', expiresAt: '2026-11-24T09:30:00.000Z', seoTitle: 'عنوان پیش‌نویس', seoDescription: '', shareImage: null, sections: [] };
const DRAFT = {
  ...page,
  home: {
    seoTitle: 'عنوان پیش‌نویس', seoDescription: '', shareImage: null, updatedAt: page.updatedAt,
    sections: [
      { kind: 'slider', slides: [{ image: image(A, 'اسلاید پیش‌نویس'), mobileImage: { ...image(B, 'اسلاید پیش‌نویس'), width: 800, height: 1000 }, title: 'تیتر پیش‌نویس خانه', text: '', buttonLabel: 'محصولات', href: '/products', external: false }] },
      { kind: 'banner', image: image(C, 'بنر پیش‌نویس'), mobileImage: null, href: '', external: false },
      { kind: 'homeFeatured', title: 'برگزیده‌های پیش‌نویس', buttonLabel: '', buttonHref: '' },
      { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن میان بخش‌های پیش‌نویس' }] }] } },
      { kind: 'collectionIntro', background: 'cream', title: '', collection: 'نمونه', intro: 'معرفی کالکشن در پیش‌نویس', image: image('d'.repeat(64), 'عکس کالکشن'), moreHref: '', products: ['tile-necklace-sample'] },
    ],
  },
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: {
      ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_CAMPAIGNS: '0',
      MOCK_PREVIEWS: JSON.stringify({
        [TOKEN]: DRAFT, [EMPTY]: { ...page, home: { ...DRAFT.home, sections: [] } },
        [UNTITLED]: { ...page, home: { ...DRAFT.home, sections: [{ kind: 'homeCategories', title: 'دسته‌ها در پیش‌نویس' }] } },
      }),
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

describe('the preview of the home page\'s draft', () => {
  it('draws the draft as a home page, as a preview: for no search engine, no cache and no visit statistics', async () => {
    const res = await ask(`/preview/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).toContain('<title>پیش‌نمایش: صفحهٔ اصلی | گالری پاپیتال</title>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toMatch(/data-preview-note[^>]*>پیش‌نمایش پیش‌نویس است و هنوز روی سایت نیست\. این نشانی تا ساعت ۱۳:۰۰ کار می‌کند\./);
    const drawn = html.slice(0, html.indexOf('window.__reactRouterContext'));
    expect([...drawn.matchAll(/data-home-part="([^"]+)"/g)].map(mark => mark[1])).toEqual(['slider', 'banner', 'homeFeatured', 'page', 'collectionIntro']);
    expect([...drawn.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(['تیتر پیش‌نویس خانه']);
    expect(drawn).toContain('متن میان بخش‌های پیش‌نویس');
    expect(drawn).toContain('معرفی کالکشن در پیش‌نویس');
    // the row of products is read from the catalog as on the home page
    expect(drawn).toContain('/p/tile-necklace-sample');
    for (const never of ['googletagmanager', 'rel="canonical"', 'og:', 'name="description"', 'application/ld+json']) expect(html, never).not.toContain(never);
  });

  it('reads the draft\'s own images under the key, and the collection\'s image from the site, where it already is', async () => {
    const html = await (await ask(`/preview/${TOKEN}`)).text();
    expect(html).toContain(`src="/preview/${TOKEN}/media/${A}.webp"`);
    expect(html).toContain(`<source media="(max-width: 639px) and (orientation: portrait)" srcSet="/preview/${TOKEN}/media/${B}.webp"`);
    expect(html).toContain(`src="/preview/${TOKEN}/media/${C}.webp"`);
    for (const file of [A, B, C]) expect(html, file).not.toContain(`"/media/${file}.webp"`);
    expect(html).toContain(`src="/media/${'d'.repeat(64)}.webp"`);
  });

  it('says so when the draft has nothing to show today, and leaves the site\'s own home page as it is', async () => {
    const res = await ask(`/preview/${EMPTY}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('این پیش‌نویس صفحهٔ اصلی امروز چیزی برای نشان دادن ندارد');
    expect(html).not.toContain('data-home-part=');
    expect([...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1])).toEqual(['صفحهٔ اصلی']);
    // a draft with no part that writes the page's heading has the shop's name for it, as the home page itself would
    const untitled = await (await ask(`/preview/${UNTITLED}`)).text();
    expect([...untitled.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[0])).toEqual(['<h1 class="sr-only">گالری پاپیتال</h1>']);
    const home = await (await ask('/')).text();
    // the site's own opening words, in two lines as they have always been
    expect(home).toMatch(/<h1[^>]*>کاشی‌های ایران،<br\/>این بار برای پوشیدن<\/h1>/);
    expect(home).not.toContain('تیتر پیش‌نویس خانه');
    expect(home).not.toContain('data-preview-note');
  });
});
