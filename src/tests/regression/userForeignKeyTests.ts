import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { CONDITIONAL_CONSTRAINT_RULES, findMissingConditionalConstraints } from '../../services/system/conditionalConstraints.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v9.0.432 (TD-902, B01-31 / B01-32, decision t6 «الف»): the sixteen user columns the Drizzle schema declares as references
 * to users have database foreign keys (migration 0090) with their declared ON DELETE, validated on clean data; a row for a
 * missing user is refused, and a key left NOT VALID over a legacy orphan is listed and validated by hand after the fix.
 * Red on v9.0.431, where none of them existed and a notification for a missing user was stored.
 */

const USER_KEYS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['cheques', 'created_by_id'], ['daily_work_logs', 'user_id'], ['dead_letter_events', 'resolved_by'],
  ['event_action_rules', 'created_by'], ['form_drafts', 'user_id'], ['journal_vouchers', 'approved_by_id'],
  ['journal_vouchers', 'created_by_id'], ['notifications', 'sender_id'], ['notifications', 'user_id'], ['personnel', 'user_id'],
  ['piecework_logs', 'created_by_id'], ['piecework_payrolls', 'created_by_id'], ['piecework_task_rate_history', 'changed_by_user_id'],
  ['project_bom_allocations', 'user_id'], ['treasury_transactions', 'created_by_id'], ['webhook_subscriptions', 'created_by'],
];

type Row = Record<string, unknown>;

async function scenario(): Promise<string> {
  const problems: string[] = [];
  const admin = await sandboxAdminClient();

  const res = await orm.execute(sql`SELECT cl.relname AS tbl, a.attname AS col, c.conname, c.confdeltype, c.convalidated
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class rcl ON rcl.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND rcl.relname = 'users' AND c.connamespace = current_schema()::regnamespace`);
  const byKey = new Map((res.rows as Row[]).map(r => [`${r.tbl}.${r.col}`, r]));
  for (const [table, column] of USER_KEYS) {
    const fk = byKey.get(`${table}.${column}`);
    const expected = table === 'form_drafts' ? 'c' : 'a';
    if (!fk) problems.push(`${table}.${column} has no foreign key to users`);
    else if (fk.confdeltype !== expected || fk.convalidated !== true) problems.push(`${table}.${column}: ${JSON.stringify(fk)}`);
    if (!CONDITIONAL_CONSTRAINT_RULES.some(r => r.name === `fk_${table}_${column}` && r.addedNotValid)) {
      problems.push(`fk_${table}_${column} is not registered for the health check`);
    }
  }

  let refused = '';
  try {
    await orm.execute(sql`INSERT INTO notifications (user_id, title, message) VALUES (987902, 'TD-902 probe', 'missing user')`);
  } catch (err) {
    refused = String((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code ?? 'error');
  }
  if (refused !== '23503') problems.push(`a notification for a missing user was ${refused ? `refused with ${refused}` : 'stored'}`);
  assertNoProblems(problems);

  // a database whose legacy notifications name a removed sender: 0090 leaves the key NOT VALID and lists it
  const admins = await orm.execute(sql`SELECT id FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1`);
  const recipient = Number((admins.rows[0] as Row | undefined)?.id);
  await orm.execute(sql`ALTER TABLE notifications DROP CONSTRAINT fk_notifications_sender_id`);
  await orm.execute(sql`INSERT INTO notifications (user_id, sender_id, title, message) VALUES (${recipient}, 987902, 'TD-902 legacy', 'legacy sender')`);
  await orm.execute(sql`ALTER TABLE notifications ADD CONSTRAINT fk_notifications_sender_id FOREIGN KEY (sender_id) REFERENCES users(id) NOT VALID`);
  const listed = (await findMissingConditionalConstraints()).find(e => e.name === 'fk_notifications_sender_id');
  if (!listed || listed.state !== 'blocked' || listed.blockers !== 1 || listed.unvalidated !== true) problems.push(`the unvalidated key is listed as ${JSON.stringify(listed ?? null)}`);
  await orm.execute(sql`UPDATE notifications SET sender_id = NULL WHERE title = 'TD-902 legacy'`);
  const built = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(built.body?.built ?? []).includes('fk_notifications_sender_id')) problems.push(`the build after the fix answered ${JSON.stringify(built.body).slice(0, 200)}`);
  if ((await findMissingConditionalConstraints()).length !== 0) problems.push('constraints are still listed after the build');

  assertNoProblems(problems);
  return `${USER_KEYS.length} user keys carry their declared ON DELETE and are validated, a row for a missing user is refused, and a NOT VALID key over a legacy orphan was listed and validated after the fix`;
}

export async function runUserForeignKeyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_user_foreign_keys_td_902';
  if (shouldRun(id, 'TD-902', 'B01-31', 'B01-32')) {
    await runCase(results, id, 'v9.0.432: the user columns declared as references have database foreign keys (TD-902)', () => inFiscalSandbox(scenario));
  }
  return results;
}
