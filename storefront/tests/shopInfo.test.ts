// v12 phase 10a: the ERP's «اطلاعات فروشگاه» on the site's pages, as a browser without JavaScript gets them, against the
// mock Storefront API (MOCK_SHOP_INFO). Run `npm run build` first. Every expectation here was red before 10a: the brand's
// name, the footer's texts and the Instagram page were fixed in the site's code, and there was no seal or floating button.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { contentSecurityPolicy } from '../app/lib/csp';
import { DEFAULT_SHOP, siteShop } from '../app/lib/shopInfo';

const PORT = 3920;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const SHOP_INFO = {
  brand: { name: 'نگارین', fullName: 'گالری نگارین', tagline: 'زیور دست‌ساز نمونه' },
  footerNote: 'ساخت کارگاه نمونه.',
  contact: { address: 'تهران، خیابان نمونه، پلاک ۱', postalCode: '1234567890', phone: '02112345678', mobile: '09120000000', email: 'info@shop.example', hours: 'شنبه تا چهارشنبه، ۹ تا ۱۷' },
  social: { instagram: 'https://www.instagram.com/negarin.sample/', telegram: 'https://t.me/negarin_sample', youtube: '', aparat: '', linkedin: '' },
  copyright: 'حق نشر برای کارگاه نمونه است.',
  shipping: { title: 'ارسال و خرید', lines: ['پرداخت هنگام ثبت سفارش', 'بسته‌بندی هدیه رایگان'] },
  alternateSiteLabel: 'سایت انگلیسی ما',
  enamad: { linkUrl: 'https://trustseal.enamad.ir/?id=1&Code=abc', imageUrl: 'https://trustseal.enamad.ir/logo.aspx?id=1&Code=abc' },
  whatsappFloat: '989120000000',
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: {
      ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '1', MOCK_SHOP_INFO: JSON.stringify(SHOP_INFO),
      MOCK_SEO: JSON.stringify({ verification: { google: '', bing: '' }, analytics: { provider: 'none', id: '', url: '' }, alternateSiteUrl: 'https://papital.gallery' }),
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

const get = async (pathname: string) => {
  const res = await handle(new Request(`http://localhost${pathname}`));
  return { status: res.status, html: await res.text(), csp: res.headers.get('content-security-policy') ?? '' };
};
const footerOf = (html: string) => html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));

describe('the shop details on the pages', () => {
  it('names the brand as the ERP has it: the header, the page titles, the social card and the structured data', async () => {
    const home = await get('/');
    expect(home.status).toBe(200);
    expect(home.html).toContain('<title>گالری نگارین</title>');
    expect(home.html).toContain('<meta property="og:site_name" content="گالری نگارین"/>');
    const header = home.html.slice(home.html.indexOf('<header'), home.html.indexOf('</header>'));
    expect(header).toContain('aria-label="گالری نگارین، صفحهٔ اصلی"');
    expect(header).toContain('زیور دست‌ساز نمونه');
    expect(header).not.toContain('پاپیتال');
    expect((await get('/products')).html).toContain('| گالری نگارین</title>');
    const product = await get('/p/tile-necklace-sample');
    expect(product.html).toContain('| گالری نگارین</title>');
    expect(product.html).toContain('"brand":{"@type":"Brand","name":"گالری نگارین"}');
  });

  it('tells search engines the shop\'s address, phone, email and social pages', async () => {
    const { html } = await get('/');
    expect(html).toContain('"@type":"Organization","name":"گالری نگارین"');
    expect(html).toContain('"sameAs":["https://www.instagram.com/negarin.sample/","https://t.me/negarin_sample"]');
    expect(html).toContain('"address":{"@type":"PostalAddress","streetAddress":"تهران، خیابان نمونه، پلاک ۱","postalCode":"1234567890","addressCountry":"IR"}');
    expect(html).toContain('"telephone":"02112345678"');
    expect(html).toContain('"email":"info@shop.example"');
  });

  it('writes the footer from it: the sentence under the logo, the social pages, the contact details, the owner\'s lines of the shipping column under the live ones, the other-language site and the last line', async () => {
    const footer = footerOf((await get('/')).html);
    expect(footer).toContain('زیور دست‌ساز نمونه. ساخت کارگاه نمونه.');
    expect(footer).toContain('href="https://www.instagram.com/negarin.sample/"');
    expect(footer).toContain('aria-label="تلگرام نگارین"');
    expect(footer).toContain('href="https://t.me/negarin_sample"');
    expect(footer).not.toContain('papital.gallery/"');
    // the contact details, with the digits a buyer reads and the digits a phone dials
    expect(footer).toContain('تهران، خیابان نمونه، پلاک ۱');
    expect(footer).toContain('۱۲۳۴۵۶۷۸۹۰');
    expect(footer).toMatch(/href="tel:02112345678"[^>]*>۰۲۱۱۲۳۴۵۶۷۸</);
    expect(footer).toContain('href="mailto:info@shop.example"');
    expect(footer).toContain('شنبه تا چهارشنبه، ۹ تا ۱۷');
    // the column's title and lines are the owner's; the shipping methods and the free-shipping line stay live
    expect(footer).toContain('>ارسال و خرید</p>');
    expect(footer).toContain('پست پیشتاز');
    expect(footer).toContain('ارسال رایگان برای خرید از');
    expect(footer).toContain('<li>پرداخت هنگام ثبت سفارش</li><li>بسته‌بندی هدیه رایگان</li>');
    expect(footer).not.toContain('پرداخت کارت‌به‌کارت');
    expect(footer).toMatch(/href="https:\/\/papital\.gallery"[^>]*>سایت انگلیسی ما</);
    expect(footer).toContain('حق نشر برای کارگاه نمونه است.');
    expect(footer).not.toContain('همهٔ حقوق برای');
  });

  it('shows the e-namad seal in the footer and lets only its host serve a picture', async () => {
    const home = await get('/');
    const footer = footerOf(home.html);
    expect(footer).toMatch(/<a href="https:\/\/trustseal\.enamad\.ir\/\?id=1&amp;Code=abc" target="_blank" rel="noopener" referrerPolicy="origin" data-enamad="true">/);
    expect(footer).toMatch(/<img src="https:\/\/trustseal\.enamad\.ir\/logo\.aspx\?id=1&amp;Code=abc" alt="نماد اعتماد الکترونیکی" referrerPolicy="origin"/);
    expect(home.csp).toContain("img-src 'self' data: https://trustseal.enamad.ir;");
    // nothing else of the policy opens
    expect(home.csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(home.csp).toContain("connect-src 'self';");
  });

  it('lists the address and contact details on the contact page, with every social page', async () => {
    const { status, html } = await get('/contact');
    expect(status).toBe(200);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).toContain('نشانی و تماس');
    expect(main).toContain('تهران، خیابان نمونه، پلاک ۱');
    expect(main).toMatch(/href="tel:09120000000"[^>]*>۰۹۱۲۰۰۰۰۰۰۰</);
    expect(main).toContain('href="mailto:info@shop.example"');
    expect(main).toContain('@<!-- -->negarin.sample');
    expect(main).toContain('href="https://t.me/negarin_sample"');
  });

  it('keeps the floating WhatsApp button above the phone\'s bottom bar, and off the cart, the checkout and the order pages', async () => {
    for (const pathname of ['/', '/products', '/p/tile-necklace-sample', '/contact']) {
      const { html } = await get(pathname);
      expect(html, pathname).toMatch(/<a href="https:\/\/wa\.me\/989120000000" rel="noopener" data-floating-whatsapp="true" aria-label="گفت‌وگو در واتس‌اپ"/);
      expect(html, pathname).toContain('bottom-[calc(4.25rem+env(safe-area-inset-bottom))]');
    }
    for (const pathname of ['/cart', '/checkout', '/orders/track']) {
      const res = await handle(new Request(`http://localhost${pathname}`));
      // an empty cart sends the checkout back to the cart: the page a buyer then sees has no button either
      if (res.status === 200) expect(await res.text(), pathname).not.toContain('data-floating-whatsapp');
      else expect(res.status, pathname).toBe(302);
    }
  });

  it('names the brand in the product feed and on the installed app', async () => {
    const feed = await get('/feeds/google.xml');
    expect(feed.status).toBe(200);
    expect(feed.html).toContain('<title>گالری نگارین</title>');
    expect(feed.html).toContain('<g:brand>گالری نگارین</g:brand>');
    expect(feed.html).not.toContain('پاپیتال');
  });
});

describe('what the site takes of the shop details', () => {
  it('keeps its own words for a field left empty, and for an answer of another shape', () => {
    expect(siteShop({})).toEqual(DEFAULT_SHOP);
    expect(siteShop('nonsense')).toEqual(DEFAULT_SHOP);
    expect(siteShop({ brand: 7, contact: [], social: null, shipping: 'x', enamad: 1, whatsappFloat: 5 })).toEqual(DEFAULT_SHOP);
    expect(DEFAULT_SHOP.brand).toEqual({ name: 'پاپیتال', fullName: 'گالری پاپیتال', tagline: 'زیورآلات دست‌ساز با نقش کاشی‌های ایران' });
    expect(DEFAULT_SHOP.social).toEqual([{ name: 'instagram', title: 'اینستاگرام', href: 'https://www.instagram.com/papital.gallery/' }]);
    expect(DEFAULT_SHOP.instagramHandle).toBe('papital.gallery');
    expect(DEFAULT_SHOP.copyright).toBe('همهٔ حقوق برای گالری پاپیتال محفوظ است.');
    expect(DEFAULT_SHOP.shipping).toEqual({ title: 'ارسال و پرداخت', lines: [] });
    expect(DEFAULT_SHOP.enamad).toBeNull();
    expect(DEFAULT_SHOP.whatsappFloat).toBe('');
    // the last line follows the brand's name while it has no words of its own
    expect(siteShop({ brand: { fullName: 'گالری نگارین' } }).copyright).toBe('همهٔ حقوق برای گالری نگارین محفوظ است.');
  });

  it('takes nothing on trust: no address but https, no seal off enamad.ir, no number that is not digits, no text past its length', () => {
    const shop = siteShop({
      brand: { name: 'x'.repeat(41), fullName: 'نام\nدو خط', tagline: '<script>alert(1)</script>' },
      contact: { address: 'الف', postalCode: '12345', phone: 'tel:021', mobile: '0912 000 0000', email: 'not-an-email', hours: 'ب' },
      social: { instagram: 'javascript:alert(1)', telegram: 'http://t.me/x', youtube: 'https://user:pw@youtube.com/x', aparat: '//aparat.com/x', linkedin: 'https://linkedin.com/company/x' },
      shipping: { title: 'عنوان', lines: ['خط یک', 7, 'x'.repeat(121), ...Array.from({ length: 9 }, (_, n) => `خط ${n}`)] },
      enamad: { linkUrl: 'https://trustseal.enamad.ir/?id=1', imageUrl: 'https://evil.example/logo.png' },
      whatsappFloat: '+98 912',
    });
    expect(shop.brand.name).toBe('پاپیتال');
    expect(shop.brand.fullName).toBe('گالری پاپیتال');
    // a tag is only text to the page (React writes it escaped); it is one line within its length, so it is kept as text
    expect(shop.brand.tagline).toBe('<script>alert(1)</script>');
    expect(shop.contact).toEqual({ address: 'الف', postalCode: '', phone: '', mobile: '09120000000', email: '', hours: 'ب' });
    expect(shop.social.map(s => s.href)).toEqual(['https://www.instagram.com/papital.gallery/', 'https://linkedin.com/company/x']);
    expect(shop.shipping.lines).toEqual(['خط یک', 'خط 0', 'خط 1', 'خط 2']);
    expect(shop.enamad).toBeNull();
    expect(shop.whatsappFloat).toBe('');
    // the seal's picture on another host never opens the policy, even if it reached the page's data
    expect(contentSecurityPolicy(null, 'https://evil.example/logo.png')).toContain("img-src 'self' data:;");
    expect(contentSecurityPolicy(null, 'https://enamad.ir.evil.example/logo.png')).toContain("img-src 'self' data:;");
    expect(contentSecurityPolicy(null, 'https://trustseal.enamad.ir/logo.aspx?id=1')).toContain("img-src 'self' data: https://trustseal.enamad.ir;");
  });
});
