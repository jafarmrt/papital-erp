// v12 phase 9c: when the ERP cannot answer the menus, every page keeps the site's fixed menus (9c review). Run `npm run
// build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestHandler, type ServerBuild } from 'react-router';

const PORT = 3919;
const KEY = 'test-key-not-a-secret';
let mock: ChildProcess;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, '../mock/mockApi.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_API_KEY: KEY, MOCK_ORDERING: '1', MOCK_MENUS: 'fail' },
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

describe('menus when the ERP fails', () => {
  it('serves the page with the fixed header, footer and bottom bar', async () => {
    const res = await handle(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('همهٔ محصولات');
    expect(page).toMatch(/data-bottom-nav[\s\S]*href="\/categories"/);
    expect(page).toMatch(/<footer[\s\S]*>پاپیتال</);
  });
});
