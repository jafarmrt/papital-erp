import http from 'http';
import type { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowTestLoopbackOrigin } from '../../lib/ssrfGuard';
import {
  CONNECT_TIME_UNSAFE_MESSAGE, guardedWebhookFetch, setWebhookTransportForTests, WEBHOOK_RESPONSE_MAX_BYTES,
} from '../../services/events/guardedWebhookFetch';

/**
 * 10.2 package 8 (OBS-R2-81 part 4, TD-1296): a webhook delivery, its ping and an event rule's webhook action checked
 * the address before the request, and `fetch` resolved the name again when it connected, so a name answering a public
 * address to the check and an inside one to the socket (DNS rebinding) reached the inside address. `guardedWebhookFetch`
 * checks every address at connect time: a name that resolves to loopback never connects, while a reviewed test origin
 * still answers; a redirect comes back as the 3xx and is never followed.
 */
let server: http.Server;
let port = 0;
const received: string[] = [];
let undoLoopback: () => void = () => undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(WEBHOOK_RESPONSE_MAX_BYTES * 2));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ echoed: body }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  undoLoopback = allowTestLoopbackOrigin(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  undoLoopback();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const post = (url: string) => guardedWebhookFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });

describe('webhook_connect_time_lookup_td_1296', () => {
  it('refuses at connect time a name that resolves to an inside address, and nothing reaches it', async () => {
    const before = received.length;
    await expect(post(`http://localhost:${port}/hook`)).rejects.toMatchObject({ code: 'EUNSAFEADDRESS', message: CONNECT_TIME_UNSAFE_MESSAGE });
    expect(received.length).toBe(before);
  });

  it('still reaches a reviewed test origin, sends the body and reads the answer', async () => {
    const res = await post(`http://127.0.0.1:${port}/hook`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: '{"a":1}' });
  });

  it('returns a redirect to an inside address as the 3xx without following it', async () => {
    const before = received.length;
    const res = await post(`http://127.0.0.1:${port}/redirect`);
    expect(res.status).toBe(302);
    expect(received.slice(before)).toEqual(['POST /redirect']);
  });

  it('cuts a large answer at the size cap', async () => {
    const res = await post(`http://127.0.0.1:${port}/big`);
    expect((await res.text()).length).toBe(WEBHOOK_RESPONSE_MAX_BYTES);
  });

  it('a stopped request fails as an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(guardedWebhookFetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', headers: {}, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('the test transport is refused outside tests', () => {
    expect(() => setWebhookTransportForTests(null, { NODE_ENV: 'production' })).toThrow('tests only');
  });

  it('the webhook delivery, the ping and the rule action send only through the guarded request', () => {
    for (const file of ['webhookSubscriptionService.ts', 'eventActionEngineService.ts']) {
      const src = readFileSync(path.resolve(__dirname, '../../services/events', file), 'utf8');
      expect(src).not.toMatch(/\bawait fetch\(/);
      expect(src).toMatch(/guardedWebhookFetch\(/);
    }
  });
});
