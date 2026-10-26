import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { appSettings, eventActionRules, notifications, users, userSessions } from '../../db/schema.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TREASURY_HIGH_VALUE_THRESHOLD_KEY } from '../../lib/settings/settingValues.js';
import { TREASURY_THRESHOLD_ENTITY } from '../../services/settings/treasuryThresholdChange.js';
import { createTestUser } from '../fixtures/factories.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * 10.3 package 5 (event and login privacy, decisions ت۴۷ items 3 to 5): the cheque status event carries no amount or
 * party name (the stored old event rows were masked by migration 0135, now folded into the v11 baseline), rules that read those fields are listed by the
 * health check, ended sign-in sessions older than 90 days are purged, and a change of the treasury high-value
 * threshold writes its own activity row and notifies the other system admins, while the default is never written.
 * Each case is red on v10.3.19.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const PARTY_NAME = 'طرف محرمانه رویداد چک';

async function runCase(results: TestCaseResult[], id: string, name: string, body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  const [me] = await orm.select({ id: users.id }).from(users).where(and(eq(users.username, 'pen_admin'), eq(users.isDeleted, 0)));
  return {
    userId: Number(me?.id),
    post: (url: string, body: object = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
  };
}

export async function runEventLoginPrivacyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const chequeId = 'reg_cheque_event_without_amount_or_party_10_3_package5';
  if (shouldRun(chequeId, 'package5', 'cheque', 'event', 'privacy')) {
    await runCase(results, chequeId, 'v10.3.20: a cheque status change writes ChequeStatusChanged without the amount or the party name, with the statuses and the party type and id (10.3 package 5)', async () => {
      const cheque = await ChequeLifecycleService.createCheque({
        type: 'received', chequeNumber: `PRV${tagOf()}`, amount: 7_654_321, partyName: PARTY_NAME,
        bankName: 'ملت', issueDate: '2026-03-01', dueDate: '2026-04-01', username: 'inv',
      });
      await ChequeLifecycleService.updateChequeStatus(cheque.id, { status: 'in_collection', username: 'inv' });
      const rows = (await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events WHERE event_type = 'ChequeStatusChanged' AND aggregate_id = $1`, [String(cheque.id)],
      )).rows;
      if (rows.length !== 1) throw new Error(`expected one ChequeStatusChanged, got ${rows.length}`);
      const p = rows[0].payload;
      const problems: string[] = [];
      for (const key of ['amount', 'partyName']) if (key in p) problems.push(`the event carries ${key}`);
      const text = JSON.stringify(p);
      if (text.includes('7654321') || text.includes(PARTY_NAME)) problems.push('the event text holds the amount or the party name');
      if (p.previousStatus !== 'received' || p.newStatus !== 'in_collection' || p.partyType !== 'customer' || !('partyId' in p)) {
        problems.push(`payload ${text.slice(0, 200)}`);
      }
      if (problems.length) throw new Error(problems.join(' | '));
      return 'statuses, party type and id; no amount or name';
    });
  }

  const maskId = 'reg_event_queue_masked_migration_0135_10_3_package5';
  if (shouldRun(maskId, 'package5', 'event', 'privacy', 'settings')) {
    await runCase(results, maskId, 'v10.3.20: a user can keep the settings change notice out of the messenger (10.3 package 5)', async () => {
      const problems: string[] = [];
      const user = await createTestUser({ role: 'admin' });
      await pool.query(`INSERT INTO user_notification_preferences (user_id, category, send_to_messenger) VALUES ($1, 'settings_change', 0)`, [user.id])
        .catch((err: unknown) => problems.push(`a settings_change preference was refused: ${err instanceof Error ? err.message : String(err)}`));
      if (problems.length) throw new Error(problems.join(' | '));
      return 'a settings_change preference without the messenger is stored';
    });
  }

  const healthId = 'reg_cheque_rule_private_fields_health_10_3_package5';
  if (shouldRun(healthId, 'package5', 'cheque', 'rule', 'health')) {
    await runCase(results, healthId, 'v10.3.20: the financial health check lists the automatic rules of the cheque status event that read its amount or party name, and the «*» rules that read the party name, by how they now behave, and leaves them as saved (10.3 package 5)', async () => {
      const { findChequePrivateFieldRules, buildChequePrivateFieldRuleHealthTest } = await import('../../services/accounting/chequeRuleFieldHealth.js');
      const tag = tagOf();
      const inserted = await orm.insert(eventActionRules).values([
        { name: `P5 amount ${tag}`, eventType: 'ChequeStatusChanged', actionType: 'audit_log', conditionsJson: [{ field: 'payload.amount', operator: 'gte', value: 1 }], actionConfigJson: {}, isActive: 1 },
        { name: `P5 party ${tag}`, eventType: 'ChequeStatusChanged', actionType: 'audit_log', conditionsJson: [{ field: 'payload.partyName', operator: 'neq', value: 'x' }], actionConfigJson: {}, isActive: 1 },
        { name: `P5 text ${tag}`, eventType: '*', actionType: 'audit_log', conditionsJson: [], actionConfigJson: { descriptionTemplate: 'طرف {{payload.partyName}}' }, isActive: 0 },
        { name: `P5 starAmount ${tag}`, eventType: '*', actionType: 'audit_log', conditionsJson: [{ field: 'payload.amount', operator: 'gt', value: 1 }], actionConfigJson: {}, isActive: 1 },
        { name: `P5 status ${tag}`, eventType: 'ChequeStatusChanged', actionType: 'audit_log', conditionsJson: [{ field: 'payload.newStatus', operator: 'eq', value: 'passed' }], actionConfigJson: {}, isActive: 1 },
      ]).returning({ id: eventActionRules.id });
      try {
        const listed = (await findChequePrivateFieldRules()).filter(r => r.name.endsWith(tag));
        const names = listed.map(r => `${r.name.split(' ')[1]}:${r.fields.join('+')}:${r.use}`).sort().join(',');
        const expected = 'amount:payload.amount:never_matches,party:payload.partyName:always_matches,text:payload.partyName:text_only';
        if (names !== expected) throw new Error(`the health check listed "${names}", expected "${expected}"`);
        const test = buildChequePrivateFieldRuleHealthTest(listed);
        if (test.id !== 'event_rule_cheque_private_fields' || test.status !== 'warning' || test.count !== 3 || !(test.scoreImpact < 0)) {
          throw new Error(`the health test is ${test.id} ${test.status} with ${test.count}, score ${test.scoreImpact}`);
        }
        return 'amount, party and text rules listed by kind; the «*» amount rule (treasury list) and the status rule not';
      } finally {
        await orm.delete(eventActionRules).where(inArray(eventActionRules.id, inserted.map(r => r.id)));
      }
    });
  }

  const purgeId = 'reg_ended_sessions_purge_10_3_package5';
  if (shouldRun(purgeId, 'package5', 'sessions', 'purge')) {
    await runCase(results, purgeId, 'v10.3.20: the daily purge removes sign-in sessions closed or expired more than 90 days ago once expired, and keeps open, recent and still-valid ones (10.3 package 5)', async () => {
      const { purgeEndedSessions } = await import('../../services/auth/sessionPurge.js');
      const user = await createTestUser({ role: 'admin' });
      const tag = tagOf();
      const ago = (days: number) => sql`(now() AT TIME ZONE 'UTC') - make_interval(days => ${days})` as unknown as string;
      const rows: Array<{ sid: string; expiresAt: string; revokedAt?: string; gone: boolean }> = [
        { sid: `p5_closed_old_${tag}`, revokedAt: ago(100), expiresAt: ago(95), gone: true },
        { sid: `p5_closed_old_valid_${tag}`, revokedAt: ago(100), expiresAt: ago(-5), gone: false },
        { sid: `p5_expired_old_${tag}`, expiresAt: ago(91), gone: true },
        { sid: `p5_expired_recent_${tag}`, expiresAt: ago(10), gone: false },
        { sid: `p5_closed_recent_${tag}`, revokedAt: ago(10), expiresAt: ago(5), gone: false },
        { sid: `p5_open_${tag}`, expiresAt: ago(-30), gone: false },
      ];
      await orm.insert(userSessions).values(rows.map(r => ({
        userId: user.id, sid: r.sid, tokenVersion: 0, expiresAt: r.expiresAt, ...(r.revokedAt ? { revokedAt: r.revokedAt, revokeReason: 'logout' } : {}),
      })));
      const removed = await purgeEndedSessions();
      const left = new Set((await orm.select({ sid: userSessions.sid }).from(userSessions).where(eq(userSessions.userId, user.id))).map(r => r.sid));
      const wrong = rows.filter(r => left.has(r.sid) === r.gone).map(r => `${r.sid.replace(`_${tag}`, '')} ${r.gone ? 'kept' : 'removed'}`);
      if (wrong.length) throw new Error(wrong.join(' | '));
      if (removed < 2) throw new Error(`the purge reported ${removed} rows`);
      return `${removed} ended rows removed; open, recent and still valid kept`;
    });
  }

  const thresholdId = 'reg_treasury_threshold_change_audit_notice_10_3_package5';
  if (shouldRun(thresholdId, 'package5', 'treasury', 'threshold', 'settings', 'audit')) {
    await runCase(results, thresholdId, 'v10.3.20: saving settings with the default treasury high-value threshold writes no row, and a change writes its own activity row with the threshold before and after and notifies every other system admin, not the one who changed it (10.3 package 5)', async () => {
      const admin = await adminClient();
      const other = await createTestUser({ role: 'admin' });
      await orm.delete(appSettings).where(eq(appSettings.key, TREASURY_HIGH_VALUE_THRESHOLD_KEY));
      try {
        const problems: string[] = [];
        const kept = await admin.post('/api/settings', { settings: [{ key: TREASURY_HIGH_VALUE_THRESHOLD_KEY, value: '500000000' }] });
        if (kept.status !== 200) throw new Error(`saving the default returned ${kept.status} ${JSON.stringify(kept.body).slice(0, 200)}`);
        const stored = await orm.select().from(appSettings).where(eq(appSettings.key, TREASURY_HIGH_VALUE_THRESHOLD_KEY));
        if (stored.length !== 0) problems.push(`the default threshold was written: ${JSON.stringify(stored)}`);

        const raised = await admin.post('/api/settings', { settings: [{ key: TREASURY_HIGH_VALUE_THRESHOLD_KEY, value: '۷۰۰۰۰۰۰۰۰' }] });
        if (raised.status !== 200) throw new Error(`raising the threshold returned ${raised.status}`);
        const log = await pool.query<{ details: Record<string, unknown>; description: string }>(
          `SELECT details, description FROM activity_logs WHERE entity = $1 ORDER BY id DESC LIMIT 1`, [TREASURY_THRESHOLD_ENTITY]);
        const d = log.rows[0]?.details ?? {};
        if (Number(d.previousThreshold) !== 500_000_000 || Number(d.newThreshold) !== 700_000_000 || d.previousWasDefault !== true) {
          problems.push(`activity row ${JSON.stringify(log.rows[0] ?? null).slice(0, 300)}`);
        }
        const notices = await orm.select({ userId: notifications.userId, title: notifications.title }).from(notifications)
          .where(and(inArray(notifications.userId, [other.id, admin.userId]), eq(notifications.title, 'تغییر آستانه تراکنش کلان خزانه')));
        if (!notices.some(n => n.userId === other.id)) problems.push('the other system admin got no notice');
        if (notices.some(n => n.userId === admin.userId)) problems.push('the admin who changed it was notified');
        if (problems.length) throw new Error(problems.join(' | '));
        return 'default not written; change audited with before and after, other admin notified';
      } finally {
        await orm.delete(appSettings).where(eq(appSettings.key, TREASURY_HIGH_VALUE_THRESHOLD_KEY));
        const { invalidateSettingsCache } = await import('../../lib/memoryCache.js');
        invalidateSettingsCache();
      }
    });
  }

  return results;
}
