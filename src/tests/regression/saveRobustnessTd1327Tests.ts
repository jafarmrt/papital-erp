import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { dailyWorkLogs, formDrafts } from '../../db/schema.js';
import { DRAFT_MAX_PER_USER } from '../../lib/drafts/draftRules.js';
import { makeDailyLogTestCtx, type DailyLogTestCtx } from './dailyLogAccessTests.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * v10.2 package 11 part 4b (TD-1327): a daily log edit carries the version it was built from (OBS-R2-58) and a user has
 * one live form draft per type and key, at most `DRAFT_MAX_PER_USER`, deleted only by its owner (OBS-R2-98). Through the
 * real Express routes; each case is red on the code before its fix.
 */
export async function runSaveRobustnessTd1327Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: DailyLogTestCtx, draftUserIds: number[]) => Promise<string>]> = [
    ['reg_daily_log_version_td_1327',
      'v10.2.32: a daily log edit without its version is 400 and with a stale version 409 OCC_CONFLICT, leaving the log unchanged; the right version saves and raises it (TD-1327, OBS-R2-58)',
      ['td1327', 'obs-r2-58', 'daily_log', 'package11'], dailyLogVersionCase],
    ['reg_form_draft_one_live_key_td_1327',
      'v10.2.32: concurrent saves of one form keep one live draft, a user keeps at most the newest 50 drafts, and deleting a missing or another user\'s draft is 404 (TD-1327, OBS-R2-98)',
      ['td1327', 'obs-r2-98', 'drafts', 'package11'], formDraftCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    const ctx = await makeDailyLogTestCtx();
    const draftUserIds: number[] = [];
    try {
      const details = await run(ctx, draftUserIds);
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      if (draftUserIds.length > 0) await orm.delete(formDrafts).where(inArray(formDrafts.userId, draftUserIds)).catch(() => undefined);
      await ctx.cleanup();
    }
  }
  return results;
}

const base = { title: 'td1327 log', content: 'td1327 first text', work_mode: 'onsite', visibility: 'private', date: '2026-09-20', start_time: '08:00', end_time: '10:00' };

async function dailyLogVersionCase(ctx: DailyLogTestCtx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const created = await ctx.send(author, 'post', '/api/daily-logs', base);
  const id = Number(created.body?.id ?? created.body?.data?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`create answered ${created.status} without an id`);
  const stored = async () => (await orm.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, id)))[0];

  const missing = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { content: 'td1327 without version' });
  if (missing.status !== 400) wrong.push(`an edit without a version answered ${missing.status}`);
  const stale = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { version: 2, content: 'td1327 stale' });
  if (stale.status !== 409 || stale.body?.code !== 'OCC_CONFLICT') wrong.push(`an edit at version 2 answered ${stale.status} ${stale.body?.code}`);
  if ((await stored()).content !== base.content) wrong.push(`a refused edit changed the text to «${(await stored()).content}»`);

  const saved = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { version: 1, content: 'td1327 second text' });
  if (saved.status !== 200) wrong.push(`an edit at version 1 answered ${saved.status}`);
  const after = await stored();
  if (after.content !== 'td1327 second text' || after.version !== 2) wrong.push(`after the edit the log is ${JSON.stringify({ content: after.content, version: after.version })}`);
  // the second of two edits made from the same opened form is refused, not saved over the first
  const late = await ctx.send(author, 'put', `/api/daily-logs/${id}`, { version: 1, content: 'td1327 late text' });
  if (late.status !== 409) wrong.push(`a second edit from the same version answered ${late.status}`);
  if ((await stored()).content !== 'td1327 second text') wrong.push('the late edit replaced the first one');
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'no version 400, stale version 409 and the log unchanged, version 1 saves and becomes 2, a second edit from version 1 is 409';
}

async function formDraftCase(ctx: DailyLogTestCtx, draftUserIds: number[]): Promise<string> {
  const wrong: string[] = [];
  const owner = await ctx.userWith([]);
  const other = await ctx.userWith([]);
  draftUserIds.push(owner.id, other.id);
  const live = (userId: number) => orm.select({ id: formDrafts.id, draftKey: formDrafts.draftKey, payload: formDrafts.payload })
    .from(formDrafts).where(and(eq(formDrafts.userId, userId), eq(formDrafts.isDeleted, 0)));

  // five saves of one form at once leave one live draft
  const saves = await Promise.all(Array.from({ length: 5 }, (_, n) =>
    ctx.send(owner, 'post', '/api/drafts', { entityType: 'invoice', draftKey: 'td1327race', payload: { n } })));
  const statuses = saves.map(r => r.status);
  if (statuses.some(s => s !== 200)) wrong.push(`concurrent saves answered ${statuses.join(',')}`);
  const raced = (await live(owner.id)).filter(r => r.draftKey === 'td1327race');
  if (raced.length !== 1) wrong.push(`concurrent saves left ${raced.length} live drafts`);
  const again = await ctx.send(owner, 'post', '/api/drafts', { entityType: 'invoice', draftKey: 'td1327race', payload: { n: 9 } });
  if (again.body?.action !== 'updated') wrong.push(`a later save answered action ${again.body?.action}`);

  // at most the newest DRAFT_MAX_PER_USER live drafts; the oldest are set aside
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await orm.insert(formDrafts).values(Array.from({ length: DRAFT_MAX_PER_USER + 5 }, (_, n) => ({
    userId: owner.id, entityType: 'invoice', draftKey: `td1327old${n}`, payload: { n }, updatedAt: old, isDeleted: 0,
  })));
  const capped = await ctx.send(owner, 'post', '/api/drafts', { entityType: 'invoice', draftKey: 'td1327new', payload: { n: 1 } });
  if (capped.status !== 200) wrong.push(`a save over the cap answered ${capped.status}`);
  const kept = await live(owner.id);
  if (kept.length !== DRAFT_MAX_PER_USER) wrong.push(`the user keeps ${kept.length} live drafts`);
  if (!kept.some(r => r.draftKey === 'td1327new') || !kept.some(r => r.draftKey === 'td1327race')) wrong.push('the newest drafts were set aside');

  // only the owner deletes a live draft; a missing, deleted or another user's draft is 404
  const target = kept.find(r => r.draftKey === 'td1327new');
  if (target) {
    const foreign = await ctx.send(other, 'delete', `/api/drafts/id/${target.id}`);
    if (foreign.status !== 404) wrong.push(`another user's delete answered ${foreign.status}`);
    if (!(await live(owner.id)).some(r => r.id === target.id)) wrong.push('another user deleted the draft');
    const own = await ctx.send(owner, 'delete', `/api/drafts/id/${target.id}`);
    if (own.status !== 200) wrong.push(`the owner's delete answered ${own.status}`);
    const twice = await ctx.send(owner, 'delete', `/api/drafts/id/${target.id}`);
    if (twice.status !== 404) wrong.push(`deleting a deleted draft answered ${twice.status}`);
  }
  const absent = await ctx.send(owner, 'delete', '/api/drafts/id/2147483000');
  if (absent.status !== 404) wrong.push(`deleting a missing draft answered ${absent.status}`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `five concurrent saves keep one draft, ${DRAFT_MAX_PER_USER} newest kept, another user's, a deleted and a missing draft 404`;
}
