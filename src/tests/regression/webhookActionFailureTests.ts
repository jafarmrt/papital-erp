import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 15 (events and integrations), TD-706 / B15-04 (decision t4 a): a webhook rule action whose request fails is
 * recorded as failed. On v9.0.374 a failed fetch to an address containing "webhook-echo", "example.com", "localhost",
 * "127.0.0.1", "httpbin.org" or "webhook.site" anywhere returned the made-up result "200 OK (Simulated Fallback)".
 */
export async function runWebhookActionFailureTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_webhook_action_failure_not_simulated_td_706';
  if (!shouldRun(id, 'td706', 'b15-04', 'webhook', 'action', 'package15')) return results;

  const name = 'v9.0.375: a webhook rule action whose request fails is recorded as failed, never as a simulated success (TD-706)';
  const tStart = Date.now();
  const savedPort = process.env.PORT;
  const silent = http.createServer(() => { /* never answers: the action's own timeout must end the request */ });
  try {
    const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
    const closedPort = await new Promise<number>(resolve => {
      const probe = http.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const port = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    const silentPort = await listen(silent);
    const { EventActionEngineService } = await import('../../services/events/eventActionEngineService.js');
    const { DomainEventType } = await import('../../services/events/domainEvents.js');
    const echoPath = '/api/events/webhook-echo'; // LOCAL_ECHO_PATH: passes the SSRF guard on this server's own port in test
    const now = new Date().toISOString();
    const event = {
      eventId: `td706_${Date.now()}`, eventType: DomainEventType.INVOICE_APPROVED, aggregateType: 'Document' as const,
      aggregateId: '706', payload: { documentId: 706 }, metadata: { userId: 0, userName: 'td706', timestamp: now }, occurredAt: now,
    };
    const rule = (url: string, timeoutMs: number) => ({
      id: 0, name: 'td706', description: '', eventType: event.eventType, conditionsJson: [], actionType: 'webhook',
      actionConfigJson: { url, method: 'POST', timeoutMs }, isActive: 1, executionCount: 0, lastExecutedAt: null,
      createdBy: null, createdAt: now, updatedAt: now,
    }) as unknown as Parameters<typeof EventActionEngineService.executeAction>[0];
    const wrong: string[] = [];

    // 1. nothing listens on the address (connection refused)
    process.env.PORT = String(closedPort);
    const refused = await EventActionEngineService.executeAction(rule(`http://127.0.0.1:${closedPort}${echoPath}`, 3000), event);
    if (refused.status !== 'failed' || JSON.stringify(refused.result ?? {}).includes('Simulated')) {
      wrong.push(`connection refused -> ${refused.status} ${JSON.stringify(refused.result)}`);
    }

    // 2. the receiver never answers within the action's timeout
    process.env.PORT = String(silentPort);
    const timedOut = await EventActionEngineService.executeAction(rule(`http://127.0.0.1:${silentPort}${echoPath}`, 300), event);
    if (timedOut.status !== 'failed' || JSON.stringify(timedOut.result ?? {}).includes('Simulated')) {
      wrong.push(`timeout -> ${timedOut.status} ${JSON.stringify(timedOut.result)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `connection refused -> failed (${refused.errorMessage ? 'message kept' : 'no message'}); timeout -> failed`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    silent.closeAllConnections();
    await new Promise<void>(resolve => silent.close(() => resolve()));
  }
  return results;
}
