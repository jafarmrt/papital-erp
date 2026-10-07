import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, categories, items } from '../../db/schema.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 5 (items and pricing), PR D: item categories (soft delete and audit, unique name, rename and type change).
 * Each case reproduces a finding of the package 5 review.
 */
export async function runItemCategoryTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['reg_category_soft_delete_and_audit_td_659',
      'v9.0.177: a category is soft-deleted and every create, edit, delete and default reset writes an audit row (TD-659)',
      ['td659', 'category', 'audit', 'package5'], softDeleteAuditCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeCtx();
    try {
      const details = await run(ctx);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (ctx.itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, ctx.itemIds)).catch(() => undefined);
      if (ctx.categoryIds.length > 0) await orm.delete(categories).where(inArray(categories.id, ctx.categoryIds)).catch(() => undefined);
    }
  }
  return results;
}

interface Ctx {
  tag: string;
  itemIds: number[];
  /** categories created by the case, removed after it */
  categoryIds: number[];
  send(method: 'post' | 'put' | 'delete', url: string, body?: unknown): Promise<request.Response>;
  get(url: string): Promise<request.Response>;
}

async function makeCtx(): Promise<Ctx> {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const admin = await getAdminSession();
  const ctx: Ctx = {
    tag: String(100 + Math.floor(Math.random() * 900)),
    itemIds: [],
    categoryIds: [],
    send: async (method, url, body) => {
      const res = await request(app)[method](url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send((body ?? {}) as object);
      if (method === 'post' && url === '/api/categories' && res.status === 200 && typeof res.body?.id === 'number') ctx.categoryIds.push(res.body.id);
      if (method === 'post' && url === '/api/items' && res.status === 200 && typeof res.body?.id === 'number') ctx.itemIds.push(res.body.id);
      return res;
    },
    get: (url) => request(app).get(url).set('Cookie', admin.cookie),
  };
  return ctx;
}

async function auditActions(categoryId: number): Promise<string[]> {
  const rows = await orm.select({ action: activityLogs.action }).from(activityLogs)
    .where(and(eq(activityLogs.entity, 'دسته‌بندی کالا'), eq(activityLogs.entityId, String(categoryId))))
    .orderBy(activityLogs.id);
  return rows.map(r => r.action);
}

async function softDeleteAuditCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const name = `دسته آزمون پ۵ ${ctx.tag}`;
  const created = await ctx.send('post', '/api/categories', { name, prefix: `Q${ctx.tag}`, type: 'raw_material', defaultUnit: 'عدد' });
  if (created.status !== 200) throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
  const id = created.body.id as number;
  const edited = await ctx.send('put', `/api/categories/${id}`, { name, prefix: `W${ctx.tag}`, type: 'raw_material', defaultUnit: 'متر' });
  if (edited.status !== 200) wrong.push(`edit ${edited.status}`);

  // a) a category with an active item is not deleted
  const item = await ctx.send('post', '/api/items', { type: 'raw_material', code: `W${ctx.tag}-1`, name: `کالای دسته ${ctx.tag}`, unit: 'متر', category: name });
  if (item.status !== 200) throw new Error(`item ${item.status} ${JSON.stringify(item.body)}`);
  const refused = await ctx.send('delete', `/api/categories/${id}`);
  if (refused.status !== 422) wrong.push(`delete with an active item answered ${refused.status}`);
  await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, item.body.id as number));

  // b) delete keeps the row, hides it from the list and records the old values
  const deleted = await ctx.send('delete', `/api/categories/${id}`);
  const [row] = await orm.select({ isDeleted: categories.isDeleted }).from(categories).where(eq(categories.id, id));
  const listed = ((await ctx.get('/api/categories')).body as Array<{ id: number }>).some(c => c.id === id);
  if (deleted.status !== 200 || row?.isDeleted !== 1 || listed) wrong.push(`delete answered ${deleted.status}, row ${JSON.stringify(row)}, listed ${listed}`);
  const again = await ctx.send('delete', `/api/categories/${id}`);
  if (again.status !== 404) wrong.push(`deleting a deleted category answered ${again.status}`);
  const actions = await auditActions(id);
  if (actions.join(',') !== 'CREATE,UPDATE,DELETE') wrong.push(`audit actions ${actions.join(',')}`);
  const [updateLog] = await orm.select({ details: activityLogs.details }).from(activityLogs)
    .where(and(eq(activityLogs.entity, 'دسته‌بندی کالا'), eq(activityLogs.entityId, String(id)), eq(activityLogs.action, 'UPDATE')));
  const changes = (updateLog?.details as { changes?: Record<string, unknown> } | undefined)?.changes ?? {};
  if (Object.keys(changes).sort().join(',') !== 'defaultUnit,prefix') wrong.push(`edit audit changes ${JSON.stringify(changes)}`);

  // c) reset brings a deleted default category back instead of adding a second one, and is audited
  const [def] = await orm.select().from(categories).where(and(eq(categories.name, 'سایر اقلام'), eq(categories.isDeleted, 0)));
  if (!def) throw new Error('default category «سایر اقلام» missing');
  await orm.update(categories).set({ isDeleted: 1 }).where(eq(categories.id, def.id));
  const reset = await ctx.send('post', '/api/categories/reset-defaults');
  const sameName = await orm.select({ id: categories.id, isDeleted: categories.isDeleted }).from(categories).where(eq(categories.name, 'سایر اقلام'));
  await orm.update(categories).set({ isDeleted: 0 }).where(eq(categories.id, def.id));
  if (reset.status !== 200 || sameName.length !== 1 || sameName[0].isDeleted !== 0) wrong.push(`reset answered ${reset.status} and left ${JSON.stringify(sameName)}`);
  const resetLogs = await orm.select({ details: activityLogs.details }).from(activityLogs).where(eq(activityLogs.entity, 'دسته‌بندی کالا'));
  if (!resetLogs.some(l => JSON.stringify(l.details).includes('"RESTORED"'))) wrong.push('no reset audit row recording the restored category');

  if (wrong.length > 0) throw new Error(wrong.join(' | '));
  return 'category soft-deleted (row kept, hidden, 404 on repeat); CREATE / UPDATE / DELETE audit rows; reset restores a deleted default and is audited';
}
