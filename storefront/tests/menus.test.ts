// v12 phase 9c: the menus of the ERP's «فهرست‌های سایت» on the site's pages, as a browser without JavaScript gets them,
// against the mock Storefront API (MOCK_MENUS). Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3918;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const link = (label: string, href: string, extra: Record<string, unknown> = {}) => ({ label, href, external: false, icon: '', role: '', children: [], ...extra });
const MENUS = {
  header: [
    link('همه چیز', '/products'),
    { ...link('کالکشن‌های فصل', ''), children: [link('یلدای پاپیتال', '/campaigns/yalda'), link('وبلاگ', 'https://blog.example/', { external: true })] },
    // never trusted: an address that is not a path or an https one is dropped
    link('بد', 'javascript:alert(1)'),
    link('بیرون بی https', 'http://evil.example/', { external: true }),
    // never trusted either: more than twelve children, and a path with a control character
    { ...link('بسیار', ''), children: [...Array.from({ length: 14 }, (_, n) => link(`مورد ${n}`, `/p/many-${n}`)), link('کنترلی', '/a\u0001b')] },
  ],
  drawer: null,
  footer: [
    { ...link('خرید آسان', ''), children: [link('همه چیز', '/products'), link('پیگیری', '/orders/track')] },
    { ...link('دربارهٔ ما', ''), children: [link('داستان کارگاه', '/about')] },
  ],
  bottom: [
    link('خانه', '/', { icon: 'home' }), link('سبد', '/cart', { icon: 'bag', role: 'cart' }),
    link('هدیه', '/corporate-gift', { icon: 'gift' }), link('حساب', '/account', { icon: 'user', role: 'account' }),
    link('بیرون', 'https://blog.example/', { icon: 'book', external: true }),
  ],
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '0', MOCK_MENUS: JSON.stringify(MENUS) },
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

const html = async (pathname: string) => {
  const res = await handle(new Request(`http://localhost${pathname}`));
  expect(res.status).toBe(200);
  return res.text();
};

const section = (text: string, open: RegExp, close: string) => {
  const start = text.search(open);
  return start < 0 ? '' : text.slice(start, text.indexOf(close, start));
};

describe('menus built in the ERP', () => {
  it('shows the header menu with its submenu as a details element, and drops an unsafe address', async () => {
    const page = await html('/');
    const header = section(page, /<header/, '</header>');
    expect(header).toContain('همه چیز');
    expect(header).toContain('href="/campaigns/yalda"');
    expect(header).toMatch(/<details[^>]*><summary[^>]*>کالکشن‌های فصل/);
    expect(header).toMatch(/href="https:\/\/blog\.example\/" [^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*href="https:\/\/blog\.example\/"/);
    expect(page).not.toContain('javascript:');
    expect(page).not.toContain('evil.example');
  });

  it('keeps the fixed phone menu while the drawer place is off, even with the header menu on', async () => {
    const page = await html('/');
    // the phone menu's own <nav>, which ends before the logo link
    const drawer = section(page, /data-header-panel="menu"/, 'aria-label="گالری پاپیتال، صفحهٔ اصلی"');
    expect(drawer).toContain('همهٔ محصولات');
    expect(drawer).not.toContain('کالکشن‌های فصل');
    expect(drawer).toContain('ورود به حساب');
    // it scrolls on a small phone instead of hiding its last lines
    expect(drawer).toContain('overflow-y-auto');
  });

  it('replaces the footer link columns and keeps the brand and shipping columns', async () => {
    const footer = section(await html('/'), /<footer/, '</footer>');
    expect(footer).toContain('خرید آسان');
    expect(footer).toContain('داستان کارگاه');
    expect(footer).toContain('ارسال و پرداخت');
    expect(footer).not.toContain('>پاپیتال<');
  });

  it('builds the bottom bar, without the cart while the site takes no order, without an outside address, and names the account by sign-in', async () => {
    const bar = section(await html('/'), /data-bottom-nav/, '</nav>');
    expect(bar).toContain('href="/corporate-gift"');
    expect(bar).not.toContain('href="/cart"');
    expect(bar).not.toContain('blog.example');
    expect(bar).toContain('href="/account/sign-in"');
    expect(bar).toContain('ورود');
    expect(bar).toContain('grid-cols-3');
  });

  it('cuts a submenu at twelve links and drops a path with a control character', async () => {
    const header = section(await html('/'), /<header/, '</header>');
    expect(header.match(/href="\/p\/many-\d+"/g)?.length).toBe(12);
    expect(header).not.toContain('href="/p/many-12"');
    expect(header).not.toContain('کنترلی');
  });
});
