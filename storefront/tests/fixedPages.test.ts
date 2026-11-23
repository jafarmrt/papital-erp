// v12 phase 10c (owner's decision 23): the pages whose work is in the site's code show the words the shop wrote for them
// in the ERP's «صفحه‌های سایت» (a title, one text above the page's own work, the search title and description), as a
// browser without JavaScript gets them, against the mock Storefront API. Run `npm run build` first. Before this the
// words of these pages could only be changed in the site's code.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { sitePage } from '../app/lib/pages';

const PORT = 3937;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const fixed = (slug: string, title: string, more: Record<string, unknown> = {}) => ({
  slug, kind: 'fixed', title, noindex: false, updatedAt: '2026-11-23T08:00:00.000Z', seoTitle: '', seoDescription: '', shareImage: null, sections: [], ...more,
});
const PAGES = [
  // every word written: a title, a text above the list, the search title and description
  fixed('fixed-products', 'همهٔ زیورهای ما', {
    seoTitle: 'خرید زیور دست‌ساز', seoDescription: 'توضیح نوشتهٔ فروشگاه برای همهٔ محصولات',
    sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن بالای فهرست، نوشتهٔ فروشگاه'), p('پیوند به تماس', [{ type: 'link', attrs: { href: '/contact' } }])] } }],
  }),
  // only a title: the page's own description stays
  fixed('fixed-categories', 'دسته‌بندی زیورها'),
  // the form pages keep their form; the text replaces the page's own first lines
  fixed('fixed-corporate-gift', 'هدیه برای سازمان شما', { sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن تازهٔ هدیهٔ سازمانی')] } }] }),
  fixed('fixed-order-track', 'سفارش من کجاست؟'),
  fixed('fixed-not-found', 'چیزی این‌جا نیست', { seoTitle: 'صفحه‌ای نیست', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('از فهرست بالا ادامه دهید.')] } }] }),
  // a row that says it is a page the shop made is never taken as a fixed page's words
  { ...fixed('fixed-search', 'جست‌وجوی جعلی'), kind: 'custom' },
  // a fixed row the site has no page for is nothing at all
  fixed('fixed-unknown', 'ناشناخته'),
  { slug: 'our-story', kind: 'custom', title: 'داستان ما', noindex: false, updatedAt: '2026-11-20T08:30:00.000Z', seoTitle: '', seoDescription: '', shareImage: null, sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] },
];

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PAGES: JSON.stringify(PAGES) },
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
const h1 = (html: string) => (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '');
const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
const description = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';

describe('the words of the fixed pages', () => {
  it('shows the title, the text above the list and the search words the shop wrote for «همهٔ محصولات», and keeps the list', async () => {
    const { status, html } = await page('/products');
    expect(status).toBe(200);
    expect(h1(html)).toBe('همهٔ زیورهای ما');
    expect(html).toContain('متن بالای فهرست، نوشتهٔ فروشگاه');
    expect(html).toMatch(/<a [^>]*href="\/contact"/);
    expect(title(html)).toBe('خرید زیور دست‌ساز | گالری پاپیتال');
    expect(description(html)).toBe('توضیح نوشتهٔ فروشگاه برای همهٔ محصولات');
    // the page's own work is as it was
    expect(html).toContain('href="/p/tile-necklace-sample"');
    expect(html).toContain('<link rel="canonical" href="https://shop.example/products"/>');
  });

  it('keeps the words of a search, a category and a collection, which are not «همهٔ محصولات»', async () => {
    for (const address of ['/products?q=%DA%AF%D8%B1%D8%AF%D9%86%D8%A8%D9%86%D8%AF', '/products?category=%DA%AF%D8%B1%D8%AF%D9%86%D8%A8%D9%86%D8%AF']) {
      const { status, html } = await page(address);
      expect(status, address).toBe(200);
      expect(h1(html), address).not.toBe('همهٔ زیورهای ما');
      expect(html, address).not.toContain('متن بالای فهرست، نوشتهٔ فروشگاه');
      expect(title(html), address).not.toContain('خرید زیور دست‌ساز');
    }
  });

  it('takes a title alone and keeps the page\'s own description; a page with nothing published keeps all its words', async () => {
    const categories = await page('/categories');
    expect(h1(categories.html)).toBe('دسته‌بندی زیورها');
    expect(title(categories.html)).toBe('دسته‌بندی زیورها | گالری پاپیتال');
    expect(description(categories.html)).toBe('همهٔ دسته‌ها و کالکشن‌های پاپیتال');
    const wholesale = await page('/wholesale');
    expect(h1(wholesale.html)).toBe('درخواست خرید عمده');
    expect(wholesale.html).toContain('برای فروش در فروشگاه یا گالری خودتان');
  });

  it('puts the shop\'s text in place of a form page\'s first lines and leaves the form itself', async () => {
    const gift = await page('/corporate-gift');
    expect(h1(gift.html)).toBe('هدیه برای سازمان شما');
    expect(gift.html).toContain('متن تازهٔ هدیهٔ سازمانی');
    expect(gift.html).not.toContain('برای هدیهٔ همکاران، مشتریان یا مناسبت‌های سازمان');
    expect(gift.html).toMatch(/<form [^>]*method="post"/);
    // a title alone: the page's own first lines stay
    const track = await page('/orders/track');
    expect(h1(track.html)).toBe('سفارش من کجاست؟');
    expect(track.html).toContain('شمارهٔ سفارش و کد پیگیری‌ای را که پس از ثبت سفارش نشان داده شد بنویسید.');
    expect(track.html).toContain('name="robots" content="noindex"');
  });

  it('draws «پیدا نشد» with the shop\'s words, still a 404 no search engine lists', async () => {
    for (const address of ['/no-such-page-anywhere', '/p/no-such-product', '/pages/no-such-page']) {
      const { status, html } = await page(address);
      expect(status, address).toBe(404);
      expect(h1(html), address).toBe('چیزی این‌جا نیست');
      expect(html, address).toContain('از فهرست بالا ادامه دهید.');
      expect(html, address).not.toContain('شاید نشانی عوض شده');
      expect(title(html), address).toBe('صفحه‌ای نیست | گالری پاپیتال');
      expect(html, address).toContain('name="robots" content="noindex"');
    }
  });

  it('is no page to visit by its row\'s name, is in no sitemap, and is not taken from a row of another kind', async () => {
    for (const slug of ['fixed-products', 'fixed-categories', 'fixed-not-found', 'fixed-unknown']) expect((await page(`/pages/${slug}`)).status, slug).toBe(404);
    const sitemap = await page('/sitemap.xml');
    expect(sitemap.html).toContain('<loc>https://shop.example/pages/our-story</loc>');
    expect(sitemap.html).not.toContain('fixed-');
    // «جست‌وجو» keeps its words: the row of that name says it is a page the shop made
    const search = await page('/search');
    expect(h1(search.html)).toBe('جست‌وجو');
    expect(search.html).not.toContain('جست‌وجوی جعلی');
    // the reader of an answer knows the kind, and only for a page the site has
    expect(sitePage(PAGES[0])?.kind).toBe('fixed');
    expect(sitePage(PAGES.find(p2 => p2.slug === 'fixed-unknown'))).toBeNull();
  });

  it('keeps the words read last while the ERP cannot be read, and never takes the page down for its words', async () => {
    expect(h1((await page('/categories')).html)).toBe('دسته‌بندی زیورها');
    await fetch(`http://127.0.0.1:${PORT}/__mock/pages?mode=fail`);
    // past the short time a read is kept
    await new Promise(resolve => setTimeout(resolve, 100));
    const down = await page('/categories');
    expect(down.status).toBe(200);
    expect(['دسته‌بندی زیورها', 'دسته‌ها']).toContain(h1(down.html));
    const search = await page('/search');
    expect(search.status).toBe(200);
    await fetch(`http://127.0.0.1:${PORT}/__mock/pages?mode=ok`);
  });
});
