import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { transfers } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-493 / B06-14: a deleted transfer design is no longer read (404 when no product
 * uses its code), and saving its code again revives the same row under its row lock instead of failing on the unique
 * constraint. On v9.0.88 the deleted row was still returned with its image and saving it again answered 409 «مقدار وارد
 * شده تکراری است».
 */
export async function runTransferCodeLifecycleTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_transfer_code_lifecycle_td_493';
  if (!shouldRun(id, 'td493', 'transfer', 'design', 'package6')) return results;

  const name = 'v9.0.89: a deleted transfer design answers 404 and saving its code again revives the same row (TD-493)';
  const tStart = Date.now();
  const code = `T493${Date.now() % 1000000}`;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const save = (body: Record<string, unknown>) => request(app).post('/api/transfers')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);

    const wrong: string[] = [];
    const created = await save({ code, title: 'td493 design', image: '/uploads/td493.webp', notes: 'td493' });
    if (created.status !== 200) throw new Error(`create answered ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
    const firstId = Number(created.body?.data?.id);

    const deleted = await request(app).delete(`/api/transfers/${code}`).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken);
    if (deleted.status !== 200) wrong.push(`delete answered ${deleted.status}`);

    const read = await request(app).get(`/api/transfers/${code}`).set('Cookie', admin.cookie);
    if (read.status !== 404) wrong.push(`GET of the deleted design answered ${read.status} (image ${read.body?.data?.image})`);

    const again = await save({ code, title: 'td493 again', notes: 'td493 again' });
    if (again.status !== 200) wrong.push(`saving the deleted code again answered ${again.status}: ${JSON.stringify(again.body).slice(0, 200)}`);
    const rows = await orm.select().from(transfers).where(eq(transfers.code, code));
    const live = rows.filter(r => r.isDeleted === 0);
    if (rows.length !== 1 || live.length !== 1 || live[0].id !== firstId || live[0].title !== 'td493 again' || live[0].image !== '') {
      wrong.push(`rows after saving again ${JSON.stringify(rows.map(r => ({ id: r.id, d: r.isDeleted, t: r.title, i: r.image })))}, expected the revived row ${firstId} without the old image`);
    }
    const reread = await request(app).get(`/api/transfers/${code}`).set('Cookie', admin.cookie);
    if (reread.status !== 200 || reread.body?.data?.title !== 'td493 again') wrong.push(`GET after reviving answered ${reread.status} ${reread.body?.data?.title}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'deleted design 404; same code saved again revived row with the new title; read back 200',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.update(transfers).set({ isDeleted: 1 }).where(and(eq(transfers.code, code), eq(transfers.isDeleted, 0))).catch(() => undefined);
  }
  return results;
}
