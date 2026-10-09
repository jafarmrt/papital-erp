import request from 'supertest';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.0.25 (TD-963, OBS-R2-07): an audit row had no trace id, so the audit rows of one request could not be found
 * from the id its error answer and the log files carry, and the transfer delete inserted its audit row directly
 * with an empty `catch {}`, outside `logActivity`. Both fail on v10.0.21.
 */
export async function runAuditTraceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_audit_row_trace_id_td_963', 'security', 'td963', 'audit', 'package2')) {
    await runCase(results, {
      id: 'sec_audit_row_trace_id_td_963',
      name: 'v10.0.22: an audit row carries the trace id of its request; the transfer delete audits through logActivity in its transaction (TD-963)',
      details: 'OBS-R2-07: activity_logs had no trace id and the transfer delete wrote its audit row directly, swallowing errors; now DELETE /transfers/:code with X-Request-ID writes one audit row with that trace id and the transfer before the delete, and logActivity inside a request context stores the context id',
    }, async (h, wrong) => {
      const code = `T963-${h.tag}`;
      const traceId = `td963trace${h.tag}`;
      const created = await h.post('/api/transfers', { code, title: `ترنسفر ${h.tag}` });
      if (created.status >= 300) throw new Error(`creating the transfer returned ${created.status}`);

      const deleted = await request(h.app as Parameters<typeof request>[0]).delete(`/api/transfers/${code}`)
        .set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken).set('X-Request-ID', traceId);
      if (deleted.status !== 200) throw new Error(`deleting the transfer returned ${deleted.status}`);
      const rows = await h.q(`SELECT trace_id, details FROM activity_logs WHERE entity = 'ترنسفر' AND action = 'DELETE' AND entity_id = $1`, [code]);
      if (rows.length !== 1) wrong.push(`transfer delete audit rows: ${rows.length}, not 1`);
      if (rows[0] && rows[0].trace_id !== traceId) wrong.push(`the transfer delete audit row has trace id «${String(rows[0].trace_id)}», not the request's «${traceId}»`);
      const before = (rows[0]?.details as { before?: { code?: unknown } } | undefined)?.before;
      if (rows[0] && before?.code !== code) wrong.push('the transfer delete audit row has no «before» snapshot');

      const { logActivity } = await import('../../lib/auditLogger.js');
      const { requestContextStorage } = await import('../../lib/requestContext.js');
      const contextId = `td963ctx${h.tag}`;
      const logged = await requestContextStorage.run({ requestId: contextId, correlationId: contextId, startTime: Date.now() }, () =>
        logActivity({ action: 'UPDATE', entity: 'ترنسفر', entityId: `${code}-ctx`, description: 'TD-963 context check', strict: true }));
      const [ctxRow] = await h.q('SELECT trace_id FROM activity_logs WHERE id = $1', [logged.id]);
      if (ctxRow?.trace_id !== contextId) wrong.push(`logActivity in a request context stored trace id «${String(ctxRow?.trace_id)}», not «${contextId}»`);
    });
  }

  return results;
}
