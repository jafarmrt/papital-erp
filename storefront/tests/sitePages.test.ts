// v12 phase 10c: the pages of the ERP's «صفحه‌های سایت» on the site, as a browser without JavaScript gets them, against the
// mock Storefront API (MOCK_PAGES). Run `npm run build` first. Before 10c the site had no `/pages/<address>` at all and
// the five base pages could only show the text fixed in the site's code.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { lastModOf, pageDescription, sitePage, sitePageList } from '../app/lib/pages';

const PORT = 3930;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const image = (sha256: string, alt: string, thumb = true) => ({ sha256, width: 1600, height: 1000, alt, thumb });
const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

const STORY = {
  slug: 'our-story', kind: 'custom', title: 'داستان ما', noindex: false, updatedAt: '2026-11-20T08:30:00.000Z',
  seoTitle: 'داستان کارگاه', seoDescription: '', shareImage: null,
  sections: [
    { kind: 'hero', background: 'brand', title: 'از کاشی تا زیور', text: 'کارگاهی کوچک در تهران.\nهر قطعه با دست.', image: image(A, ''), buttonLabel: 'دیدن محصولات', buttonHref: '/products' },
    {
      kind: 'text', background: 'white',
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'چرا کاشی؟' }] },
          p('<script>alert(1)</script> & "نقل"'),
          p('پیوند درون سایت', [{ type: 'link', attrs: { href: '/contact' } }]),
          p('پیوند بیرون', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.org/a?b=1' } }]),
          p('پیوند بد', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
          p('رنگی', [{ type: 'textColor', attrs: { color: 'accent' } }, { type: 'italic' }, { type: 'underline' }]),
          p('رنگ ناشناخته', [{ type: 'textColor', attrs: { color: 'red;background:url(//evil.example)' } }]),
          { type: 'bulletList', content: [{ type: 'listItem', content: [p('گزینهٔ یک'), { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p('گزینهٔ سه')] }] }] }] },
          { type: 'blockquote', content: [p('گفته‌ای از کارگاه')] },
          { type: 'horizontalRule' },
          { type: 'libraryImage', attrs: { sha256: B, width: 800, height: 600, alt: 'میز کار', thumb: 1 } },
          { type: 'libraryImage', attrs: { sha256: '../../etc/passwd', alt: 'نام بد' } },
          { type: 'table', content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('اندازه')] }, { type: 'tableHeader', content: [p('وزن')] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('کوچک')] }, { type: 'tableCell', content: [p('۵ گرم')] }] },
          ] },
          { type: 'iframe', attrs: { src: 'https://evil.example' } },
          { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'https://evil.example/x.png' } }, { type: 'hardBreak' }, { type: 'text', text: 'پس از خط تازه' }] },
        ],
      },
    },
    { kind: 'textImage', background: 'cream', title: 'ساخت دست', doc: { type: 'doc', content: [p('متن کنار عکس')] }, image: image(B, 'دست و قلم'), imageSide: 'left', buttonLabel: 'تماس', buttonHref: 'https://example.org/contact' },
    { kind: 'iconCards', background: 'white', title: 'چرا ما', cards: [{ icon: 'leaf', title: 'طبیعی', text: 'رنگ‌های پایدار' }, { icon: 'truck', title: 'ارسال', text: 'به همه‌جا' }, { icon: 'skull', title: 'ناشناخته', text: '' }] },
    { kind: 'gallery', background: 'white', title: 'گالری', images: [image(A, 'یک'), image(C, 'دو', false), { sha256: 'nope', alt: 'بد' }] },
    { kind: 'people', background: 'dark', title: 'همکاران', people: [{ image: image(C, ''), name: 'سارا', role: 'طراح', contact: 'sara@shop.example' }, { image: null, name: '', role: 'بی نام', contact: '' }] },
    { kind: 'map', background: 'white', title: 'نشانی ما', image: null, address: 'تهران، خیابان نمونه', neshanUrl: 'https://nshn.ir/abc', baladUrl: 'javascript:alert(2)', googleUrl: 'https://maps.app.goo.gl/xyz' },
    { kind: 'products', background: 'white', title: 'برگزیده‌ها', collection: 'شاه‌عباسی', products: ['tile-necklace-sample', 'no-such-product'] },
    { kind: 'products', background: 'white', title: 'ردیف خالی', collection: '', products: ['no-such-product'] },
    { kind: 'button', background: 'white', label: 'سفارش عمده', href: '/wholesale' },
    { kind: 'button', background: 'white', label: 'دکمهٔ بد', href: '//evil.example' },
    { kind: 'shippingMethods', background: 'white', title: '' },
    { kind: 'embed', background: 'white', html: '<script>alert(3)</script>' },
  ],
};
const ABOUT = {
  slug: 'about', kind: 'base', title: 'درباره ما', noindex: false, updatedAt: '2026-11-19T10:00:00.000Z', seoTitle: '', seoDescription: 'کارگاه نمونه از سال ۱۳۹۵.',
  shareImage: image(C, 'کارت'), sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('متن تازهٔ درباره ما از ERP')] } }],
};
const HIDDEN = { slug: 'staff-notes', kind: 'custom', title: 'یادداشت همکاران', noindex: true, updatedAt: '2026-11-18T10:00:00.000Z', seoTitle: '', seoDescription: '', shareImage: null, sections: [{ kind: 'hero', background: 'white', title: 'یادداشت', text: '', image: null, buttonLabel: '', buttonHref: '' }] };
const DEEP = {
  slug: 'deep-text', kind: 'custom', title: 'متن روی زمینهٔ تیره', noindex: true, updatedAt: '2026-11-18T10:00:00.000Z', seoTitle: '', seoDescription: '', shareImage: null,
  sections: [
    { kind: 'text', background: 'brand', doc: { type: 'doc', content: [{ type: 'paragraph', content: ['muted', 'brand', 'accent'].map((color, i) => ({ type: 'text', text: ['خاکستری', 'لاجوردی', 'آبی'][i], marks: [{ type: 'textColor', attrs: { color } }] })) }] } },
    { kind: 'products', background: 'dark', title: 'برگزیده‌ها', collection: '', products: ['tile-necklace-sample'] },
    { kind: 'shippingMethods', background: 'dark', title: 'ارسال' },
  ],
};
const TERMS = { slug: 'terms', kind: 'base', title: 'قوانین خرید', noindex: true, updatedAt: '2026-11-18T10:00:00.000Z', seoTitle: '', seoDescription: '', shareImage: null, sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('قوانین تازه')] } }] };
// 10c review: shapes only a broken or hostile ERP would send; the page must still be drawn, never a 500
const nested = (levels: number): unknown => (levels === 0 ? p('ته') : { type: 'blockquote', content: [nested(levels - 1)] });
const BROKEN = {
  slug: 'broken-shapes', kind: 'custom', title: 'شکل‌های خراب', noindex: true, updatedAt: '2026-11-18 10:00:00.000', seoTitle: '', seoDescription: '', shareImage: null,
  sections: [
    { kind: 'text', background: 'white', doc: { type: 'doc', content: [null, 7, 'x', nested(200), p('پس از تودرتو'), { type: 'paragraph', content: [{ type: 'text', text: 'بی‌قالب', marks: [null, 'x', { type: 'link', attrs: { href: '/a\u202eb' } }] }], onclick: 'alert(9)' }] } },
    { kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'iframe' }, { type: 'paragraph' }, p('\u200c')] } },
    { kind: 'hero', background: 'white', title: '\u200c\u200c', text: 'متن سربرگ\u0000 با نویسهٔ کنترلی\u202e', image: null, buttonLabel: '', buttonHref: '' },
    { kind: 'products', background: 'white', title: 'کارت با فیلد اضافه', collection: '', products: ['tile-necklace-sample'], secret: 'leak-me-section' },
  ],
};
// a "base" page with an address the site has no place for, and a custom page that names a base address
const STRAY = { ...HIDDEN, slug: 'returns', kind: 'base', title: 'صفحهٔ پایهٔ ناشناخته', noindex: false };

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '1', MOCK_PAGES: JSON.stringify([STORY, ABOUT, HIDDEN, TERMS, STRAY, DEEP, BROKEN]) },
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

const get = async (pathname: string) => {
  const res = await handle(new Request(`http://localhost${pathname}`));
  return { status: res.status, html: await res.text() };
};
/** the page between the header and the footer: the sections the ERP wrote */
const mainOf = (html: string) => html.slice(html.indexOf('data-site-page='), html.indexOf('<footer'));
const sectionOf = (html: string, kind: string, nth = 0) => mainOf(html).split('data-page-section="').filter(part => part.startsWith(`${kind}"`))[nth] ?? '';

describe('a page the shop made, at /pages/<its address>', () => {
  it('is a page with one heading, its own title, description and social card', async () => {
    const { status, html } = await get('/pages/our-story');
    expect(status).toBe(200);
    expect(html).toContain('<title>داستان کارگاه | گالری پاپیتال</title>');
    // no description was written, so the page's first words are its description
    expect(html).toContain('<meta name="description" content="کارگاهی کوچک در تهران. هر قطعه با دست."/>');
    expect(html).toContain('<link rel="canonical" href="https://shop.example/pages/our-story"/>');
    expect(html).toContain(`<meta property="og:image" content="https://shop.example/media/${A}.webp"/>`);
    expect(html).not.toContain('name="robots" content="noindex"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>از کاشی تا زیور<\/h1>/);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it('draws each kind of section, in the order of the ERP, on the ground chosen there', async () => {
    const main = mainOf((await get('/pages/our-story')).html);
    const kinds = [...main.matchAll(/data-page-section="([a-zA-Z]+)"/g)].map(m => m[1]);
    // the row with no product on the site, the button with a bad address and the unknown kind are not drawn
    expect(kinds).toEqual(['hero', 'text', 'textImage', 'iconCards', 'gallery', 'people', 'map', 'products', 'button', 'shippingMethods']);
    expect(sectionOf(main, 'hero')).toContain('data-tone="deep"');
    expect(sectionOf(main, 'hero')).toContain('bg-brand ');
    expect(sectionOf(main, 'textImage')).toContain('bg-brand-soft');
    expect(sectionOf(main, 'people')).toContain('bg-primary');
    // the hero: the image is the page's first, so it loads at once; the button stays in the app
    expect(sectionOf(main, 'hero')).toMatch(new RegExp(`<img[^>]*src="/media/${A}\\.webp"[^>]*loading="eager"`));
    expect(sectionOf(main, 'hero')).toMatch(/<a[^>]*href="\/products"[^>]*>دیدن محصولات<\/a>/);
    // text and image: the image on the left is the second column; an outside button tells the other site nothing
    expect(sectionOf(main, 'textImage')).toContain('lg:order-last');
    expect(sectionOf(main, 'textImage')).toContain('alt="دست و قلم"');
    expect(sectionOf(main, 'textImage')).toMatch(/<a href="https:\/\/example\.org\/contact" rel="noopener noreferrer"[^>]*>تماس<\/a>/);
    // cards: the unknown icon's card is left out
    expect(sectionOf(main, 'iconCards')).toContain('طبیعی');
    expect(sectionOf(main, 'iconCards')).not.toContain('ناشناخته');
    expect(sectionOf(main, 'iconCards').match(/<li/g)).toHaveLength(2);
    // gallery: two real images; the one without a small version has no srcset
    expect(sectionOf(main, 'gallery').match(/<img/g)).toHaveLength(2);
    expect(sectionOf(main, 'gallery')).toMatch(new RegExp(`srcSet="/media/${A}-thumb\\.webp 400w, /media/${A}\\.webp 1600w"`));
    expect(sectionOf(main, 'gallery')).not.toContain(`${C}-thumb`);
    // people: the card without a name is left out
    expect(sectionOf(main, 'people').match(/<li/g)).toHaveLength(1);
    expect(sectionOf(main, 'people')).toContain('sara@shop.example');
    // map: the two good addresses are links; the bad one is not there
    expect(sectionOf(main, 'map')).toContain('href="https://nshn.ir/abc"');
    expect(sectionOf(main, 'map')).toContain('href="https://maps.app.goo.gl/xyz"');
    expect(sectionOf(main, 'map')).not.toContain('بلد');
    // products: the card of the item on the site, and the way to the rest of the collection
    expect(sectionOf(main, 'products')).toContain('href="/p/tile-necklace-sample"');
    expect(sectionOf(main, 'products')).toContain(`href="/collections/${encodeURIComponent('شاه‌عباسی')}"`);
    expect(sectionOf(main, 'products')).toContain('همهٔ محصولات کالکشن شاه‌عباسی');
    expect(main).not.toContain('ردیف خالی');
    expect(sectionOf(main, 'button')).toMatch(/<a[^>]*href="\/wholesale"[^>]*>سفارش عمده<\/a>/);
    expect(main).not.toContain('دکمهٔ بد');
    // the live shipping methods of the ERP's settings, under a title of the site's own when none was written
    expect(sectionOf(main, 'shippingMethods')).toContain('روش‌های ارسال');
    expect(sectionOf(main, 'shippingMethods')).toContain('پست پیشتاز');
  });

  it('draws a text node by node: what was typed is shown as letters, and nothing outside the known nodes becomes an element', async () => {
    const { html } = await get('/pages/our-story');
    const text = sectionOf(html, 'text');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;نقل&quot;');
    expect(text).toMatch(/<h2 style="text-align:center"[^>]*>.*چرا کاشی؟/);
    expect(text).toMatch(/<a[^>]*href="\/contact"[^>]*>پیوند درون سایت<\/a>/);
    expect(text).toMatch(/<a href="https:\/\/example\.org\/a\?b=1" rel="noopener noreferrer"[^>]*><strong>پیوند بیرون<\/strong><\/a>/);
    expect(text).toContain('پیوند بد');
    expect(text).toMatch(/<span class="text-accent-ink[^"]*"><u><em>رنگی<\/em><\/u><\/span>|<u><em><span class="text-accent-ink[^"]*">رنگی/);
    expect(text).toContain('رنگ ناشناخته');
    expect(text).toMatch(/<ol start="3"/);
    expect(text).toContain('<blockquote');
    expect(text).toContain('<hr');
    expect(text).toMatch(new RegExp(`<img src="/media/${B}\\.webp" alt="میز کار" width="800" height="600"`));
    expect(text).toMatch(/<th class="[^"]*"><p>.*اندازه/);
    expect(text).toContain('<br/>');
    expect(text).toContain('پس از خط تازه');
    // none of the hostile parts reached the page, as an element or as an attribute
    const main = mainOf(html);
    for (const bad of ['javascript:', 'evil.example', '<iframe', 'etc/passwd', 'نام بد', 'background:url', 'alert(3)', '<script>alert']) expect(main, bad).not.toContain(bad);
  });

  // by class only: a real browser is not part of this suite (the layout was measured by hand in Chrome at 360 px, PR #490)
  it('gives every part the classes that keep it inside a narrow phone: an image shrinks, a long word breaks, a table scrolls in its own box', async () => {
    const main = mainOf((await get('/pages/our-story')).html);
    const images = main.match(/<img[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(5);
    for (const img of images) expect(img, img).toMatch(/class="[^"]*(max-w-full|w-full)/);
    expect(main).toMatch(/<div class="max-w-full overflow-x-auto[^"]*"[^>]*><table/);
    for (const kind of ['text', 'textImage']) expect(sectionOf(main, kind), kind).toContain('break-words');
    // a button's long label breaks too (10c review: 40 unbroken letters pushed the page 24 px wide)
    for (const kind of ['hero', 'button']) expect(sectionOf(main, kind), kind).toMatch(/<a[^>]*class="[^"]*max-w-full[^"]*wrap-anywhere/);
    // grids start as one column (two for the gallery) and widen only from a breakpoint up
    expect(sectionOf(main, 'iconCards')).toMatch(/class="grid gap-4 sm:grid-cols-2/);
    expect(sectionOf(main, 'gallery')).toContain('grid grid-cols-2 gap-3 sm:grid-cols-3');
    expect(sectionOf(main, 'hero')).toContain('lg:grid-cols-2');
    expect(main).not.toMatch(/class="[^"]*\b(w-\[\d+px\]|min-w-\[\d+px\]|w-screen)\b/);
  });

  it('is not in a search engine when the ERP says so, and is the same 404 as any address when it is not published', async () => {
    const hidden = await get('/pages/staff-notes');
    expect(hidden.status).toBe(200);
    expect(hidden.html).toContain('<meta name="robots" content="noindex"/>');
    expect((await get('/pages/no-such-page')).status).toBe(404);
    expect((await get('/pages/Our-Story')).status).toBe(404);
    // a base page has one address, its own
    expect((await get('/pages/about')).status).toBe(404);
    expect((await get('/pages/returns')).status).toBe(404);
  });
});

describe('a text on a deep ground', () => {
  it('gives each colour a class that is read there: grey takes the ground\'s light text, the two blues a light one', async () => {
    const { html } = await get('/pages/deep-text');
    const main = mainOf(html);
    expect(sectionOf(main, 'text')).toContain('data-tone="deep"');
    // 10c review: grey was the dark grey of a white page, dimmed, on cobalt (1.01 to 1)
    expect(main).toMatch(/<span class="text-muted-foreground in-data-\[tone=deep\]:text-inherit in-data-\[tone=deep\]:opacity-75">خاکستری<\/span>/);
    expect(main).toMatch(/<span class="text-brand in-data-\[tone=deep\]:text-accent-light">لاجوردی<\/span>/);
    expect(main).toMatch(/<span class="text-accent-ink in-data-\[tone=deep\]:text-accent-light">آبی<\/span>/);
    // the white card of a product row inside a deep section is light again (the focus ring follows it)
    expect(sectionOf(main, 'products')).toMatch(/data-tone="deep".*<div data-tone="light" class="rounded-surface bg-background/s);
    // the shipping list is a white card: its words are the card's dark text
    expect(sectionOf(main, 'shippingMethods')).toMatch(/<ul class="[^"]*bg-card text-foreground"/);
  });
});

describe('an answer of the ERP in a broken shape', () => {
  it('still draws the page: what cannot be read is left out, a text is cut at a depth, and nothing unknown rides along to the browser', async () => {
    const { status, html } = await get('/pages/broken-shapes');
    expect(status).toBe(200);
    const main = mainOf(html);
    expect(main).toContain('پس از تودرتو');
    expect(main).toContain('بی‌قالب');
    // nested 200 deep: drawn to the depth the site allows and no deeper
    expect((main.match(/<blockquote/g) ?? []).length).toBeLessThan(20);
    // the text whose nodes are all unknown or empty is no band at all, and the title of only joiners is no heading
    expect(main.match(/data-page-section="text"/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>شکل‌های خراب<\/h1>/);
    // control characters and the characters that turn a line over are gone, in the page and in its description
    expect(html).toContain('متن سربرگ با نویسهٔ کنترلی');
    expect(html).not.toMatch(/[\u0000\u202e]/);
    expect(main).not.toMatch(/<a[^>]*>بی‌قالب/);
    // a time without a zone is no time (it would be read in the zone of wherever the site runs)
    expect((await get('/sitemap.xml')).html).not.toContain('broken-shapes');
    // nothing but the known fields reaches the page's data
    for (const stray of ['leak-me', 'onclick', 'alert(9)', 'itemId', 'sortOrder']) expect(html, stray).not.toContain(stray);
  });
});

describe('a base page the owner published', () => {
  it('shows the copy of the ERP at its own address; a base page not published keeps the text the site had', async () => {
    const about = await get('/about');
    expect(about.status).toBe(200);
    expect(about.html).toContain('متن تازهٔ درباره ما از ERP');
    expect(about.html).not.toContain('پاپیتال کارگاهی در تهران است');
    expect(about.html).not.toContain('متن این صفحه پیش‌نویس است');
    // no section has a title, so the page's own title is its one heading
    expect(about.html.match(/<h1/g)).toHaveLength(1);
    expect(about.html).toMatch(/<h1[^>]*>درباره ما<\/h1>/);
    expect(about.html).toContain('<title>درباره ما | گالری پاپیتال</title>');
    expect(about.html).toContain('<meta name="description" content="کارگاه نمونه از سال ۱۳۹۵."/>');
    expect(about.html).toContain('<link rel="canonical" href="https://shop.example/about"/>');
    expect(about.html).toContain(`<meta property="og:image" content="https://shop.example/media/${C}.webp"/>`);
    const contact = await get('/contact');
    expect(contact.status).toBe(200);
    expect(contact.html).toContain('برای پرسش دربارهٔ محصولات، پیگیری سفارش');
    expect(contact.html).not.toContain('data-site-page');
  });
});

describe('the sitemap', () => {
  it('lists the published pages with the day each was published, and leaves out a page kept from search engines', async () => {
    const { status, html: xml } = await get('/sitemap.xml');
    expect(status).toBe(200);
    expect(xml).toContain('<url><loc>https://shop.example/pages/our-story</loc><lastmod>2026-11-20</lastmod></url>');
    expect(xml).toContain('<url><loc>https://shop.example/about</loc><lastmod>2026-11-19</lastmod></url>');
    expect(xml).toContain('<url><loc>https://shop.example/contact</loc></url>');
    expect(xml).not.toContain('staff-notes');
    expect(xml).not.toContain('https://shop.example/terms<');
    expect(xml).not.toContain('returns');
  });
});

describe('the ERP\'s answer as the site takes it', () => {
  it('takes a page only in its shape and drops what it does not know', () => {
    expect(sitePage(null)).toBeNull();
    expect(sitePage({ ...STORY, slug: '../admin' })).toBeNull();
    expect(sitePage({ ...STORY, title: '   ' })).toBeNull();
    expect(sitePage({ ...STORY, slug: 'returns', kind: 'base' })).toBeNull();
    const page = sitePage({ ...STORY, sections: [{ kind: 'hero', background: 'neon', title: 7, text: 'x', image: { sha256: 'zz' }, buttonLabel: 'b', buttonHref: 'http://plain.example' }, 'text', null] });
    expect(page?.sections).toEqual([{ kind: 'hero', background: 'white', title: '', text: 'x', image: null, buttonLabel: 'b', buttonHref: '' }]);
    expect(sitePage({ ...STORY, sections: 'none' })?.sections).toEqual([]);
    expect(sitePageList([STORY, { slug: 'x y' }, 5, ABOUT]).map(s => s.slug)).toEqual(['our-story', 'about']);
    expect(sitePageList({ data: [] })).toEqual([]);
    // a text is rebuilt from the known fields: an unknown attribute, mark or key is not kept, and 300,000 nodes are cut to a size
    const rebuilt = sitePage({ ...STORY, sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', extra: 1, content: [
      { type: 'paragraph', attrs: { textAlign: 'center', style: 'color:red', onclick: 'x' }, onerror: 'y', content: [{ type: 'text', text: 'متن', marks: [{ type: 'code' }, { type: 'bold', attrs: { x: 1 } }], secret: 1 }] },
      { type: 'libraryImage', attrs: { sha256: A, width: 10, height: 10, alt: 'a', thumb: 1, onerror: 'alert(1)' } },
    ] } }] });
    expect(rebuilt?.sections[0]).toEqual({ kind: 'text', background: 'white', doc: { type: 'doc', content: [
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'متن', marks: [{ type: 'bold' }] }] },
      { type: 'libraryImage', attrs: { sha256: A, width: 10, height: 10, alt: 'a', thumb: 1 } },
    ] } });
    // 100,000 deep (built in a loop; no ERP could even write it as JSON): cut at the site's depth, with no overflow of the stack
    let deep: unknown = p('ته');
    for (let i = 0; i < 100_000; i++) deep = { type: 'blockquote', content: [deep] };
    const cut = sitePage({ ...ABOUT, seoDescription: '', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [deep] } }] });
    expect(JSON.stringify(cut).match(/blockquote/g)?.length).toBeLessThan(20);
    expect(pageDescription(cut!)).toBe('درباره ما');
    const huge = sitePage({ ...STORY, sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: Array.from({ length: 300_000 }, () => p('x')) } }] });
    const kept = huge?.sections[0];
    expect(kept?.kind === 'text' && kept.doc.content.length).toBeLessThanOrEqual(2000);
  });

  it('writes a description from the page\'s own words and a day from its time', () => {
    const long = sitePage({ ...ABOUT, seoDescription: '', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [p('کلمه '.repeat(100))] } }] });
    expect(pageDescription(long!).length).toBeLessThanOrEqual(200);
    expect(pageDescription(long!).endsWith('…')).toBe(true);
    expect(pageDescription(sitePage({ ...ABOUT, seoDescription: '', sections: [] })!)).toBe('درباره ما');
    expect(lastModOf('2026-11-20T23:30:00.000+03:30')).toBe('2026-11-20');
    expect(lastModOf('2026-11-20T23:30:00.000Z')).toBe('2026-11-20');
    // 10c review: a time without its zone gave another day on a server in Tehran than on one in UTC
    expect(lastModOf('2026-11-22 01:00:00.000')).toBe('');
    expect(lastModOf('2026-11-22T01:00:00.000')).toBe('');
    expect(sitePage({ ...ABOUT, updatedAt: '2026-11-22 01:00:00.000' })?.updatedAt).toBe('');
    // the pieces of one paragraph run together: «توجه، این» and not «توجه ، این»
    const marked = sitePage({ ...ABOUT, seoDescription: '', sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'توجه', marks: [{ type: 'bold' }] }, { type: 'text', text: '، این متن است.' }] }, p('پاراگراف دوم')] } }] });
    expect(pageDescription(marked!)).toBe('توجه، این متن است. پاراگراف دوم');
    expect(lastModOf('yesterday')).toBe('');
    expect(lastModOf('')).toBe('');
  });
});
