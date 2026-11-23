// v12 phase 10d: the news while the ERP cannot be read (500 for its three addresses). A failed read is never «no news»:
// `/news` and an item are an error page, not a 404 a search engine would take as «gone»; the sitemap is still served,
// without news. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3939;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_NEWS: 'fail' },
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

describe('the news while the ERP cannot be read', () => {
  it('answers an error, not «پیدا نشد», for the list and for an item, and still serves the rest of the site', async () => {
    for (const pathname of ['/news', '/news/yalda-night']) {
      const res = await handle(new Request(`http://localhost${pathname}`));
      expect(res.status, pathname).toBeGreaterThanOrEqual(500);
    }
    expect((await handle(new Request('http://localhost/'))).status).toBe(200);
    const map = await handle(new Request('http://localhost/sitemap.xml'));
    expect(map.status).toBe(200);
    const xml = await map.text();
    expect(xml).toContain('<loc>https://shop.example/products</loc>');
    expect(xml).not.toContain('/news');
  });
});
