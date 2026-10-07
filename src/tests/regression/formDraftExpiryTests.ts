import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { formDrafts, users } from '../../db/schema.js';

/**
 * Package 16 (dashboard and shell), TD-676 / B16-12: a form draft lives 1 to 90 days, an expired draft is not returned,
 * and the daily cleanup soft-deletes expired drafts. On v9.0.294 `expiresInDays: -10` was saved and returned, a 31-day-old
 * draft with a past `expires_at` still offered «restore», `expiresInDays: 1e9` failed with «Invalid time value» and
 * nothing called the cleanup.
 */
export async function runFormDraftExpiryTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_form_draft_expiry_td_676';
  if (!shouldRun(id, 'td676', 'b16-12', 'drafts', 'package16')) return results;

  const name = 'v9.0.295: expired form drafts are not returned and the daily cleanup removes them (TD-676)';
  const tStart = Date.now();
  const draftIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { FormDraftService } = await import('../../services/drafts/formDraft.service.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const [user] = await orm.select({ id: users.id }).from(users).where(and(eq(users.username, 'pen_admin'), eq(users.isDeleted, 0)));
    const post = (body: Record<string, unknown>) => request(app).post('/api/drafts')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body);
    const getDraft = (key: string) => request(app).get(`/api/drafts/invoice?draftKey=${key}`).set('Cookie', admin.cookie);
    const wrong: string[] = [];

    for (const days of [-10, 0, 91, 1e9, 2.5]) {
      const res = await post({ entityType: 'invoice', draftKey: 'td676days', payload: { a: 1 }, expiresInDays: days });
      if (res.status !== 400) wrong.push(`expiresInDays ${days} answered ${res.status}`);
    }
    const saved = await post({ entityType: 'invoice', draftKey: 'td676live', payload: { a: 1 }, expiresInDays: 90 });
    if (saved.status !== 200) wrong.push(`expiresInDays 90 answered ${saved.status}`);
    else draftIds.push(saved.body.draft.id);

    const day = 24 * 60 * 60 * 1000;
    const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
    const rows = await orm.insert(formDrafts).values([
      { userId: user.id, entityType: 'invoice', draftKey: 'td676expired', payload: { a: 2 }, updatedAt: iso(-31), expiresAt: iso(-1), isDeleted: 0 },
      { userId: user.id, entityType: 'invoice', draftKey: 'td676legacyold', payload: { a: 3 }, updatedAt: iso(-31), expiresAt: null, isDeleted: 0 },
      { userId: user.id, entityType: 'invoice', draftKey: 'td676legacynew', payload: { a: 4 }, updatedAt: iso(-2), expiresAt: null, isDeleted: 0 },
    ]).returning({ id: formDrafts.id, draftKey: formDrafts.draftKey });
    draftIds.push(...rows.map(r => r.id));

    for (const key of ['td676expired', 'td676legacyold']) {
      const res = await getDraft(key);
      if (res.body?.draft) wrong.push(`expired draft ${key} was returned`);
    }
    for (const key of ['td676live', 'td676legacynew']) {
      const res = await getDraft(key);
      if (!res.body?.draft) wrong.push(`live draft ${key} was not returned`);
    }
    const listed = await request(app).get('/api/drafts?entityType=invoice').set('Cookie', admin.cookie);
    const listedKeys = (listed.body?.drafts ?? []).map((d: { draftKey: string }) => d.draftKey);
    if (listedKeys.some((k: string) => k === 'td676expired' || k === 'td676legacyold')) wrong.push(`the draft list holds expired drafts: ${listedKeys.join(',')}`);

    const removed = await Promise.resolve().then(() => FormDraftService.runCleanupExclusive()).catch((e: unknown) => { wrong.push(`cleanup: ${e instanceof Error ? e.message : String(e)}`); return null; });
    const after = await orm.select({ key: formDrafts.draftKey, isDeleted: formDrafts.isDeleted }).from(formDrafts).where(inArray(formDrafts.id, draftIds));
    const deletedKeys = after.filter(r => r.isDeleted === 1).map(r => r.key).sort();
    if (removed === null || removed < 2) wrong.push(`the cleanup removed ${removed} draft(s)`);
    if (deletedKeys.join(',') !== 'td676expired,td676legacyold') wrong.push(`after cleanup the deleted drafts are «${deletedKeys.join(',')}»`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'expiry outside 1..90 is 400; expired and 30-day-old legacy drafts are hidden and cleaned; live drafts stay',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (draftIds.length > 0) await orm.update(formDrafts).set({ isDeleted: 1 }).where(inArray(formDrafts.id, draftIds)).catch(() => undefined);
  }
  return results;
}
