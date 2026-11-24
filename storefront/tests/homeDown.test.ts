// v12 phase 10e: the home page must never be down. Until the shop publishes one the site draws its own; a published
// one stays through an ERP error (the copy read last), and the site's own comes back only when the ERP says there is
// none (404). A «صفحهٔ ویژه» that asks for the top of the home page takes the place of its top part. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3943;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const SHA = (letter: string) => letter.repeat(64);
const HOME = {
  seoTitle: '', seoDescription: '', shareImage: null, updatedAt: '2026-11-24T08:00:00.000Z',
  sections: [
    { kind: 'slider', slides: [{ image: { sha256: SHA('a'), width: 1600, height: 600, alt: 'کاشی', thumb: false }, mobileImage: null, title: 'اسلاید فروشگاه', text: '', buttonLabel: '', href: '', external: false }] },
    { kind: 'homeCategories', title: 'دسته‌های فروشگاه' },
    { kind: 'homeFeatured', title: 'برگزیده‌های فروشگاه', buttonLabel: '', buttonHref: '' },
  ],
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    // the sample's campaign «یلدا» asks for the top of the home page
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_HOME: JSON.stringify(HOME) },
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
  vi.useRealTimers();
  mock?.kill();
});

const home = async () => {
  const res = await handle(new Request('http://localhost/'));
  return { status: res.status, html: await res.text() };
};
/** the mock's home route changes, and the minute the site keeps an answer passes */
const afterAMinute = async (mode: string, clock: { now: number }) => {
  await fetch(`http://127.0.0.1:${PORT}/__mock/home?mode=${mode}`);
  clock.now += 61_000;
  vi.setSystemTime(clock.now);
};
const OWN = 'این بار برای پوشیدن';
/** the row of «برگزیده‌ها» as drawn */
const featuredRow = (html: string) => {
  const from = html.indexOf('data-home-part="homeFeatured"');
  const next = html.indexOf('data-home-part=', from + 1);
  return from < 0 ? '' : html.slice(from, next < 0 ? html.indexOf('window.__reactRouterContext') : next);
};
const FIRST_PRODUCT = '/p/tile-necklace-sample';

describe('the home page while the ERP has none, fails, or a campaign asks for its top', () => {
  it('keeps the published copy through an error and draws its own only when the ERP says there is none', async () => {
    const clock = { now: Date.now() };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock.now);
    const first = await home();
    expect(first.status).toBe(200);
    expect(first.html).toContain('دسته‌های فروشگاه');
    // the campaign's banner stands where the slider was: the slider is not drawn, nor sent to the browser
    expect(first.html).toContain('id="campaign-banner"');
    expect(first.html).not.toContain('اسلاید فروشگاه');
    expect(first.html).not.toContain('data-home-part="slider"');
    expect(first.html.match(/<h1/g)?.length).toBe(1);
    expect(first.html).not.toContain(OWN);
    // this page has no opening words with a product beside them, so its row of products starts from the shop's first
    expect(featuredRow(first.html)).toContain(FIRST_PRODUCT);

    // an error, a 200 that is no home page and one with nothing to draw are failed reads: the copy read last stays
    for (const mode of ['fail', 'empty', 'nothing']) {
      await afterAMinute(mode, clock);
      const during = await home();
      expect(during.status, mode).toBe(200);
      expect(during.html, mode).toContain('دسته‌های فروشگاه');
      expect(during.html, mode).not.toContain('خرید بر اساس دسته');
    }

    // the ERP says there is none (taken off the site, or nothing of it shows today): the site's own home page is back
    await afterAMinute('none', clock);
    const own = await home();
    expect(own.status).toBe(200);
    expect(own.html).not.toContain('دسته‌های فروشگاه');
    expect(own.html).toContain('خرید بر اساس دسته');
    expect(own.html).toContain('برگزیده‌های کارگاه');
    expect(own.html).toContain('id="campaign-banner"');
    // its opening words give way to the campaign's banner, as they always have, and its row of products is the same as without a campaign
    expect(own.html).not.toContain(OWN);
    expect(featuredRow(own.html)).toContain('/p/tile-earrings-sample');
    expect(featuredRow(own.html)).not.toContain(FIRST_PRODUCT);

    // the ERP fails with no copy to fall back on: still the site's own home page, never an error
    await afterAMinute('fail', clock);
    const bare = await home();
    expect(bare.status).toBe(200);
    expect(bare.html).toContain('خرید بر اساس دسته');

    // and the published one is back when the ERP has it again
    await afterAMinute('ok', clock);
    expect((await home()).html).toContain('دسته‌های فروشگاه');
  });
});
