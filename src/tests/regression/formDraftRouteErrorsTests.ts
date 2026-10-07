import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * Package 16 (dashboard and shell), TD-677 / B16-13: the drafts routes check the draft type and key with a pattern and a
 * length cap and leave every other error to the global error handler. On v9.0.293 a type holding «\u0000» answered 400
 * with the raw «Failed query: select … from "form_drafts" … params: …» text, also with NODE_ENV=production, and a
 * database error was reported as 400.
 */
export async function runFormDraftRouteErrorsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_form_draft_route_errors_td_677';
  if (!shouldRun(id, 'td677', 'b16-13', 'drafts', 'package16')) return results;

  const name = 'v9.0.294: the drafts routes validate type and key and never return raw database errors (TD-677)';
  const tStart = Date.now();
  const previousEnv = process.env.NODE_ENV;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const post = (body: Record<string, unknown>) => request(app).post('/api/drafts')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const leaks = (body: unknown) => /Failed query|form_drafts|params:/i.test(JSON.stringify(body ?? {}));
    const wrong: string[] = [];

    const nulType = await post({ entityType: 'inv\u0000oice', payload: { a: 1 } });
    if (nulType.status !== 400 || leaks(nulType.body)) wrong.push(`type with NUL: ${nulType.status} ${JSON.stringify(nulType.body).slice(0, 120)}`);
    const longKey = await post({ entityType: 'invoice', draftKey: 'k'.repeat(65), payload: { a: 1 } });
    if (longKey.status !== 400) wrong.push(`a 65-character key answered ${longKey.status}`);
    const badGet = await request(app).get('/api/drafts/inv%00oice').set('Cookie', admin.cookie);
    if (badGet.status !== 400 || leaks(badGet.body)) wrong.push(`GET with NUL type: ${badGet.status}`);

    // a database error (jsonb refuses \u0000) goes to the error handler: 500, and in production no SQL text
    process.env.NODE_ENV = 'production';
    const dbError = await post({ entityType: 'invoice', draftKey: 'td677', payload: { note: 'a\u0000b' } });
    process.env.NODE_ENV = previousEnv;
    if (dbError.status !== 500 || leaks(dbError.body)) wrong.push(`database error: ${dbError.status} ${JSON.stringify(dbError.body).slice(0, 160)}`);

    const ok = await post({ entityType: 'invoice', draftKey: 'td677', payload: { note: 'ok' } });
    if (ok.status !== 200) wrong.push(`a valid draft answered ${ok.status}`);
    await request(app).delete('/api/drafts/invoice?draftKey=td677').set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'invalid type and key are 400 without SQL text; a database error is 500 without SQL text in production',
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
