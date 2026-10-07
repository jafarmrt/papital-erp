import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 1 finding B01-14 fixed in package 16, TD-594: in production a 4xx answer keeps its `details` (the
 * over-delivery prompt lists its items from them) and only 5xx details stay hidden; body-parser errors get a Persian
 * message and their own code. On v9.0.300 the same 422 had `details=undefined` with NODE_ENV=production, a broken JSON
 * body answered 400 «Unexpected end of JSON input» with code INTERNAL_ERROR (the 6 MB body check guards the TD-641 413).
 */
export async function runProductionErrorDetailsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_production_error_details_td_594';
  if (!shouldRun(id, 'td594', 'b01-14', 'errors', 'package16')) return results;

  const name = 'v9.0.301: production 4xx answers keep details and body-parser errors are Persian with their own code (TD-594)';
  const tStart = Date.now();
  const previousEnv = process.env.NODE_ENV;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { errorHandler } = await import('../../middleware/logger.js');
    const { ValidationError, AppError } = await import('../../errors/customErrors.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];

    const answer = (err: unknown) => {
      let status = 0;
      let body: Record<string, unknown> = {};
      const res = { headersSent: false, status(code: number) { status = code; return this; }, json(payload: Record<string, unknown>) { body = payload; return this; } };
      errorHandler(err, { headers: {}, method: 'POST', url: '/api/test' }, res, () => undefined);
      return { status, body };
    };

    process.env.NODE_ENV = 'production';
    const overDeliveries = [{ itemId: 1, planned: 2, requested: 5, excess: 3 }];
    const client = answer(new ValidationError('over delivery needs a reason', { overDeliveries }, 'OVER_DELIVERY_REASON_REQUIRED'));
    const server = answer(new AppError('raw database text', 500, 'DATABASE_ERROR', { query: 'select 1' }));
    const parse = await request(app).post('/api/drafts').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .set('Content-Type', 'application/json').send('{"entityType": "invoice", ');
    const large = await request(app).post('/api/drafts').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .set('Content-Type', 'application/json').send(JSON.stringify({ entityType: 'invoice', payload: { text: 'x'.repeat(6 * 1024 * 1024) } }));
    process.env.NODE_ENV = previousEnv;

    if (client.status !== 422 || JSON.stringify(client.body.details) !== JSON.stringify({ overDeliveries })) {
      wrong.push(`production 422 details: ${JSON.stringify(client.body.details)}`);
    }
    if (server.body.details !== undefined || server.body.message !== 'خطای داخلی سرور') wrong.push(`production 5xx leaked: ${JSON.stringify(server.body)}`);
    if (parse.status !== 400 || parse.body?.code !== 'INVALID_JSON_BODY' || /JSON input|Unexpected/i.test(String(parse.body?.message))) {
      wrong.push(`broken JSON: ${parse.status} ${parse.body?.code} «${parse.body?.message}»`);
    }
    if (large.status !== 413 || large.body?.code !== 'PAYLOAD_TOO_LARGE' || /entity too large/i.test(String(large.body?.message))) {
      wrong.push(`large body: ${large.status} ${large.body?.code} «${large.body?.message}»`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'production 422 keeps details, 5xx hides them; broken JSON 400 INVALID_JSON_BODY; large body 413 PAYLOAD_TOO_LARGE',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    process.env.NODE_ENV = previousEnv;
  }
  return results;
}
