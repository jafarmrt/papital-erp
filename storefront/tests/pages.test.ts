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
    env: {
      ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY,
      MOCK_SEO: JSON.stringify({
        verification: { google: 'google-code_1', bing: '' }, analytics: { provider: 'ga4', id: 'G-TEST123', url: '' },
        alternateSiteUrl: 'https://papital.gallery',
      }),
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

  it('lists the other items of the same design on a product page, and no such row without one', async () => {
    const { html } = await page('/p/tile-necklace-sample');
    const start = html.indexOf('id="same-design"');
    const row = html.slice(start, html.indexOf('</section>', start));
    expect(html).toContain('از همین طرح');
    expect(row).toContain('/p/tile-earrings-sample');
    expect(html).not.toContain('"transferCode"');
    expect((await page('/p/gift-set-sample')).html).not.toContain('از همین طرح');
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

describe('search engines and information pages', () => {
  const withEnv = async (name: string, value: string, run: () => Promise<void>) => {
    const before = process.env[name];
    process.env[name] = value;
    try { await run(); } finally {
      if (before === undefined) delete process.env[name]; else process.env[name] = before;
    }
  };

  it('opens the shop to search engines with a sitemap that lists products, places and their photos', async () => {
    const robots = await page('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.html).toContain('Sitemap: https://shop.example/sitemap.xml');
    expect(robots.html).toContain('Disallow: /healthz');
    expect(robots.html).not.toContain('Disallow: /\n');
    const sitemap = await page('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.html).toContain('<loc>https://shop.example/p/tile-necklace-sample</loc>');
    expect(sitemap.html).toContain('<loc>https://shop.example/shipping</loc>');
    expect(sitemap.html).toContain('<loc>https://shop.example/collections/');
    expect(sitemap.html).not.toContain(KEY);
    expect((await page('/')).html).not.toContain('noindex');
  });

  it('shuts a preview or test address to search engines on every page', async () => {
    await withEnv('STOREFRONT_NOINDEX', '1', async () => {
      expect((await page('/robots.txt')).html).toContain('Disallow: /\n');
      expect((await page('/sitemap.xml')).status).toBe(404);
      expect((await page('/')).html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    });
    await withEnv('STOREFRONT_SITE_URL', '', async () => {
      expect((await page('/robots.txt')).html).toContain('Disallow: /\n');
      expect((await page('/p/tile-necklace-sample')).html).not.toContain('application/ld+json');
    });
  });

  it('describes the shop, the product and its place in the shop as structured data with absolute links', async () => {
    const home = await page('/');
    expect(home.html).toContain('"@type":"Organization"');
    expect(home.html).toContain('"urlTemplate":"https://shop.example/products?q={search_term_string}"');
    const product = await page('/p/tile-necklace-sample');
    expect(product.html).toContain('"@type":"Product"');
    expect(product.html).toContain('"@type":"BreadcrumbList"');
    expect(product.html).toContain('"item":"https://shop.example/products?category=');
    // the sample has no photos: a Product with an empty image list is an error to Google, so the field is left out
    expect(product.html).not.toContain('"image":[]');
  });

  it('writes the shipping page from the live settings, and marks a page whose text is still a draft', async () => {
    const shipping = await page('/shipping');
    expect(shipping.status).toBe(200);
    expect(shipping.html).toContain('پست پیشتاز');
    expect(shipping.html).toContain('هنگام تحویل به پیک');
    expect(shipping.html).toContain('۳٬۰۰۰٬۰۰۰ تومان');
    expect(shipping.html).not.toContain('پیش‌نویس');
    for (const slug of ['about', 'contact', 'terms', 'privacy']) {
      const info = await page(`/${slug}`);
      expect(info.status).toBe(200);
      expect(info.html).toContain('پیش‌نویس');
    }
    expect((await page('/')).html).toContain('href="/terms"');
    expect((await page('/about/extra')).status).toBe(404);
  });
});

describe('old addresses of the WooCommerce site (phase 8.5)', () => {
  const visit = (pathname: string) => handle(new Request(`http://localhost${pathname}`));

  it('sends an old product address, encoded or not, to its new page for good, with the campaign fields', async () => {
    const encoded = await visit(`/product/${encodeURIComponent('گردنبند-کاشی-نمونه')}/?utm_source=instagram&add-to-cart=5`);
    expect(encoded.status).toBe(301);
    expect(encoded.headers.get('location')).toBe('/p/tile-necklace-sample?utm_source=instagram');
    expect((await visit('/product/گردنبند-کاشی-نمونه')).headers.get('location')).toBe('/p/tile-necklace-sample');
    const byId = await visit('/?p=101');
    expect(byId.status).toBe(301);
    expect(byId.headers.get('location')).toBe('/p/tile-earrings-sample');
  });

  it('sends old tag, category and page addresses to their collection, category and page', async () => {
    expect((await visit(`/product-tag/${encodeURIComponent('نمونه‌الف')}/page/2/`)).headers.get('location')).toBe(`/collections/${encodeURIComponent('نمونه‌الف')}`);
    expect((await visit('/product-category/jewelry/earrings/')).headers.get('location')).toBe(`/products?category=${encodeURIComponent('گوشواره')}`);
    expect((await visit('/about-us/')).headers.get('location')).toBe('/about');
  });

  it('follows a redirect to another old address in one hop, and never loops', async () => {
    expect((await visit('/our-story')).headers.get('location')).toBe('/about');
    expect((await visit('/loop-a')).status).toBe(404);
  });

  it('guesses for a WooCommerce address no redirect names, only for a while, and leaves the rest a 404', async () => {
    const unknown = await visit(`/product/${encodeURIComponent('دستبند-فیروزه')}/`);
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get('location')).toBe(`/products?q=${encodeURIComponent('دستبند فیروزه')}`);
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    expect((await visit('/shop/')).headers.get('location')).toBe('/products');
    const search = await visit('/?s=کاشی&post_type=product');
    expect(search.status).toBe(301);
    expect(search.headers.get('location')).toBe(`/products?q=${encodeURIComponent('کاشی')}`);
    expect((await visit('/wp-login.php')).status).toBe(404);
    // a campaign link to the home page stays the home page
    expect((await visit('/?utm_source=instagram')).status).toBe(200);
  });
});

describe('search-engine verification and visit statistics (phase 8.5)', () => {
  it('writes the verification code, loads the chosen statistics service and allows only its addresses', async () => {
    const res = await handle(new Request('http://localhost/'));
    const html = await res.text();
    expect(html).toContain('<meta name="google-site-verification" content="google-code_1"/>');
    expect(html).not.toContain('msvalidate.01');
    expect(html).toContain('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
    expect(html).toContain(`gtag('config',"G-TEST123")`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
    expect(csp).toContain('connect-src \'self\' https://*.google-analytics.com');
    expect(csp).toContain("object-src 'none'");
  });

  it('names the brand\'s site in another language on the home page', async () => {
    const { html } = await page('/');
    expect(html).toContain('<link rel="alternate" hrefLang="fa" href="https://shop.example/"/>');
    expect(html).toContain('<link rel="alternate" hrefLang="en" href="https://papital.gallery/"/>');
  });

  it('never counts visits on a preview or test address', async () => {
    const before = process.env.STOREFRONT_NOINDEX;
    process.env.STOREFRONT_NOINDEX = '1';
    try {
      const res = await handle(new Request('http://localhost/'));
      const html = await res.text();
      expect(html).not.toContain('googletagmanager');
      expect(res.headers.get('content-security-policy')).not.toContain('googletagmanager');
    } finally {
      if (before === undefined) delete process.env.STOREFRONT_NOINDEX; else process.env.STOREFRONT_NOINDEX = before;
    }
  });
});

describe('the installable site (PWA)', () => {
  const withPwa = async (run: () => Promise<void>) => {
    process.env.STOREFRONT_PWA = '1';
    try { await run(); } finally { delete process.env.STOREFRONT_PWA; }
  };

  it('is off by default: no manifest, no worker, and the page removes a worker left from before', async () => {
    expect((await page('/manifest.webmanifest')).status).toBe(404);
    expect((await page('/sw.js')).status).toBe(404);
    expect((await page('/')).html).not.toContain('rel="manifest"');
  });

  it('switched on, describes the shop as an app with the shop icons when the ERP icon is not usable', async () => {
    await withPwa(async () => {
      const res = await handle(new Request('http://localhost/manifest.webmanifest'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/manifest+json');
      const manifest = await res.json() as { name: string; dir: string; start_url: string; display: string; icons: Array<{ src: string; sizes: string; purpose: string }> };
      expect(manifest).toMatchObject({ name: 'گالری پاپیتال', dir: 'rtl', start_url: '/', display: 'standalone' });
      // the sample's logo is an SVG but it sets no browser icon, so the shop's own icons are used
      expect(manifest.icons.map(i => `${i.src} ${i.sizes} ${i.purpose}`)).toEqual([
        '/pwa/icon-192.png 192x192 any', '/pwa/icon-512.png 512x512 any', '/pwa/icon-maskable-512.png 512x512 maskable',
      ]);
      expect((await page('/')).html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
    });
  });

  it('serves a worker that is never cached by the browser and never keeps pages, data or prices', async () => {
    await withPwa(async () => {
      const res = await handle(new Request('http://localhost/sw.js'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/javascript');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const source = await res.text();
      expect(source).toContain("request.mode === 'navigate'");
      expect(source).toContain('اتصال به اینترنت برقرار نیست');
      // only build files, fonts, app icons and hash-named photos go to a cache
      expect(source.match(/cacheFirst\(request, [A-Z]+\)/g)).toEqual(['cacheFirst(request, STATIC)', 'cacheFirst(request, MEDIA)']);
      expect(source).not.toContain('/api/');
      expect(() => new Function(source)).not.toThrow();
    });
  });
});
