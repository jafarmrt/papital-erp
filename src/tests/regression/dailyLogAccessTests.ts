import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, dailyWorkLogs, notifications, productionProjects, roles, users } from '../../db/schema.js';
import { invalidateRoleCache } from '../../lib/memoryCache.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/**
 * Package 13 (daily logs and attachments), PR A: access and privacy of daily work logs.
 * Each case reproduces a finding of the package 13 review on the real Express routes.
 */
export async function runDailyLogAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (ctx: Ctx) => Promise<string>]> = [
    ['sec_daily_log_manage_by_permission_td_626',
      'v9.0.231: reviewing, editing and deleting another user\'s daily log needs daily_logs.manage_all, not the role code, and is audited (TD-626)',
      ['td626', 'daily_log', 'permission', 'package13'], manageByPermissionCase],
    ['reg_daily_log_private_mention_no_notification_td_633',
      'v9.0.233: a mention in a private or managers-only daily log sends no notification (TD-633)',
      ['td633', 'daily_log', 'mention', 'package13'], privateMentionCase],
    ['reg_daily_log_mentions_validated_atomic_td_629',
      'v9.0.234: daily log mentions, allowed users and project are validated before anything is written, and the log, its notifications and its audit row commit together (TD-629)',
      ['td629', 'daily_log', 'mention', 'package13'], mentionsValidatedCase],
    ['reg_daily_log_public_visibility_removed_td_900',
      'v9.0.236: the public daily log visibility is gone: refused on input, default mentioned_only, and the data migration moves public, all and empty logs to mentioned_only and records the old value (TD-900)',
      ['td900', 'daily_log', 'visibility', 'package13'], publicVisibilityRemovedCase],
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
      await ctx.cleanup();
    }
  }
  return results;
}

interface Session { cookie: string; csrfToken: string }
export interface Actor { id: number; username: string; session: Session; roleCode: string }

export interface Ctx {
  /** a user with a new role holding exactly these permissions */
  userWith(permissions: string[], roleCode?: string): Promise<Actor>;
  send(actor: Actor, method: 'get' | 'post' | 'put' | 'delete', url: string, body?: unknown): Promise<request.Response>;
  insertLog(author: Actor, values: Partial<typeof dailyWorkLogs.$inferInsert>): Promise<number>;
  logIds: number[];
  cleanup(): Promise<void>;
}

export async function makeCtx(): Promise<Ctx> {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const { createTestRole, createTestUser } = await import('../fixtures/factories.js');
  const app = await getTestApp();
  const roleIds: number[] = [];
  const userIds: number[] = [];
  const logIds: number[] = [];
  const ctx: Ctx = {
    logIds,
    async userWith(permissions, roleCode) {
      let code = roleCode;
      if (!code) {
        const role = await createTestRole({ permissions });
        roleIds.push(role.id);
        code = role.code;
      }
      const user = await createTestUser({ role: code });
      userIds.push(user.id);
      return { id: user.id, username: user.username, roleCode: code ?? '', session: await loginTestUserWithSession(app, user.username) };
    },
    send(actor, method, url, body) {
      const r = request(app)[method](url).set('Cookie', actor.session.cookie).set('x-csrf-token', actor.session.csrfToken);
      return body === undefined ? r : r.send(body as object);
    },
    async insertLog(author, values) {
      const [row] = await orm.insert(dailyWorkLogs).values({
        userId: author.id, username: author.username, userFullName: author.username, date: '2026-10-01', dateIso: '2026-10-01',
        title: 'p13 log', content: 'p13 content', visibility: 'private', ...values,
      }).returning({ id: dailyWorkLogs.id });
      logIds.push(row.id);
      return row.id;
    },
    async cleanup() {
      if (userIds.length > 0) {
        await orm.delete(notifications).where(inArray(notifications.userId, userIds)).catch(() => undefined);
        await orm.delete(notifications).where(inArray(notifications.senderId, userIds)).catch(() => undefined);
        const authored = await orm.select({ id: dailyWorkLogs.id }).from(dailyWorkLogs).where(inArray(dailyWorkLogs.userId, userIds));
        logIds.push(...authored.map(r => r.id));
      }
      if (logIds.length > 0) {
        await pool.query('DELETE FROM daily_log_visibility_repairs WHERE daily_log_id = ANY($1::int[])', [logIds]).catch(() => undefined);
        await orm.delete(dailyWorkLogs).where(inArray(dailyWorkLogs.id, logIds)).catch(() => undefined);
      }
      if (userIds.length > 0) await orm.update(users).set({ isDeleted: 1 }).where(inArray(users.id, userIds)).catch(() => undefined);
      if (roleIds.length > 0) await orm.delete(roles).where(inArray(roles.id, roleIds)).catch(() => undefined);
    },
  };
  return ctx;
}

const auditRows = (entityId: number) => orm.select().from(activityLogs)
  .where(and(eq(activityLogs.entity, 'گزارش کار روزانه'), eq(activityLogs.entityId, String(entityId))));

async function manageByPermissionCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const supervisor = await ctx.userWith(['daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all']);

  // a) a role with daily_logs.manage_all whose code is not "manager" reviews, edits and deletes another user's log
  const logA = await ctx.insertLog(author, { title: 'p13 private A', content: 'secret A' });
  const review = await ctx.send(supervisor, 'put', `/api/daily-logs/${logA}/review`, { manager_notes: 'well done' });
  if (review.status !== 200) wrong.push(`manage_all review answered ${review.status}`);
  const edit = await ctx.send(supervisor, 'put', `/api/daily-logs/${logA}`, { title: 'p13 private A edited' });
  if (edit.status !== 200) wrong.push(`manage_all edit answered ${edit.status}`);
  const del = await ctx.send(supervisor, 'delete', `/api/daily-logs/${logA}`);
  if (del.status !== 200) wrong.push(`manage_all delete answered ${del.status}`);
  const actions = (await auditRows(logA)).map(r => r.action).sort();
  if (JSON.stringify(actions) !== JSON.stringify(['DELETE', 'REVIEW', 'UPDATE'])) wrong.push(`audit actions ${JSON.stringify(actions)}`);
  const updateAudit = (await auditRows(logA)).find(r => r.action === 'UPDATE');
  const changes = (updateAudit?.details as { changes?: Record<string, unknown> } | undefined)?.changes ?? {};
  if (!('title' in changes)) wrong.push(`edit audit has no title change: ${JSON.stringify(updateAudit?.details)}`);

  // b) the role code "manager" without daily_logs.manage_all gets nothing more than any other reader
  const [managerRole] = await orm.select().from(roles).where(eq(roles.code, 'manager'));
  if (!managerRole) throw new Error('template role manager is missing in the test schema');
  const savedPermissions = managerRole.permissions;
  await orm.update(roles).set({ permissions: ['daily_logs.view', 'daily_logs.create'] }).where(eq(roles.id, managerRole.id));
  invalidateRoleCache('manager');
  try {
    const manager = await ctx.userWith([], 'manager');
    const logB = await ctx.insertLog(author, { title: 'p13 private B', content: 'secret B' });
    const mReview = await ctx.send(manager, 'put', `/api/daily-logs/${logB}/review`, { manager_notes: 'x' });
    if (mReview.status !== 403) wrong.push(`manager without manage_all review answered ${mReview.status}${mReview.body?.content ? ` and leaked «${mReview.body.content}»` : ''}`);
    const mGet = await ctx.send(manager, 'get', `/api/daily-logs/${logB}`);
    if (mGet.status !== 404) wrong.push(`manager without manage_all read a private log: ${mGet.status}`);
    const mEdit = await ctx.send(manager, 'put', `/api/daily-logs/${logB}`, { content: 'rewritten by manager' });
    if (mEdit.status !== 403) wrong.push(`manager without manage_all edit answered ${mEdit.status}`);
    const mDelete = await ctx.send(manager, 'delete', `/api/daily-logs/${logB}`);
    if (mDelete.status !== 403) wrong.push(`manager without manage_all delete answered ${mDelete.status}`);
    const [stored] = await orm.select().from(dailyWorkLogs).where(eq(dailyWorkLogs.id, logB));
    if (stored.content !== 'secret B' || stored.isDeleted !== 0 || stored.status === 'reviewed') wrong.push(`log B changed: ${JSON.stringify({ content: stored.content, isDeleted: stored.isDeleted, status: stored.status })}`);
  } finally {
    await orm.update(roles).set({ permissions: savedPermissions }).where(eq(roles.id, managerRole.id));
    invalidateRoleCache('manager');
  }

  // c) the author still edits and deletes their own log without daily_logs.manage_all
  const logC = await ctx.insertLog(author, { title: 'p13 own C' });
  const own = await ctx.send(author, 'put', `/api/daily-logs/${logC}`, { title: 'p13 own C edited' });
  if (own.status !== 200) wrong.push(`author edit answered ${own.status}`);
  const ownReview = await ctx.send(author, 'put', `/api/daily-logs/${logC}/review`, { manager_notes: 'self' });
  if (ownReview.status !== 403) wrong.push(`author without manage_all review answered ${ownReview.status}`);

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'manage_all role (code not manager) reviewed, edited and deleted with UPDATE/REVIEW/DELETE audit rows; manager code without the permission got 403/404 and changed nothing; the author edits their own log';
}

async function privateMentionCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const reader = await ctx.userWith(['daily_logs.view']);
  const notified = async () => (await orm.select().from(notifications).where(eq(notifications.userId, reader.id))).length;
  const body = { start_time: '08:00', end_time: '16:00', work_mode: 'onsite', content: 'p13 mention', mentions: [reader.id] };

  // v10.0.137 (TD-1225): logs of one author on one day take separate times
  for (const [visibility, start_time, end_time] of [['private', '08:00', '10:00'], ['managers', '10:00', '12:00']]) {
    const before = await notified();
    const res = await ctx.send(author, 'post', '/api/daily-logs', { ...body, title: `p13 ${visibility} title`, visibility, start_time, end_time });
    if (res.status !== 200) wrong.push(`${visibility} log answered ${res.status}`);
    const after = await notified();
    if (after !== before) wrong.push(`${visibility} log notified the mentioned reader (${after - before})`);
  }
  const before = await notified();
  const res = await ctx.send(author, 'post', '/api/daily-logs', { ...body, title: 'p13 mentioned title', visibility: 'mentioned_only', start_time: '12:00', end_time: '14:00' });
  if (res.status !== 200) wrong.push(`mentioned_only log answered ${res.status}`);
  if (await notified() !== before + 1) wrong.push('mentioned_only log did not notify the mentioned reader');
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'private and managers-only logs notified nobody; a mentioned_only log notified the mentioned reader once';
}

async function mentionsValidatedCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const reader = await ctx.userWith(['daily_logs.view']);
  const count = async () => (await orm.select({ n: sql<number>`count(*)::int` }).from(dailyWorkLogs).where(eq(dailyWorkLogs.userId, author.id)))[0].n;
  const base = { title: 'p13 validation', content: 'p13 validation', start_time: '08:00', end_time: '16:00', visibility: 'mentioned_only' };

  const notNumber = await ctx.send(author, 'post', '/api/daily-logs', { ...base, mentions: ['abc'] });
  if (notNumber.status !== 400) wrong.push(`mentions ["abc"] answered ${notNumber.status}`);
  const missingUser = await ctx.send(author, 'post', '/api/daily-logs', { ...base, mentions: [987654321] });
  if (missingUser.status !== 422) wrong.push(`unknown mentioned user answered ${missingUser.status}`);
  const missingAllowed = await ctx.send(author, 'post', '/api/daily-logs', { ...base, visibility: 'custom', allowed_users: [987654322] });
  if (missingAllowed.status !== 422) wrong.push(`unknown allowed user answered ${missingAllowed.status}`);
  const missingProject = await ctx.send(author, 'post', '/api/daily-logs', { ...base, project_id: 987654321, project_name: 'fake project' });
  if (missingProject.status !== 422) wrong.push(`unknown project answered ${missingProject.status}`);
  if (await count() !== 0) wrong.push(`${await count()} log(s) stored by refused requests`);
  const orphan = await orm.select().from(notifications).where(inArray(notifications.userId, [987654321, 987654322]));
  if (orphan.length > 0) wrong.push(`${orphan.length} notification(s) for users that do not exist`);

  // a valid project takes its title from the project, not from the body
  const [project] = await orm.insert(productionProjects).values({ projectCode: `P13-${Date.now()}`, title: 'p13 real project' }).returning();
  try {
    const ok = await ctx.send(author, 'post', '/api/daily-logs', { ...base, mentions: [String(reader.id)], project_id: project.id, project_name: 'fake name' });
    if (ok.status !== 200) wrong.push(`valid log answered ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
    else {
      if (ok.body.project_name !== 'p13 real project') wrong.push(`project_name «${ok.body.project_name}» came from the body`);
      if (JSON.stringify(ok.body.mentions) !== JSON.stringify([reader.id])) wrong.push(`mentions stored as ${JSON.stringify(ok.body.mentions)}`);
      const notes = await orm.select().from(notifications).where(eq(notifications.userId, reader.id));
      if (notes.length !== 1) wrong.push(`valid log sent ${notes.length} notifications`);
      if ((await auditRows(Number(ok.body.id))).length !== 1) wrong.push('valid log has no CREATE audit row');
    }
    // editing a log notifies only users mentioned for the first time
    const second = await ctx.userWith(['daily_logs.view']);
    const edit = await ctx.send(author, 'put', `/api/daily-logs/${ok.body.id}`, { mentions: [reader.id, second.id] });
    if (edit.status !== 200) wrong.push(`edit answered ${edit.status}`);
    const readerNotes = await orm.select().from(notifications).where(eq(notifications.userId, reader.id));
    const secondNotes = await orm.select().from(notifications).where(eq(notifications.userId, second.id));
    if (readerNotes.length !== 1 || secondNotes.length !== 1) wrong.push(`after edit: reader ${readerNotes.length}, new mention ${secondNotes.length} notifications (expected 1 and 1)`);
  } finally {
    await orm.delete(dailyWorkLogs).where(eq(dailyWorkLogs.projectId, project.id)).catch(() => undefined);
    await orm.delete(productionProjects).where(eq(productionProjects.id, project.id)).catch(() => undefined);
  }
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'non-numeric mention 400; unknown user, allowed user and project 422 with no log and no notification; a valid log stores the project title, notifies once and is audited; an edit notifies only the new mention';
}

async function publicVisibilityRemovedCase(ctx: Ctx): Promise<string> {
  const wrong: string[] = [];
  const author = await ctx.userWith(['daily_logs.view', 'daily_logs.create']);
  const reader = await ctx.userWith(['daily_logs.view']);
  const base = { title: 'p13 visibility', content: 'p13 visibility', start_time: '08:00', end_time: '16:00' };

  for (const visibility of ['public', 'all']) {
    const res = await ctx.send(author, 'post', '/api/daily-logs', { ...base, visibility });
    if (res.status !== 400) wrong.push(`visibility ${visibility} answered ${res.status}`);
  }
  const noVisibility = await ctx.send(author, 'post', '/api/daily-logs', base);
  if (noVisibility.status !== 200 || noVisibility.body.visibility !== 'mentioned_only') wrong.push(`no visibility stored as «${noVisibility.body?.visibility}» (${noVisibility.status})`);
  else {
    const byReader = await ctx.send(reader, 'get', `/api/daily-logs/${noVisibility.body.id}`);
    if (byReader.status !== 404) wrong.push(`a log saved without visibility is readable by another user (${byReader.status})`);
  }

  // the data migration: legacy public, all and empty logs move to mentioned_only and their old value is recorded
  const legacyIds: Record<string, number> = {};
  for (const legacy of ['public', 'all', '']) {
    legacyIds[legacy || 'empty'] = await ctx.insertLog(author, { title: `p13 legacy ${legacy || 'empty'}`, visibility: 'private' });
  }
  const privateId = await ctx.insertLog(author, { title: 'p13 legacy private', visibility: 'private' });
  // the legacy values cannot be written any more (CHECK), so they are written with the constraint switched off
  await pool.query('ALTER TABLE daily_work_logs DROP CONSTRAINT IF EXISTS chk_daily_work_logs_visibility');
  await pool.query('ALTER TABLE daily_work_logs ALTER COLUMN visibility DROP NOT NULL');
  await pool.query(`UPDATE daily_work_logs SET visibility = 'public' WHERE id = $1`, [legacyIds.public]);
  await pool.query(`UPDATE daily_work_logs SET visibility = 'all' WHERE id = $1`, [legacyIds.all]);
  await pool.query('UPDATE daily_work_logs SET visibility = NULL WHERE id = $1', [legacyIds.empty]);
  const migrationFile = fs.readdirSync(path.resolve(process.cwd(), 'drizzle')).find(f => /^\d{4}_daily_log_visibility\.sql$/.test(f));
  if (!migrationFile) throw new Error('migration *_daily_log_visibility.sql not found');
  const sqlText = fs.readFileSync(path.resolve(process.cwd(), 'drizzle', migrationFile), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint')) await pool.query(stmt);

  const rows = await orm.select({ id: dailyWorkLogs.id, visibility: dailyWorkLogs.visibility }).from(dailyWorkLogs)
    .where(inArray(dailyWorkLogs.id, [...Object.values(legacyIds), privateId]));
  for (const r of rows) {
    const expected = r.id === privateId ? 'private' : 'mentioned_only';
    if (r.visibility !== expected) wrong.push(`log ${r.id} visibility «${r.visibility}» after the migration, expected ${expected}`);
  }
  const recorded = await pool.query('SELECT daily_log_id, old_visibility FROM daily_log_visibility_repairs WHERE daily_log_id = ANY($1::int[]) ORDER BY daily_log_id', [[...Object.values(legacyIds), privateId]]);
  const recordedMap = Object.fromEntries(recorded.rows.map((r: { daily_log_id: number; old_visibility: string | null }) => [r.daily_log_id, r.old_visibility]));
  if (recordedMap[legacyIds.public] !== 'public' || recordedMap[legacyIds.all] !== 'all' || !(legacyIds.empty in recordedMap) || privateId in recordedMap) {
    wrong.push(`recorded old values ${JSON.stringify(recordedMap)}`);
  }
  const check = await pool.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'chk_daily_work_logs_visibility'`);
  if (check.rows[0]?.convalidated !== true) wrong.push('the visibility CHECK is missing or not validated after the migration');

  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return 'public and all refused with 400; a log without visibility is mentioned_only and hidden from others; the migration moved public, all and empty logs to mentioned_only, recorded the old values and validated the CHECK';
}

/** Shared with the package 13 PR B read tests */
export { makeCtx as makeDailyLogTestCtx };
export type DailyLogTestCtx = Ctx;
