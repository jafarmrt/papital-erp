// v12 phase 10c (review): a base page the owner published must not turn back into the site's pre-launch text because the
// ERP failed for a moment. The site shows the copy it read last while the ERP answers with an error, and the fixed text
// only once the ERP says the page is off the site (404). Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3933;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

const TERMS = {
  slug: 'terms', kind: 'base', title: 'قوانین خرید', noindex: true, updatedAt: '2026-11-18T10:00:00.000Z', seoTitle: '', seoDescription: '', shareImage: null,
  sections: [{ kind: 'text', background: 'white', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'قوانین تازهٔ فروشگاه از ERP' }] }] } }],
};

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PAGES: JSON.stringify([TERMS]) },
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

const terms = async () => {
  const res = await handle(new Request('http://localhost/terms'));
  return { status: res.status, html: await res.text() };
};
/** the mock's page routes change, and the minute the site keeps an answer passes */
const afterAMinute = async (mode: string, clock: { now: number }) => {
  await fetch(`http://127.0.0.1:${PORT}/__mock/pages?mode=${mode}`);
  clock.now += 61_000;
  vi.setSystemTime(clock.now);
};

describe('a published base page while the ERP fails', () => {
  it('keeps the copy read last through an error, and shows the fixed text only when the ERP says the page is off the site', async () => {
    const clock = { now: Date.now() };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock.now);
    const first = await terms();
    expect(first.status).toBe(200);
    expect(first.html).toContain('قوانین تازهٔ فروشگاه از ERP');
    expect(first.html).toContain('<meta name="robots" content="noindex"/>');

    await afterAMinute('fail', clock);
    const during = await terms();
    expect(during.status).toBe(200);
    expect(during.html).toContain('قوانین تازهٔ فروشگاه از ERP');
    expect(during.html).toContain('<meta name="robots" content="noindex"/>');
    expect(during.html).not.toContain('متن این صفحه پیش‌نویس است');

    // a 200 that is no page (a proxy's own page, an empty answer, a bare null) is a failed read too, not «nothing published»
    for (const mode of ['html', 'empty', 'null']) {
      await afterAMinute(mode, clock);
      const still = await terms();
      expect(still.status, mode).toBe(200);
      expect(still.html, mode).toContain('قوانین تازهٔ فروشگاه از ERP');
      expect(still.html, mode).not.toContain('متن این صفحه پیش‌نویس است');
    }

    await afterAMinute('missing', clock);
    const off = await terms();
    expect(off.status).toBe(200);
    expect(off.html).not.toContain('قوانین تازهٔ فروشگاه از ERP');
    expect(off.html).not.toContain('data-site-page');

    // off the site and then an error: there is no copy to keep any more, so the fixed text stays
    await afterAMinute('fail', clock);
    expect((await terms()).html).not.toContain('قوانین تازهٔ فروشگاه از ERP');
  });
});
