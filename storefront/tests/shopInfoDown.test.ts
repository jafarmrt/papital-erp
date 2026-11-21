// v12 phase 10a (review): when the ERP answers the shop details with an error (500), every page keeps the words the site
// always had; `shopInfoFallback.test.ts` covers an ERP not yet updated (404). Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3922;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_SHOP_INFO: 'fail' },
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

describe('the shop details when the ERP answers with an error', () => {
  it('serves the pages with the brand and the policy as they were before 10a', async () => {
    for (const pathname of ['/', '/contact', '/products']) {
      const res = await handle(new Request(`http://localhost${pathname}`));
      expect(res.status, pathname).toBe(200);
      const html = await res.text();
      expect(html, pathname).toContain('گالری پاپیتال</title>');
      expect(html, pathname).toContain('همهٔ حقوق برای گالری پاپیتال محفوظ است.');
      expect(html, pathname).not.toContain('data-enamad');
      expect(html, pathname).not.toContain('data-floating-whatsapp');
      expect(res.headers.get('content-security-policy'), pathname).toContain("img-src 'self' data:;");
    }
  });
});
