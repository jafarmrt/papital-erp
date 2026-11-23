// v12 phase 10e: a collection's page while the ERP cannot answer for the words of the collections (500). The words are
// an extra: the page is served without them, with its products. Run `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3941;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;
const catalog = JSON.parse(readFileSync(path.join(import.meta.dirname, '../mock/sample/catalog.json'), 'utf8')) as { products: Array<{ name: string; collections: string[] }> };
const product = catalog.products.find(row => row.collections.length > 0) as { name: string; collections: string[] };

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_COLLECTIONS: 'fail' },
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

describe('a collection page while its words cannot be read', () => {
  it('serves the collection with its products and no words', async () => {
    const res = await handle(new Request(`http://localhost/collections/${encodeURIComponent(product.collections[0])}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(product.name);
    expect(html).not.toContain('data-collection-intro');
    expect(html).toMatch(/<meta name="description" content="کالکشن [^"]+ پاپیتال: /);
  });
});
