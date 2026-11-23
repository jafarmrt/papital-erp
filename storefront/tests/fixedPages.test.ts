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
  fixed('fixed-not-found', 'چیزی این‌جا نیست', { seoTitle: 'صفحه‌ای نیست', seoDescription: 'این نشانی صفحه‌ای ندارد', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('از فهرست بالا ادامه دهید.')] } }] }),
  // v12 phase 10d: the list of news
  fixed('fixed-news', 'تازه‌های گالری', {
    seoTitle: 'خبرهای گالری پاپیتال', seoDescription: 'توضیح نوشتهٔ فروشگاه برای خبرها',
    sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن بالای فهرست خبرها')] } }],
  }),
  fixed('fixed-search', 'بگردید', { sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن بالای جست‌وجو')] } }] }),
  fixed('fixed-cart', 'سبد شما', { seoTitle: 'سبد خرید شما', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن بالای سبد')] } }] }),
  fixed('fixed-account', 'حساب شما', { sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن بالای حساب')] } }] }),
  // a row that says it is a page the shop made is never taken as a fixed page's words
  { ...fixed('fixed-wholesale', 'عمدهٔ جعلی'), kind: 'custom' },
  // a fixed row the site has no page for is nothing at all
  fixed('fixed-unknown', 'ناشناخته'),
  { slug: 'our-story', kind: 'custom', title: 'داستان ما', noindex: false, updatedAt: '2026-11-20T08:30:00.000Z', seoTitle: '', seoDescription: '', shareImage: null, sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] },
];

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    // ordering is on, so the cart is a page
    env: {
      ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PAGES: JSON.stringify(PAGES), MOCK_ORDERING: '1',
      // three news items, two a page, so the list has a second page
      MOCK_NEWS: JSON.stringify({ enabled: true, pageSize: 2, items: ['یک', 'دو', 'سه'].map((word, i) => ({
        slug: `news-${i + 1}`, title: `خبر ${word}`, summary: '', date: `2026-11-0${i + 1}`, cover: null, updatedAt: '2026-11-05T08:00:00.000Z', seoTitle: '', seoDescription: '', sections: [],
      })) }),
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
  process.env.STOREFRONT_TRUST_PROXY = '1';
  process.env.STOREFRONT_FORM_MIN_SECONDS = '0';
  const build = await import(path.join(import.meta.dirname, '../build/server/index.js')) as ServerBuild;
  // as server.mjs does: the site's own host is an allowed origin of a form post
  handle = createRequestHandler({ ...build, allowedActionOrigins: ['shop.example'] }, 'production');
});

afterAll(() => {
  mock?.kill();
});

const page = async (pathname: string, cookie = '') => {
  const res = await handle(new Request(`http://localhost${pathname}`, { headers: cookie ? { cookie } : {} }));
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
    for (const address of ['/products?q=%DA%AF%D8%B1%D8%AF%D9%86%D8%A8%D9%86%D8%AF', '/products?category=%DA%AF%D8%B1%D8%AF%D9%86%D8%A8%D9%86%D8%AF', `/collections/${encodeURIComponent('نمونه‌الف')}`]) {
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
    // «درخواست خرید عمده»: the row of its name says it is a page the shop made, so it is not this page's words
    const wholesale = await page('/wholesale');
    expect(h1(wholesale.html)).toBe('درخواست خرید عمده');
    expect(wholesale.html).toContain('برای فروش در فروشگاه یا گالری خودتان');
    expect(wholesale.html).not.toContain('عمدهٔ جعلی');
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

  it('gives «جست‌وجو», «سبد خرید» and «حساب من» their words too, and keeps them out of a search engine as before', async () => {
    const search = await page('/search');
    expect(h1(search.html)).toBe('بگردید');
    expect(search.html).toContain('متن بالای جست‌وجو');
    expect(search.html).toContain('name="robots" content="noindex"');
    expect(search.html).toMatch(/<form [^>]*action="\/products"/);
    const cart = await page('/cart');
    expect(cart.status).toBe(200);
    expect(h1(cart.html)).toBe('سبد شما');
    expect(cart.html).toContain('متن بالای سبد');
    expect(title(cart.html)).toBe('سبد خرید شما | گالری پاپیتال');
    expect(cart.html).toContain('name="robots" content="noindex"');
    // «حساب من» is the buyer's own page: a phone is proven by code and signs up against the mock, which gives a session
    const post = async (pathname: string, fields: Record<string, string>, cookie = '') => handle(new Request(`http://localhost${pathname}`, {
      method: 'POST', body: new URLSearchParams(fields), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
    }));
    const kept = (res: Response, cookieName: string) => (res.headers.getSetCookie().find(c => c.startsWith(`${cookieName}=`)) ?? '').split(';')[0];
    await post('/account/sign-in', { intent: 'send-code', contact: '09123456789', next: '/' });
    const proof = kept(await post('/account/sign-in', { intent: 'verify-code', contact: '09123456789', code: '123456', next: '/' }), 'sf_proof');
    const formAt = /name="formAt" value="([^"]+)"/.exec((await page('/corporate-gift')).html)?.[1] ?? '';
    const session = kept(await post('/account/sign-up', { intent: 'register', phone: '09123456789', name: 'خریدار آزمون', password: 'رمز-آزمون-1405', next: '/', formAt }, proof), 'sf_session');
    expect(session).toMatch(/^sf_session=/);
    const account = await page('/account', session);
    expect(account.status).toBe(200);
    expect(h1(account.html)).toBe('حساب شما');
    expect(account.html).toContain('متن بالای حساب');
    expect(account.html).toContain('name="robots" content="noindex"');
  });

  it('draws «پیدا نشد» with the shop\'s words, still a 404 no search engine lists', async () => {
    for (const address of ['/no-such-page-anywhere', '/p/no-such-product', '/pages/no-such-page']) {
      const { status, html } = await page(address);
      expect(status, address).toBe(404);
      expect(h1(html), address).toBe('چیزی این‌جا نیست');
      expect(html, address).toContain('از فهرست بالا ادامه دهید.');
      expect(html, address).not.toContain('شاید نشانی عوض شده');
      expect(title(html), address).toBe('صفحه‌ای نیست | گالری پاپیتال');
      expect(description(html), address).toBe('این نشانی صفحه‌ای ندارد');
      expect(html, address).toContain('name="robots" content="noindex"');
    }
  });

  it('writes the shop\'s words above the list of news: its title, the text on the first page, and the search words (v12 phase 10d)', async () => {
    const first = await page('/news');
    expect(first.status).toBe(200);
    expect(first.html).toMatch(/<h1[^>]*>تازه‌های گالری<\/h1>/);
    // what is drawn of the list, from its top to its page links (the page's own data, further down, carries the words on every page)
    const drawn = (html: string) => html.slice(html.indexOf('data-news-list'), html.indexOf('aria-label="صفحه‌ها"'));
    expect(drawn(first.html)).toContain('متن بالای فهرست خبرها');
    expect(title(first.html)).toBe('خبرهای گالری پاپیتال | گالری پاپیتال');
    expect(description(first.html)).toBe('توضیح نوشتهٔ فروشگاه برای خبرها');
    // the trail a search engine reads names the list as the shop does
    expect(first.html).toMatch(/"name":"تازه‌های گالری","item":"https:\/\/shop\.example\/news"/);
    // a later page keeps the title and the search words, with its number, and does not repeat the text
    const second = await page('/news?page=2');
    expect(second.html).toMatch(/<h1[^>]*>تازه‌های گالری<\/h1>/);
    expect(drawn(second.html)).toContain('خبر سه');
    expect(drawn(second.html)).not.toContain('متن بالای فهرست خبرها');
    expect(title(second.html)).toBe('خبرهای گالری پاپیتال، صفحهٔ ۲ | گالری پاپیتال');
    // the row is words, not a page to visit
    expect((await page('/pages/fixed-news')).status).toBe(404);
  });

  it('is no page to visit by its row\'s name, is in no sitemap, and is not taken from a row of another kind', async () => {
    for (const slug of ['fixed-products', 'fixed-categories', 'fixed-not-found', 'fixed-unknown']) expect((await page(`/pages/${slug}`)).status, slug).toBe(404);
    const sitemap = await page('/sitemap.xml');
    expect(sitemap.html).toContain('<loc>https://shop.example/pages/our-story</loc>');
    expect(sitemap.html).not.toContain('fixed-');
    // the reader of an answer knows the kind, and only for a page the site has
    expect(sitePage(PAGES[0])?.kind).toBe('fixed');
    expect(sitePage(PAGES.find(p2 => p2.slug === 'fixed-unknown'))).toBeNull();
  });

  it('keeps the words read last while the ERP cannot be read, and never takes the page down for its words', async () => {
    expect(h1((await page('/categories')).html)).toBe('دسته‌بندی زیورها');
    await fetch(`http://127.0.0.1:${PORT}/__mock/pages?mode=fail`);
    // the words read are kept a minute, so the ERP is not asked again here; a page whose words were never read (hers is
    // the first read, and it fails) is drawn with its own words, and is not down
    const down = await page('/categories');
    expect(down.status).toBe(200);
    expect(h1(down.html)).toBe('دسته‌بندی زیورها');
    const track = await page('/orders/track');
    expect(track.status).toBe(200);
    await fetch(`http://127.0.0.1:${PORT}/__mock/pages?mode=ok`);
  });
});
