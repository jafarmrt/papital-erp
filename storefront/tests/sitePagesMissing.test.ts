// v12 phase 10c: an ERP not yet updated has no `/pages` route at all (404 for the list and for every address). The site
// then is what it was before 10c: the five base pages with their fixed text, the sitemap without a date, and
// `/pages/<address>` a 404. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3932;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PAGES: 'missing' },
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

describe('the pages with an ERP that does not have them yet', () => {
  it('serves the base pages with their fixed text, the sitemap without a date, and no page under /pages', async () => {
    for (const pathname of ['/about', '/contact', '/shipping', '/terms', '/privacy']) {
      const res = await handle(new Request(`http://localhost${pathname}`));
      expect(res.status, pathname).toBe(200);
      expect(await res.text(), pathname).not.toContain('data-site-page');
    }
    const about = await (await handle(new Request('http://localhost/about'))).text();
    expect(about).toContain('پاپیتال کارگاهی در تهران است');
    const map = await handle(new Request('http://localhost/sitemap.xml'));
    expect(map.status).toBe(200);
    const xml = await map.text();
    expect(xml).toContain('<url><loc>https://shop.example/terms</loc></url>');
    expect(xml).not.toContain('<lastmod>');
    expect((await handle(new Request('http://localhost/pages/our-story'))).status).toBe(404);
  });
});
