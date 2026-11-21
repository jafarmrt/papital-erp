// v12 phase 10a: when the ERP cannot answer «اطلاعات فروشگاه» (down, or not yet updated: 404), every page keeps the words
// the site always had, with no seal and no floating button. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3921;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_SHOP_INFO: 'missing' },
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

describe('«اطلاعات فروشگاه» when the ERP has no answer', () => {
  it('serves the page with the brand, the footer and the policy as they were before 10a', async () => {
    const res = await handle(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>گالری پاپیتال</title>');
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    expect(footer).toContain('زیورآلات دست‌ساز با نقش کاشی‌های ایران. ساخت دست، در کارگاه پاپیتال در تهران.');
    expect(footer).toContain('href="https://www.instagram.com/papital.gallery/"');
    expect(footer).toContain('aria-label="اینستاگرام پاپیتال"');
    expect(footer).toContain('>ارسال و پرداخت</p>');
    expect(footer).toContain('<li>پرداخت کارت‌به‌کارت</li>');
    expect(footer).toContain('href="/corporate-gift"');
    expect(footer).toContain('همهٔ حقوق برای گالری پاپیتال محفوظ است.');
    expect(footer).not.toContain('data-shop-contact');
    expect(footer).not.toContain('data-enamad');
    expect(html).not.toContain('data-floating-whatsapp');
    // site review 3.2i: the project's word is «همکاران» (red before: «کارکنان»)
    expect(html).toContain('هدیهٔ مناسبتی همکاران و مشتریان');
    expect(html).not.toContain('کارکنان');
    expect(res.headers.get('content-security-policy')).toContain("img-src 'self' data:;");
  });

  it('says in the buyer\'s words that the shop is away for a moment, never «انبار» (site review §4)', async () => {
    // the ERP goes away: a list the site has not read yet cannot be shown
    mock.kill();
    await new Promise<void>(resolve => mock.once('exit', () => resolve()));
    const res = await handle(new Request(`http://localhost/products?q=${encodeURIComponent('نخوانده')}`));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const html = await res.text();
    // red before: «فروشگاه الان در دسترس نیست» with «ارتباط با انبار برقرار نشد»
    expect(html).toContain('فروشگاه لحظه‌ای در دسترس نیست');
    expect(html).toContain('چند دقیقهٔ دیگر دوباره سر بزنید.');
    expect(html).not.toContain('انبار');
    // the page around the message still names the brand
    expect(html).toContain('گالری پاپیتال');
  });
});
