// v12 phase 10c: when the ERP cannot answer for its pages (500; an ERP not yet updated answers 404 the same way), the
// five base pages keep the text the site always had and the sitemap is still written. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3931;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_PAGES: 'fail' },
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

describe('the pages when the ERP answers with an error', () => {
  it('serves the five base pages with the text the site had before 10c', async () => {
    for (const pathname of ['/about', '/contact', '/shipping', '/terms', '/privacy']) {
      const res = await handle(new Request(`http://localhost${pathname}`));
      expect(res.status, pathname).toBe(200);
      const html = await res.text();
      expect(html, pathname).not.toContain('data-site-page');
      expect(html.match(/<h1/g), pathname).toHaveLength(1);
    }
    const shipping = await (await handle(new Request('http://localhost/shipping'))).text();
    expect(shipping).toContain('پست پیشتاز');
    expect(shipping).toContain('پرداخت کارت‌به‌کارت است.');
  });

  it('still writes the sitemap, with the base pages and no date', async () => {
    const res = await handle(new Request('http://localhost/sitemap.xml'));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<url><loc>https://shop.example/about</loc></url>');
    expect(xml).not.toContain('<lastmod>');
  });

  it('does not call a page the shop made «not found» while it cannot be read', async () => {
    const res = await handle(new Request('http://localhost/pages/our-story'));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
