import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { customers, dailyWorkLogs, roles, users } from '../../db/schema.js';

/**
 * مشاهده‌های ممیزی حوزه H (TD-403، TD-406) روی مسیرهای واقعی Express: هر آزمون روی کد پیشین قرمز است.
 */

interface Session { cookie: string; csrfToken: string }

export async function runRecordGuardTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const createdRoleIds: number[] = [];
  const createdUserIds: number[] = [];
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser, createTestCustomer } = await import('../fixtures/factories.js');
  const app = await getTestApp();

  const userWith = async (permissions: string[]): Promise<{ id: number; session: Session }> => {
    const role = await createTestRole({ permissions });
    createdRoleIds.push(role.id);
    const user = await createTestUser({ role: role.code });
    createdUserIds.push(user.id);
    return { id: user.id, session: await loginTestUserWithSession(app, user.username) };
  };
  const send = (s: Session, method: 'post' | 'put' | 'get', url: string, body?: object) => {
    const r = request(app)[method](url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken);
    return body ? r.send(body) : r;
  };

  const cases: Array<{ id: string; name: string; run: () => Promise<string> }> = [
    {
      id: 'sec_customer_version_lock_td_403',
      name: 'v8.0.122: editing a party with a stale or missing version is refused and the Excel import updates a row with an id only at its own version (TD-403)',
      run: async () => {
        const editor = await userWith(['customers.view', 'customers.manage']);
        const cust = await createTestCustomer({ city: 'تهران', phone: `0912${String(Date.now()).slice(-7)}` });
        try {
          const body = { name: cust.name, phone: cust.phone ?? '', city: 'شیراز' };
          const wrong: string[] = [];
          const first = await send(editor.session, 'put', `/api/customers/${cust.id}`, { ...body, version: cust.version });
          if (first.status !== 200) wrong.push(`edit with the right version returned ${first.status} (${JSON.stringify(first.body).slice(0, 200)})`);
          const stale = await send(editor.session, 'put', `/api/customers/${cust.id}`, { ...body, city: 'تبریز', version: cust.version });
          if (stale.status !== 409) wrong.push(`edit with a stale version returned ${stale.status}, not 409`);
          const missing = await send(editor.session, 'put', `/api/customers/${cust.id}`, { ...body, city: 'یزد' });
          if (missing.status !== 400) wrong.push(`edit without a version returned ${missing.status}, not 400`);
          const [afterEdits] = await orm.select().from(customers).where(eq(customers.id, cust.id));
          if (afterEdits.city !== 'شیراز') wrong.push(`city after the edits is "${afterEdits.city}", not "Shiraz"`);

          // درون‌ریزی: ردیف شناسه‌دار بی نسخه یا با نسخه کهنه اعمال نمی‌شود؛ با نسخه کنونی اعمال می‌شود
          const row = { id: cust.id, name: cust.name, phone: cust.phone ?? '' };
          const imported = await send(editor.session, 'post', '/api/customers/bulk-import', {
            updateIfExists: true,
            rows: [{ ...row, city: 'کرمان' }, { ...row, city: 'قم', version: cust.version }],
          });
          const [afterStale] = await orm.select().from(customers).where(eq(customers.id, cust.id));
          if (imported.status !== 200 || Number(imported.body?.updatedCount) !== 0 || (imported.body?.errors ?? []).length !== 2) {
            wrong.push(`import without a version and with a stale version: ${imported.status}, ${Number(imported.body?.updatedCount)} updated, ${(imported.body?.errors ?? []).length} errors (expected 0 and 2)`);
          }
          if (afterStale.city !== 'شیراز') wrong.push(`stale import set the city to "${afterStale.city}"`);
          const fresh = await send(editor.session, 'post', '/api/customers/bulk-import', { updateIfExists: true, rows: [{ ...row, city: 'رشت', version: afterStale.version }] });
          const [afterFresh] = await orm.select().from(customers).where(eq(customers.id, cust.id));
          if (fresh.status !== 200 || afterFresh.city !== 'رشت') wrong.push(`import with the current version was not applied (${fresh.status}, city "${afterFresh.city}")`);
          if (wrong.length > 0) throw new Error(wrong.join(', '));
          return 'نسخه درست ۲۰۰، کهنه ۴۰۹، بی نسخه ۴۰۰؛ درون‌ریزی کهنه و بی نسخه رد و با نسخه کنونی اعمال شد';
        } finally {
          await orm.delete(customers).where(eq(customers.id, cust.id));
        }
      },
    },
    {
      id: 'sec_daily_log_stats_visibility_td_406',
      name: 'v8.0.125: daily work log statistics count only the logs the user sees in the list, not private logs of others (TD-406)',
      run: async () => {
        const author = await userWith(['daily_logs.view', 'daily_logs.create']);
        const viewer = await userWith(['daily_logs.view']);
        const base = { userId: author.id, username: 'td406', userFullName: 'td406', date: '2026-10-01', dateIso: '2026-10-01', content: 'متن' };
        const inserted = await orm.insert(dailyWorkLogs).values([
          { ...base, title: 'td406 محرمانه', visibility: 'private', workMode: 'remote', mentions: [viewer.id] },
          { ...base, title: 'td406 مدیران', visibility: 'managers', workMode: 'remote' },
          { ...base, title: 'td406 اشاره‌شده', visibility: 'mentioned_only', workMode: 'onsite', mentions: [viewer.id] },
        ]).returning({ id: dailyWorkLogs.id });
        try {
          const stats = await send(viewer.session, 'get', '/api/daily-logs/stats');
          const list = await send(viewer.session, 'get', '/api/daily-logs?limit=100');
          const authorStats = await send(author.session, 'get', '/api/daily-logs/stats');
          // v9.0.249 (TD-630): the list is paged; `total` counts every visible log
          const rows: Array<{ title?: string; work_mode?: string }> = Array.isArray(list.body?.data) ? list.body.data : [];
          const visible = typeof list.body?.total === 'number' ? list.body.total : -1;
          const wrong: string[] = [];
          if (stats.status !== 200) throw new Error(`statistics returned ${stats.status}`);
          if (stats.body.total_logs !== visible) wrong.push(`statistics total count is ${stats.body.total_logs} and the list has ${visible}`);
          const remoteVisible = rows.filter(l => String(l.title).startsWith('td406') && l.work_mode === 'remote').length;
          if (remoteVisible !== 0) wrong.push(`a private log appeared in the viewer list (${remoteVisible})`);
          if (stats.body.my_mentions_count !== 1) wrong.push(`"mentions me" is ${stats.body.my_mentions_count}, not 1 (a private log was counted)`);
          if (authorStats.body.my_total_logs !== 3) wrong.push(`the author counted ${authorStats.body.my_total_logs} of their own logs, not 3`);
          if (wrong.length > 0) throw new Error(wrong.join(', '));
          return `شمار کل ${visible} برابر فهرست؛ اشاره ۱؛ نویسنده ۳ گزارش خود را شمرد`;
        } finally {
          await orm.delete(dailyWorkLogs).where(inArray(dailyWorkLogs.id, inserted.map(r => r.id)));
        }
      },
    },
  ];

  try {
    for (const c of cases) {
      if (!shouldRun(c.id, 'security', 'record', 'guard')) continue;
      const tStart = Date.now();
      try {
        const details = await c.run();
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'security', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
      } catch (err) {
        results.push(makeTestCase({ id: c.id, name: c.name, layer: 'security', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  } finally {
    if (createdUserIds.length > 0) await orm.delete(users).where(inArray(users.id, createdUserIds)).catch(() => undefined);
    if (createdRoleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, createdRoleIds)).catch(() => undefined);
  }
  return results;
}
