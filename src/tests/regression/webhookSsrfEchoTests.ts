import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 15 (events and integrations), TD-704 / B15-02 (decision t4 a): the webhook connection test never follows a
 * redirect, and the SSRF guard's echo-simulator exception holds only in test / development, on this server's own port and
 * for the exact echo path. On v9.0.334 a ping to an allowed address that answered 302 returned the internal service's body,
 * and any loopback port whose path contained "/webhook-echo" passed the guard, in production too.
 */
export async function runWebhookSsrfEchoTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_ping_redirect_and_echo_scope_td_704';
  if (!shouldRun(id, 'td704', 'b15-02', 'ssrf', 'webhook', 'package15')) return results;

  const name = 'v9.0.335: webhook ping does not follow a redirect and the echo exception holds only for this server\'s port and path outside production (TD-704)';
  const tStart = Date.now();
  const internalHits: string[] = [];
  const internal = http.createServer((req, res) => {
    internalHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('TOP-SECRET-INTERNAL-DATA');
  });
  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${(internal.address() as AddressInfo).port}/internal-secret` });
    res.end();
  });
  const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
  const savedPort = process.env.PORT;
  const savedNodeEnv = process.env.NODE_ENV;
  try {
    const internalPort = await listen(internal);
    const ownPort = await listen(redirector);
    process.env.PORT = String(ownPort); // the redirector stands in for this server's own echo endpoint
    const { WebhookSubscriptionService } = await import('../../services/events/webhookSubscriptionService.js');
    const { assertSafeExternalUrl } = await import('../../lib/ssrfGuard.js');
    const echoPath = '/api/events/webhook-echo'; // LOCAL_ECHO_PATH, the route of the echo simulator
    const wrong: string[] = [];

    // 1. an allowed address that redirects to an internal service: refused, nothing read from the internal service
    const viaRedirect = await WebhookSubscriptionService.pingTest(`http://127.0.0.1:${ownPort}${echoPath}`, 'whsec_td704');
    if (viaRedirect.success || viaRedirect.statusCode !== 302 || String(viaRedirect.responseBody).includes('TOP-SECRET') || internalHits.length > 0) {
      wrong.push(`redirect ping: success ${viaRedirect.success}, status ${viaRedirect.statusCode}, body ${JSON.stringify(viaRedirect.responseBody)}, internal hits ${internalHits.length}`);
    }

    // 2. another loopback port with "/webhook-echo" in its path: blocked by the guard
    const anyPort = await WebhookSubscriptionService.pingTest(`http://127.0.0.1:${internalPort}/internal-secret/webhook-echo`, 'whsec_td704');
    if (anyPort.success || String(anyPort.responseBody).includes('TOP-SECRET') || internalHits.length > 0 || !/SSRF blocked/.test(anyPort.message)) {
      wrong.push(`other loopback port: success ${anyPort.success}, message ${anyPort.message}, internal hits ${internalHits.length}`);
    }

    // 3. production: the echo path on this server's own port is blocked too
    process.env.NODE_ENV = 'production';
    let productionRefused = false;
    try {
      await assertSafeExternalUrl(`http://127.0.0.1:${ownPort}${echoPath}`, { allowLocalEcho: true });
    } catch {
      productionRefused = true;
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
    if (!productionRefused) wrong.push('the echo exception passed in production');

    // 4. outside production the exact echo path on the own port still passes
    await assertSafeExternalUrl(`http://127.0.0.1:${ownPort}${echoPath}`, { allowLocalEcho: true });

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'redirect ping -> 302 refused, no internal hit; other loopback port -> SSRF blocked; production -> echo blocked; own port + exact path outside production -> allowed',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    await new Promise<void>(resolve => internal.close(() => resolve()));
    await new Promise<void>(resolve => redirector.close(() => resolve()));
  }
  return results;
}
