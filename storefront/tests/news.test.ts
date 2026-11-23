// v12 phase 10d: the news of the ERP's «خبرهای سایت» as a visitor's browser gets them: the list a page at a time and one
// item, rendered on the server from the mock Storefront API, without running any JavaScript. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { siteNewsIndex, siteNewsItem, siteNewsList } from '../app/lib/news';

const PORT = 3938;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const SHA = (letter: string) => letter.repeat(64);
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const item = (slug: string, title: string, date: string, over: Record<string, unknown> = {}) => ({
  slug, title, summary: `خلاصهٔ ${title}`, date, cover: null, updatedAt: `${date}T08:00:00.000Z`, seoTitle: '', seoDescription: '',
  sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p(`متن ${title}`)] } }], ...over,
});
const ITEMS = [
  item('yalda-night', 'شب یلدا در گالری', '2026-12-20', {
    cover: { sha256: SHA('a'), width: 1600, height: 1000, alt: 'ویترین یلدا', thumb: true },
    seoTitle: 'یلدا در پاپیتال', seoDescription: 'برنامهٔ شب یلدا در گالری.',
    sections: [
      { kind: 'text', background: 'dark', doc: { type: 'doc', content: [
        p('گالری در شب یلدا تا نیمه‌شب باز است.'),
        p('نشانی بیرونی', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
      ] } },
      { kind: 'gallery', background: 'white', title: 'عکس‌های پارسال', images: [{ sha256: SHA('b'), width: 800, height: 600, alt: 'میز یلدا', thumb: false }, { sha256: 'not-a-file', alt: 'x' }] },
      // a part a news item does not have: never drawn in one
      { kind: 'button', background: 'white', label: 'خرید کنید', href: '/products' },
      { kind: 'products', background: 'white', title: 'پیشنهادها', collection: '', products: ['tile-necklace-sample'] },
    ],
  }),
  item('new-collection', 'کالکشن تازه رسید', '2026-12-01', { summary: '' }),
  item('workshop-visit', 'بازدید از کارگاه', '2026-11-15'),
  item('opening-hours', 'ساعت کار تازه', '2026-11-01'),
  item('first-news', 'نخستین خبر <b>گالری</b>', '2026-10-10'),
];

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_NEWS: JSON.stringify({ enabled: true, pageSize: 2, items: ITEMS }) },
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
const ldBlocks = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(match => JSON.parse(match[1]) as Record<string, unknown>);

describe('the news of the site', () => {
  it('lists the newest items first, a page at a time, each with its day, summary and address', async () => {
    const first = await page('/news');
    expect(first.status).toBe(200);
    expect(first.html).toMatch(/<h1[^>]*>خبرها<\/h1>/);
    const list = first.html.slice(first.html.indexOf('data-news-list'));
    expect(list.indexOf('شب یلدا در گالری')).toBeGreaterThan(-1);
    expect(list.indexOf('شب یلدا در گالری')).toBeLessThan(list.indexOf('کالکشن تازه رسید'));
    expect(first.html).not.toContain('بازدید از کارگاه');
    expect(first.html).toContain('href="/news/yalda-night"');
    expect(first.html).toContain('خلاصهٔ شب یلدا در گالری');
    // the day is a day of the Persian calendar with its year, and a machine reads the same day
    expect(first.html).toMatch(/<time dateTime="2026-12-20">۲۹ آذر ۱۴۰۵<\/time>/);
    // the cover in the list is decoration beside the title: its small version for a small box, and no second name for the link
    expect(first.html).toContain(`/media/${SHA('a')}-thumb.webp 400w`);
    expect(first.html).toMatch(/<a[^>]*aria-hidden="true"[^>]*href="\/news\/yalda-night"|<a[^>]*href="\/news\/yalda-night"[^>]*aria-hidden="true"/);
    expect(first.html).toContain('<link rel="canonical" href="https://shop.example/news"/>');
    expect(first.html).toMatch(/<title>خبرها \| [^<]+<\/title>/);
    // plain links to the other pages
    expect(first.html).toContain('href="/news?page=2"');
    expect(first.html).toContain('href="/news?page=3"');

    const second = await page('/news?page=2');
    expect(second.status).toBe(200);
    expect(second.html).toContain('بازدید از کارگاه');
    expect(second.html).toContain('ساعت کار تازه');
    expect(second.html).not.toContain('شب یلدا در گالری');
    expect(second.html).toContain('<link rel="canonical" href="https://shop.example/news?page=2"/>');
    expect(second.html).toMatch(/<title>خبرها، صفحهٔ ۲ \| /);
    expect(second.html).toContain('href="/news"');
    // a title is text, never markup
    const third = await page('/news?page=3');
    expect(third.html).toContain('نخستین خبر &lt;b&gt;گالری&lt;/b&gt;');
    expect(third.html).not.toContain('<b>گالری</b>');
  });

  it('answers 404 past the last page and for an item that is not there', async () => {
    expect((await page('/news?page=4')).status).toBe(404);
    expect((await page('/news?page=999')).status).toBe(404);
    expect((await page('/news/no-such-item')).status).toBe(404);
    expect((await page('/news/Bad%20Address')).status).toBe(404);
    // a page number that is no number is the first page
    expect((await page('/news?page=abc')).status).toBe(200);
  });

  it('draws an item with its title, day, cover and text, keeping only the parts and marks a news item may have', async () => {
    const { status, html } = await page('/news/yalda-night');
    expect(status).toBe(200);
    const article = html.slice(html.indexOf('data-news-item="yalda-night"'));
    expect(article).toMatch(/<h1[^>]*>شب یلدا در گالری<\/h1>/);
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(article).toMatch(/<time dateTime="2026-12-20">۲۹ آذر ۱۴۰۵<\/time>/);
    expect(article).toContain(`src="/media/${SHA('a')}.webp"`);
    expect(article).toContain('alt="ویترین یلدا"');
    expect(article).toContain('گالری در شب یلدا تا نیمه‌شب باز است.');
    // the gallery's title is a heading under the item's own, and an image that is no file is left out
    expect(article).toMatch(/<h2[^>]*>عکس‌های پارسال<\/h2>/);
    expect(article).toContain(`/media/${SHA('b')}.webp`);
    expect(article).not.toContain('not-a-file');
    // the words of the bad link stay as words; nothing unsafe and no part of another kind is drawn
    expect(article).toContain('نشانی بیرونی');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.example');
    expect(article).not.toContain('خرید کنید');
    expect(article).not.toContain('پیشنهادها');
    expect(article).not.toContain('data-page-section="button"');
    expect(article).not.toContain('data-page-section="products"');
    // every part of an item is drawn on the site's own ground, whatever ground the answer names
    expect(article).not.toContain('data-tone="deep"');
    // the way back
    expect(article).toMatch(/<a[^>]*href="\/news"[^>]*>همهٔ خبرها<\/a>/);
    expect(html).toMatch(/<nav aria-label="مسیر"[^>]*>.*href="\/".*href="\/news"/s);
  });

  it('tells a search engine what the item is: its own search words, a canonical address, a social card and a NewsArticle', async () => {
    const { html } = await page('/news/yalda-night');
    expect(html).toMatch(/<title>یلدا در پاپیتال \| [^<]+<\/title>/);
    expect(html).toContain('<meta name="description" content="برنامهٔ شب یلدا در گالری."/>');
    expect(html).toContain('<link rel="canonical" href="https://shop.example/news/yalda-night"/>');
    expect(html).toContain(`<meta property="og:image" content="https://shop.example/media/${SHA('a')}.webp"/>`);
    expect(html).toContain('<meta property="og:type" content="article"/>');
    expect(html).toContain('<meta property="article:published_time" content="2026-12-20T00:00:00+03:30"/>');
    expect(html).not.toContain('name="robots" content="noindex"');
    const article = ldBlocks(html).find(block => block['@type'] === 'NewsArticle');
    expect(article).toMatchObject({
      headline: 'شب یلدا در گالری', description: 'برنامهٔ شب یلدا در گالری.', datePublished: '2026-12-20T00:00:00+03:30', dateModified: '2026-12-20T08:00:00.000Z',
      image: [`https://shop.example/media/${SHA('a')}.webp`], mainEntityOfPage: { '@id': 'https://shop.example/news/yalda-night' },
    });
    expect((article?.publisher as { name?: string }).name).toBeTruthy();
    const trail = ldBlocks(html).find(block => block['@type'] === 'BreadcrumbList') as { itemListElement: Array<{ name: string; item?: string }> };
    expect(trail.itemListElement.map(step => step.name)).toEqual(['خانه', 'خبرها', 'شب یلدا در گالری']);
    expect(trail.itemListElement[1].item).toBe('https://shop.example/news');

    // an item with no summary and no search words is described by the start of its text, and titled by its own title
    const plain = await page('/news/new-collection');
    expect(plain.html).toMatch(/<title>کالکشن تازه رسید \| /);
    expect(plain.html).toContain('<meta name="description" content="متن کالکشن تازه رسید"/>');
    // one with a summary and no search description is described by its summary
    expect((await page('/news/workshop-visit')).html).toContain('<meta name="description" content="خلاصهٔ بازدید از کارگاه"/>');
    // a title that carries markup is escaped inside the structured data too
    const odd = await page('/news/first-news');
    expect(odd.status).toBe(200);
    expect(odd.html).not.toContain('<b>گالری</b>');
  });

  it('lists the news and every item in the sitemap, each with the day it was published', async () => {
    const { status, html } = await page('/sitemap.xml');
    expect(status).toBe(200);
    expect(html).toContain('<url><loc>https://shop.example/news</loc></url>');
    expect(html).toContain('<url><loc>https://shop.example/news/yalda-night</loc><lastmod>2026-12-20</lastmod></url>');
    for (const { slug } of ITEMS) expect(html, slug).toContain(`<loc>https://shop.example/news/${slug}</loc>`);
  });
});

describe('an answer about news that is not what the site expects', () => {
  it('keeps only what it can draw of a list, and takes an answer in another shape as no answer', () => {
    expect(siteNewsList(null)).toBeNull();
    expect(siteNewsList({ data: [], total: 0, page: 1, pageSize: 12 })).toBeNull();
    expect(siteNewsList({ enabled: true, data: 'x', total: 0, page: 1, pageSize: 12 })).toBeNull();
    expect(siteNewsList({ enabled: true, data: [], total: -1, page: 1, pageSize: 12 })).toBeNull();
    expect(siteNewsList({ enabled: true, data: [], total: 3, page: 1, pageSize: 0 })).toBeNull();
    const list = siteNewsList({
      enabled: true, total: 6, page: 1, pageSize: 12,
      data: [
        { slug: 'good-one', title: ' خبر خوب ', summary: 'دو\nخط', date: '2026-11-23', cover: { sha256: SHA('c'), width: 10, height: 10, alt: 'a', thumb: false }, draft: { title: 'secret' }, id: 7 },
        { slug: 'Bad Slug', title: 'x', summary: '', date: '2026-11-23' },
        { slug: 'no-title', title: '   ', summary: '', date: '2026-11-23' },
        { slug: 'bad-day', title: 'x', summary: '', date: '23-11-2026' },
        { slug: 'no-day', title: 'x', summary: '' },
        { slug: 'bad-cover', title: 'عکس بد', summary: '', date: '2026-11-22', cover: { sha256: '../../etc/passwd' } },
        'not an item',
      ],
    });
    expect(list?.items.map(row => row.slug)).toEqual(['good-one', 'bad-cover']);
    // only the fields the site draws are kept
    expect(Object.keys(list!.items[0]).sort()).toEqual(['cover', 'date', 'slug', 'summary', 'title']);
    expect(list!.items[0]).toMatchObject({ title: 'خبر خوب', summary: 'دو خط' });
    expect(list!.items[1].cover).toBeNull();
  });

  it('takes an item that is no item as none, and reads the index a line at a time', () => {
    expect(siteNewsItem(null)).toBeNull();
    expect(siteNewsItem({ slug: 'x', title: 'x' })).toBeNull();
    expect(siteNewsItem({ slug: 'ok', title: 'خبر', summary: '', date: '2026-11-23', sections: 'x' })?.page.sections).toEqual([]);
    expect(siteNewsIndex('x')).toEqual([]);
    expect(siteNewsIndex([{ slug: 'a-b', updatedAt: '2026-11-23T08:00:00.000Z' }, { slug: 'no-time' }, { slug: 'Bad' }, 5, { slug: 'zoneless', updatedAt: '2026-11-23 08:00:00' }]))
      .toEqual([{ slug: 'a-b', lastmod: '2026-11-23' }, { slug: 'no-time', lastmod: '' }, { slug: 'zoneless', lastmod: '' }]);
  });
});
