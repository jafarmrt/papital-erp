// v12 phase 10e: «صفحهٔ اصلی» as the shop wrote and published it in the ERP, rendered on the server from the mock
// Storefront API: the slider and the banner, the parts of the site's own home page with the shop's words, the
// collection, the news, and what the site refuses to draw. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { homeNeeds, siteHome, siteHomeSections, todayHome } from '../app/lib/home';

const PORT = 3942;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const SHA = (letter: string) => letter.repeat(64);
const image = (letter: string, alt: string, width = 1600, height = 600) => ({ sha256: SHA(letter), width, height, alt, thumb: false });
const text = (words: string) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'از کارگاه' }] }, { type: 'paragraph', content: [{ type: 'text', text: words }] }] } });
const HOME = {
  seoTitle: 'زیور کاشی دست‌ساز', seoDescription: 'توضیح صفحهٔ اصلی که فروشگاه نوشته است.', shareImage: image('9', 'تصویر اشتراک'), updatedAt: '2026-11-24T08:00:00.000Z',
  // a field the ERP never sends: the site must not keep it
  editor: 'owner-name-not-for-site',
  sections: [
    {
      kind: 'slider',
      slides: [
        { image: image('a', 'کاشی آبی'), mobileImage: image('b', 'کاشی آبی', 800, 1000), title: 'کالکشن <b>تازه</b>', text: 'متن اسلاید نخست', buttonLabel: 'دیدن محصول', href: '/p/tile-necklace-sample', external: false },
        { image: image('c', 'کارگاه'), mobileImage: null, title: 'اسلاید دوم', text: '', buttonLabel: 'اینستاگرام', href: 'https://example.com/papital', external: true },
        // an address that is no address, an outside address not marked as one, and a path marked as outside: each slide stays without its button
        { image: image('d', 'سه'), mobileImage: null, title: 'اسلاید سوم', text: '', buttonLabel: 'دکمهٔ بد', href: 'javascript:alert(1)', external: false },
        { image: image('e', 'چهار'), mobileImage: null, title: 'اسلاید چهارم', text: '', buttonLabel: 'دکمهٔ بیرونی پنهان', href: 'https://evil.example/x', external: false },
        { image: { sha256: 'not-a-file' }, title: 'اسلاید بی‌عکس', buttonLabel: '', href: '', external: false },
      ],
    },
    { kind: 'banner', image: image('f', 'بنر یلدا'), mobileImage: null, href: '/collections/x', external: false },
    { kind: 'banner', image: image('1', 'بنر بی‌پیوند'), mobileImage: null, href: '//evil.example', external: false },
    { kind: 'homeIntro', kicker: 'خط بالا', title: 'تیتر سربرگ فروشگاه', text: 'متن سربرگ', buttonLabel: 'همه', buttonHref: '/products' },
    { kind: 'homeCategories', title: 'دسته‌های ما' },
    { kind: 'homeWhy', points: [{ icon: 'hand', text: 'ساخت دست' }, { icon: 'truck', text: '' }, { icon: 'leaf', text: '' }, { icon: 'skull', text: 'ناشناخته' }] },
    { kind: 'homeFeatured', title: 'پرفروش‌ها', buttonLabel: 'همهٔ پرفروش‌ها', buttonHref: '/products?sort=newest' },
    text('متنی که فروشگاه میان بخش‌ها نوشته است.'),
    { kind: 'collectionIntro', background: 'cream', title: '', collection: 'نمونه', intro: 'بند یک کالکشن.\n\nبند <i>دو</i>.', image: image('2', 'عکس کالکشن'), moreHref: '/pages/story', products: ['tile-necklace-sample', 'tile-earrings-sample', 'gift-set-sample'] },
    { kind: 'collectionIntro', background: 'white', title: 'بی‌محصول', collection: 'خالی', intro: 'x', image: null, moreHref: '', products: [] },
    { kind: 'latestNews', background: 'white', title: 'خبرهای کارگاه', items: [{ slug: 'first-news', title: 'خبر نخست', summary: 'خلاصهٔ خبر', date: '2026-11-20', cover: image('3', '') }, { slug: 'Bad Slug', title: 'خبر بد', summary: '', date: '2026-11-20', cover: null }] },
    { kind: 'homeWholesale', title: 'همکاری', text: 'متن همکاری', buttonLabel: 'درخواست', buttonHref: '/wholesale', secondLabel: 'نیمه', secondHref: '' },
    { kind: 'shippingMethods', background: 'white', title: 'ارسال' },
    { kind: 'evil-part', html: '<script>alert(1)</script>' },
  ],
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_HOME: JSON.stringify(HOME), MOCK_CAMPAIGNS: '0' },
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

let html = '';
/** the page as drawn, without the data it carries for the browser after it */
const drawn = () => html.slice(0, html.indexOf('window.__reactRouterContext'));
const partOf = (kind: string, nth = 0) => {
  const marks = [...drawn().matchAll(/data-home-part="([^"]+)"/g)];
  const mine = marks.filter(mark => mark[1] === kind)[nth];
  if (!mine) return '';
  const next = marks[marks.indexOf(mine) + 1];
  return drawn().slice(mine.index, next ? next.index : undefined);
};

describe('the home page the shop published', () => {
  it('draws the parts in the shop\'s order and leaves out what it does not know', async () => {
    const res = await handle(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    html = await res.text();
    expect([...drawn().matchAll(/data-home-part="([^"]+)"/g)].map(mark => mark[1])).toEqual([
      'slider', 'banner', 'banner', 'homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'page', 'collectionIntro', 'latestNews', 'homeWholesale',
    ]);
    for (const gone of ['evil-part', 'alert(1)', 'owner-name-not-for-site', 'بی‌محصول', 'اسلاید بی‌عکس', 'خبر بد', 'evil.example', 'javascript:']) expect(html, gone).not.toContain(gone);
    // the table of delivery methods is not a part of the home page
    expect(drawn()).not.toContain('data-page-section="shippingMethods"');
  });

  it('has one heading of the page, the first slide\'s title, drawn as text', () => {
    const headings = [...drawn().matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map(match => match[1]);
    expect(headings).toEqual(['کالکشن &lt;b&gt;تازه&lt;/b&gt;']);
    // the opening words come after the slider, so their title is a heading of the second level
    expect(partOf('homeIntro')).toMatch(/<h2[^>]*>تیتر سربرگ فروشگاه<\/h2>/);
  });

  it('draws the slider: the first image early, the phone\'s own crop, buttons only where the address is one', () => {
    const slider = partOf('slider');
    expect(slider.match(/aria-roledescription="slide"/g)?.length).toBe(4);
    expect(slider).toContain(`<source media="(max-width: 639px)" srcSet="/media/${SHA('b')}.webp" width="800" height="1000"/>`);
    expect(slider).toMatch(new RegExp(`<img src="/media/${SHA('a')}.webp" alt="کاشی آبی" width="1600" height="600" loading="eager" fetchPriority="high"`));
    expect(slider).toMatch(new RegExp(`<img src="/media/${SHA('c')}.webp" alt="کارگاه" width="1600" height="600" loading="lazy"`));
    expect(slider).toMatch(/<a[^>]*href="\/p\/tile-necklace-sample"[^>]*>دیدن محصول/);
    expect(slider).toMatch(/<a href="https:\/\/example\.com\/papital" rel="noopener noreferrer"[^>]*>اینستاگرام/);
    for (const title of ['اسلاید سوم', 'اسلاید چهارم']) expect(slider).toContain(title);
    for (const label of ['دکمهٔ بد', 'دکمهٔ بیرونی پنهان']) expect(slider).not.toContain(label);
    expect(slider).toContain('aria-label="اسلاید بعدی"');
    expect(slider).toContain('aria-label="۱ از ۴"');
  });

  it('draws a banner with its link, and without one when the address is none', () => {
    expect(partOf('banner', 0)).toMatch(new RegExp(`<a class="block" href="/collections/x"[^>]*><picture><img src="/media/${SHA('f')}.webp" alt="بنر یلدا"`));
    expect(partOf('banner', 1)).toContain(`src="/media/${SHA('1')}.webp"`);
    expect(partOf('banner', 1)).not.toContain('<a ');
  });

  it('draws the site\'s own parts with the shop\'s words and the catalog\'s products', () => {
    expect(partOf('homeIntro')).toContain('خط بالا');
    expect(partOf('homeIntro')).toMatch(/<a[^>]*href="\/products"[^>]*>همه/);
    expect(partOf('homeCategories')).toContain('دسته‌های ما');
    expect(partOf('homeCategories')).toContain('گردنبند');
    const why = partOf('homeWhy');
    expect(why).toContain('ساخت دست');
    // the delivery point without words is the shop's live rule; another point without words, or with an unknown icon, is none
    expect(why).toMatch(/ارسال رایگان از|ارسال به سراسر ایران/);
    expect(why.match(/<li/g)?.length).toBe(2);
    expect(why).not.toContain('ناشناخته');
    const featured = partOf('homeFeatured');
    expect(featured).toContain('پرفروش‌ها');
    expect(featured).toMatch(/<a[^>]*href="\/products\?sort=newest"[^>]*>همهٔ پرفروش‌ها/);
    // the first product stands beside the opening words; the row starts from the second
    expect(featured).not.toContain('/p/tile-necklace-sample');
    expect(featured).toContain('/p/tile-earrings-sample');
    const wholesale = partOf('homeWholesale');
    expect(wholesale).toMatch(/<a[^>]*href="\/wholesale"[^>]*>درخواست/);
    // half a button is none
    expect(wholesale).not.toContain('نیمه');
    expect(html).not.toContain('این بار برای پوشیدن');
  });

  it('draws a part of every page among them, the collection with its words and products, and the news', () => {
    expect(partOf('page')).toContain('متنی که فروشگاه میان بخش‌ها نوشته است.');
    expect(partOf('page')).toMatch(/<h2[^>]*><span>از کارگاه<\/span><\/h2>/);
    const collection = partOf('collectionIntro');
    expect(collection).toMatch(/<h2[^>]*>کالکشن نمونه<\/h2>/);
    expect(collection).toContain('بند یک کالکشن.');
    expect(collection).toContain('بند &lt;i&gt;دو&lt;/i&gt;.');
    expect(collection).toMatch(/<a[^>]*href="\/pages\/story"[^>]*>آشنایی بیشتر/);
    expect(collection).toContain(`src="/media/${SHA('2')}.webp"`);
    expect(collection.match(/href="\/p\/[a-z-]+"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(collection).toContain(`href="/collections/${encodeURIComponent('نمونه')}"`);
    const news = partOf('latestNews');
    expect(news).toContain('خبرهای کارگاه');
    expect(news).toMatch(/<a[^>]*href="\/news\/first-news"[^>]*>خبر نخست<\/a>/);
    expect(news).toMatch(/<a[^>]*href="\/news"[^>]*>همهٔ خبرها/);
  });

  it('takes the search title, the description and the sharing image the shop wrote', () => {
    expect(html).toMatch(/<title>زیور کاشی دست‌ساز \| [^<]+<\/title>/);
    expect(html).toContain('<meta name="description" content="توضیح صفحهٔ اصلی که فروشگاه نوشته است."');
    expect(html).toContain(`<meta property="og:image" content="https://shop.example/media/${SHA('9')}.webp"`);
    expect(html).toContain('<link rel="canonical" href="https://shop.example/"');
  });
});

describe('the answer of the Storefront API for the home page', () => {
  it('is no home page in another shape, or with nothing to draw', () => {
    for (const value of [null, 'text', [], {}, { sections: 'x' }, { sections: [] }, { sections: [{ kind: 'evil' }, null, { kind: 'slider', slides: [] }, { kind: 'shippingMethods', background: 'white', title: 'x' }] }]) {
      expect(siteHome(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('keeps a link only where it is an address of the kind the ERP says', () => {
    const slide = (href: string, external: boolean) => ({ image: image('a', ''), title: 't', buttonLabel: 'دکمه', href, external });
    const [slider] = siteHomeSections([{ kind: 'slider', slides: [slide('/products', false), slide('https://example.com/x', true), slide('/products', true), slide('https://example.com/x', false), slide('//x.example', false)] }]);
    expect(slider.kind === 'slider' ? slider.slides.map(s => `${s.buttonLabel}:${s.href}:${s.external}`) : []).toEqual(['دکمه:/products:false', 'دکمه:https://example.com/x:true', '::false', '::false', '::false']);
    const [intro] = siteHomeSections([{ kind: 'collectionIntro', collection: 'c', intro: '', image: null, moreHref: 'https://evil.example/pages/x', products: [{ slug: 'p-1', name: 'n', retailPrice: '1', stock: { status: 'in_stock' } }] }]);
    expect(intro.kind === 'collectionIntro' ? intro.moreHref : 'x').toBe('');
  });

  it('is the same seven parts, with the same words, when the shop has published none', () => {
    const today = todayHome();
    expect(today.map(part => part.kind)).toEqual(['homeIntro', 'homeCategories', 'homeWhy', 'homeFeatured', 'homeCollections', 'homeNewest', 'homeWholesale']);
    expect(today[0]).toMatchObject({ title: 'کاشی‌های ایران، این بار برای پوشیدن', buttonHref: '/products' });
    expect(homeNeeds(today)).toEqual({ featured: true, newest: true, categories: true, collections: true });
    expect(homeNeeds(siteHomeSections([{ kind: 'homeWhy', points: [{ icon: 'leaf', text: 'x' }] }]))).toEqual({ featured: false, newest: false, categories: false, collections: false });
  });
});
