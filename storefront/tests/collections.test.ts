// v12 phase 10e: the words the shop wrote for a collection («کالکشن‌های سایت» in the ERP) as a visitor's browser gets
// them above the collection's products, rendered on the server from the mock Storefront API. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { collectionDescription, siteCollectionTexts } from '../app/lib/collections';

const PORT = 3940;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const SHA = (letter: string) => letter.repeat(64);
const catalog = JSON.parse(readFileSync(path.join(import.meta.dirname, '../mock/sample/catalog.json'), 'utf8')) as { products: Array<{ collections: string[] }> };
const names = [...new Set(catalog.products.flatMap(product => product.collections))];
const [FIRST, SECOND] = names;
const TEXTS = [
  {
    name: FIRST, intro: 'نقش این کالکشن از کاشی‌های هفت‌رنگ آمده است.\n\nهر قطعه با دست <b>ساخته</b> می‌شود.\nو یک خط دیگر.',
    image: { sha256: SHA('d'), width: 1600, height: 900, alt: 'کاشی هفت‌رنگ', thumb: true }, moreHref: '/pages/about-tiles',
    // fields the ERP never sends: the site must not draw or keep them
    id: 7, updatedBy: 'owner-name-not-for-site',
  },
  // an image alone with its link, and a second answer for the same name
  { name: SECOND, intro: '', image: { sha256: SHA('e'), width: 800, height: 800, alt: '', thumb: false }, moreHref: '/pages/about-turquoise' },
  { name: SECOND, intro: 'پاسخ دوم برای همان نام', image: null, moreHref: '' },
];

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_COLLECTIONS: JSON.stringify(TEXTS) },
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
/** the part of the page drawn for the collection's words (the data the page carries for the browser comes after it) */
const introOf = (html: string) => {
  const start = html.indexOf('data-collection-intro');
  return start < 0 ? '' : html.slice(start, html.indexOf('aria-label="دسته‌ها"', start));
};
const collectionUrl = (name: string) => `/collections/${encodeURIComponent(name)}`;

describe('the words of a collection on its page', () => {
  it('draws the paragraphs, the image and the link above the products, as plain text', async () => {
    const { status, html } = await page(collectionUrl(FIRST));
    expect(status).toBe(200);
    const intro = introOf(html);
    expect(intro).toContain('نقش این کالکشن از کاشی‌های هفت‌رنگ آمده است.');
    expect(intro.match(/<p class="whitespace-pre-line/g)?.length).toBe(2);
    // markup in the text is text
    expect(intro).toContain('&lt;b&gt;ساخته&lt;/b&gt;');
    expect(intro).not.toContain('<b>');
    expect(intro).toContain(`src="/media/${SHA('d')}.webp"`);
    expect(intro).toContain(`/media/${SHA('d')}-thumb.webp 400w`);
    expect(intro).toContain('alt="کاشی هفت‌رنگ"');
    expect(intro).toMatch(/<a[^>]*href="\/pages\/about-tiles"[^>]*>آشنایی بیشتر<\/a>/);
    expect(html).toContain('<meta name="description" content="نقش این کالکشن از کاشی‌های هفت‌رنگ آمده است. هر قطعه با دست &lt;b&gt;ساخته&lt;/b&gt; می‌شود. و یک خط دیگر."');
    expect(html).toContain(`<meta property="og:image" content="https://shop.example/media/${SHA('d')}.webp"`);
    // what the ERP never meant for the site is not in the page at all, not even in the data it carries
    expect(html).not.toContain('owner-name-not-for-site');
  });

  it('draws an image alone with its link under it, and takes the first answer for a name', async () => {
    const { status, html } = await page(collectionUrl(SECOND));
    expect(status).toBe(200);
    const intro = introOf(html);
    expect(intro).toContain(`src="/media/${SHA('e')}.webp"`);
    expect(intro).not.toContain('srcSet');
    // no text to sit under: the link is drawn under the image
    expect(intro).not.toContain('whitespace-pre-line');
    expect(intro).toMatch(/<a[^>]*href="\/pages\/about-turquoise"[^>]*>آشنایی بیشتر<\/a>/);
    expect(intro.indexOf('آشنایی بیشتر')).toBeGreaterThan(intro.indexOf('<img'));
    expect(html).not.toContain('پاسخ دوم برای همان نام');
  });

  it('keeps the words to the collection page itself: not a category inside it, a later page or the list of all products', async () => {
    const category = catalog.products.find(product => product.collections.includes(FIRST)) as unknown as { category: string };
    for (const pathname of [`${collectionUrl(FIRST)}?category=${encodeURIComponent(category.category)}`, `${collectionUrl(FIRST)}?page=2`, `${collectionUrl(FIRST)}?q=${encodeURIComponent(FIRST)}`, '/products']) {
      const { status, html } = await page(pathname);
      expect(status, pathname).toBe(200);
      expect(html, pathname).not.toContain('data-collection-intro');
      expect(html, pathname).not.toContain('کاشی‌های هفت‌رنگ');
    }
  });
});

describe('the answer of the Storefront API for the words of the collections', () => {
  it('rebuilds each from what the site draws and drops what shows nothing', () => {
    const turn = String.fromCharCode(0x202e);
    const texts = siteCollectionTexts([
      { name: 'a', intro: `one${turn}two\r\n\r\n\r\n  three  \n\n \n`, image: { sha256: 'short' }, moreHref: '/pages/Not-A-Slug' },
      { name: 'b', intro: '   ', image: null, moreHref: '/pages/x' },
      // a link is only ever a page of this site
      { name: 'd', intro: 'd', image: null, moreHref: 'https://evil.example/pages/x' },
      { name: 'e', intro: 'e', image: null, moreHref: '/pages/x/../../account' },
      { name: 'f', intro: 'f', image: null, moreHref: '/pages/story' },
      { name: '', intro: 'no name', image: null },
      { name: 'c', intro: 7, image: { sha256: SHA('f'), width: -1, height: 'x', alt: 5 }, moreHref: '//evil.example' },
      'not a row', null,
    ]);
    expect([...texts.keys()]).toEqual(['a', 'd', 'e', 'f', 'c']);
    expect(['d', 'e', 'f'].map(name => texts.get(name)?.moreHref)).toEqual(['', '', '/pages/story']);
    expect(texts.get('a')).toEqual({ name: 'a', paragraphs: ['onetwo', 'three'], image: null, moreHref: '' });
    expect(texts.get('c')).toEqual({ name: 'c', paragraphs: [], image: { sha256: SHA('f'), width: null, height: null, alt: '', thumb: false }, moreHref: '' });
    expect(siteCollectionTexts({ data: [] }).size).toBe(0);
    expect(siteCollectionTexts(null).size).toBe(0);
  });

  it('cuts a long introduction to a description of one line', () => {
    const long = siteCollectionTexts([{ name: 'a', intro: `${'واژه '.repeat(60)}\n\nبند دوم`, image: null }]).get('a') ?? null;
    const description = collectionDescription(long);
    expect([...description].length).toBeLessThanOrEqual(160);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toContain('\n');
    expect(collectionDescription(null)).toBe('');
  });
});
