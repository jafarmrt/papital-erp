import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, roles, users, webhookSubscriptions, workflowDefinitions, workflowTransitions } from '../../db/schema.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * v10.2.0, package 1 of the 10.2 start plan (TD-1289): urgent fixes found after the 10.1 upgrade.
 * - the item list with a negative or huge page answered 500 (negative OFFSET);
 * - users.is_deleted took NULL, and migration 0126 makes it NOT NULL DEFAULT 0 without breaking the username key;
 * - webhook retry limits outside 1 to 10 saved before v10.1.66 are brought to the number delivery already used;
 * - a restore racing a new user with the same username key answered a raw database error, not the friendly 409;
 * - workflow actions still asking the removed key of migration 0123 ask audit.apply after the boot step.
 * Each case is red on v10.1.72.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;

const MIGRATION_TAG = '0126_users_deleted_flag_webhook_retry_limits';
const REMOVED_KEY = ['audit', 'create'].join('.');
const WORKFLOW_DESIGN_ENTITY = 'طرح گردش کار';
const REPLACEMENT_TITLE = 'اعمال و تسویه مغایرت';
const tail = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

class Rollback extends Error {}

async function runCase(results: TestCaseResult[], id: string, name: string, details: string, body: (wrong: string[]) => Promise<void>) {
  const tStart = Date.now();
  const wrong: string[] = [];
  try {
    await body(wrong);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

const migrationStatements = () => fs.readFileSync(path.join(process.cwd(), 'drizzle', `${MIGRATION_TAG}.sql`), 'utf8')
  .split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

export async function runUrgentFixesV1020Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_items_negative_page_v10_2_0', 'v10_2_0', 'td_1289', 'items', 'pagination')) {
    await runCase(results, 'reg_items_negative_page_v10_2_0',
      'v10.2.0: the item list reads a negative, zero, text or huge page as a valid page, never a 500',
      'GET /api/items?page=-1|0|abc|99999999999 -> 200 with page 1 or the capped page',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const app = await getTestApp();
        const session = await getAdminSession();
        for (const page of ['-1', '0', 'abc', '99999999999']) {
          const res = await request(app).get(`/api/items?page=${page}&limit=5`).set('Cookie', session.cookie);
          if (res.status !== 200) wrong.push(`page=${page} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
          else if (page !== '99999999999' && Number(res.body?.page) !== 1) wrong.push(`page=${page} answered page ${String(res.body?.page)}, not 1`);
        }
      });
  }

  if (shouldRun('reg_users_deleted_not_null_v10_2_0', 'v10_2_0', 'td_1289', 'users', 'migration')) {
    await runCase(results, 'reg_users_deleted_not_null_v10_2_0',
      'v10.2.0: migration 0126 turns NULL users.is_deleted into 0 or 1 without breaking the username key, then NOT NULL DEFAULT 0',
      'NULL rows: live name -> 0; no role -> 1; key held by a live user -> 1; two NULL rows of one key -> first 0, second 1; one audit row each; column NOT NULL DEFAULT 0',
      async (wrong) => {
        const { ensureTestRole } = await import('../fixtures/factories.js');
        const roleCode = `v1020_role_${tail()}`;
        await ensureTestRole(roleCode);
        const base = `v1020null_${tail()}`;
        try {
          await orm.transaction(async (tx) => {
            await tx.execute(sql`ALTER TABLE users ALTER COLUMN is_deleted DROP NOT NULL`);
            await tx.execute(sql`ALTER TABLE users ALTER COLUMN is_deleted DROP DEFAULT`);
            const insert = async (username: string, role: string | null, isDeleted: number | null) => {
              const rows = await tx.execute(sql`INSERT INTO users (username, password, full_name, role, is_deleted)
                VALUES (${username}, 'x', 'ERP-TEST-MARKER', ${role}, ${isDeleted}) RETURNING id`);
              return Number((rows as unknown as { rows: Array<{ id: number }> }).rows[0].id);
            };
            const liveName = await insert(`${base}_a`, roleCode, null);
            const noRole = await insert(`${base}_b`, null, null);
            await insert(`${base}_c`, roleCode, 0);
            const heldKey = await insert(` ${base.toUpperCase()}_C`, roleCode, null);
            const firstTwin = await insert(`${base}_d`, roleCode, null);
            const secondTwin = await insert(`${base}_D`, roleCode, null);
            for (const s of migrationStatements()) await tx.execute(sql.raw(s));
            const flags = await tx.select({ id: users.id, isDeleted: users.isDeleted }).from(users)
              .where(inArray(users.id, [liveName, noRole, heldKey, firstTwin, secondTwin]));
            const flagOf = (id: number) => flags.find(f => f.id === id)?.isDeleted;
            const expected: Array<[string, number, number]> = [
              ['live name', liveName, 0], ['no role', noRole, 1], ['key held by a live user', heldKey, 1],
              ['first of two NULL rows', firstTwin, 0], ['second of two NULL rows', secondTwin, 1],
            ];
            for (const [label, id, value] of expected) {
              if (flagOf(id) !== value) wrong.push(`${label}: is_deleted ${String(flagOf(id))}, expected ${value}`);
            }
            const logs = await tx.select({ entityId: activityLogs.entityId }).from(activityLogs)
              .where(sql`${activityLogs.details}->>'migration' = ${MIGRATION_TAG} AND ${activityLogs.details}->>'username' ILIKE ${`%${base}%`}`);
            const logged = logs.map(l => l.entityId).sort();
            const wanted = expected.map(([, id]) => String(id)).sort();
            if (JSON.stringify(logged) !== JSON.stringify(wanted)) wrong.push(`audit rows for ${JSON.stringify(logged)}, expected ${JSON.stringify(wanted)}`);
            const column = await tx.execute(sql`SELECT is_nullable, column_default FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'is_deleted'`);
            const info = (column as unknown as { rows: Array<{ is_nullable: string; column_default: string | null }> }).rows[0];
            if (info?.is_nullable !== 'NO' || !String(info?.column_default ?? '').startsWith('0')) {
              wrong.push(`users.is_deleted is nullable ${String(info?.is_nullable)} with default ${String(info?.column_default)}`);
            }
            throw new Rollback();
          });
        } catch (err) {
          if (!(err instanceof Rollback)) throw err;
        } finally {
          await deleteTestRoles(eq(roles.code, roleCode)).catch(() => undefined);
        }
        const live = await orm.execute(sql`SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'is_deleted'`);
        if ((live as unknown as { rows: Array<{ is_nullable: string }> }).rows[0]?.is_nullable !== 'NO') wrong.push('the migrated schema leaves users.is_deleted nullable');
      });
  }

  if (shouldRun('reg_webhook_retry_limits_v10_2_0', 'v10_2_0', 'td_1289', 'webhooks', 'migration')) {
    await runCase(results, 'reg_webhook_retry_limits_v10_2_0',
      'v10.2.0: migration 0126 brings webhook retry limits outside 1 to 10 to the number delivery used, with an audit row each',
      'retry limits 0, NULL, -2, 15, 5 -> 3, 3, 1, 10, 5; four audit rows; the one inside the range untouched',
      async (wrong) => {
        const name = `ERP-TEST-MARKER v1020 ${tail()}`;
        try {
          await orm.transaction(async (tx) => {
            const limits = [0, null, -2, 15, 5];
            const ids: number[] = [];
            for (const [i, limit] of limits.entries()) {
              const [row] = await tx.insert(webhookSubscriptions).values({
                name: `${name} ${i}`, targetUrl: 'https://example.com/hook', secretKey: 'enc:v1:test', retryLimit: limit, isActive: 0,
              }).returning({ id: webhookSubscriptions.id });
              ids.push(row.id);
            }
            for (const s of migrationStatements()) await tx.execute(sql.raw(s));
            const rows = await tx.select({ id: webhookSubscriptions.id, retryLimit: webhookSubscriptions.retryLimit }).from(webhookSubscriptions)
              .where(inArray(webhookSubscriptions.id, ids));
            const got = ids.map(id => rows.find(r => r.id === id)?.retryLimit);
            if (JSON.stringify(got) !== JSON.stringify([3, 3, 1, 10, 5])) wrong.push(`retry limits became ${JSON.stringify(got)}, expected [3,3,1,10,5]`);
            const logs = await tx.select({ entityId: activityLogs.entityId }).from(activityLogs)
              .where(and(sql`${activityLogs.details}->>'migration' = ${MIGRATION_TAG}`, inArray(activityLogs.entityId, ids.map(String)), like(activityLogs.entity, '%وب‌هوک%')));
            if (logs.length !== 4) wrong.push(`${logs.length} audit rows, expected 4`);
            throw new Rollback();
          });
        } catch (err) {
          if (!(err instanceof Rollback)) throw err;
        }
      });
  }

  if (shouldRun('reg_user_restore_race_v10_2_0', 'v10_2_0', 'td_1289', 'users', 'restore')) {
    await runCase(results, 'reg_user_restore_race_v10_2_0',
      'v10.2.0: a restore racing a new user of the same username key answers 409 USERNAME_HELD_BY_LIVE_USER, never a database error',
      'an uncommitted live user with the username in other letters, the restore started, then that user committed -> 409 USERNAME_HELD_BY_LIVE_USER, the deleted user stays deleted',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const { createTestUser, ensureTestRole } = await import('../fixtures/factories.js');
        const app = await getTestApp();
        const session = await getAdminSession();
        const roleCode = `v1020_race_${tail()}`;
        await ensureTestRole(roleCode);
        const username = `v1020race_${tail()}`;
        const target = await createTestUser({ username, role: roleCode, isDeleted: 1 });
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`INSERT INTO users (username, password, full_name, role, is_deleted) VALUES ($1, 'x', 'ERP-TEST-MARKER', $2, 0)`,
            [username.toUpperCase(), roleCode]);
          const pending = request(app).post(`/api/users/${target.id}/restore`)
            .set('Cookie', session.cookie).set('x-csrf-token', session.csrfToken)
            .send({ role: roleCode, password: 'Tempor4ry!x' })
            .then(res => res);
          await new Promise(resolve => setTimeout(resolve, 400));
          await client.query('COMMIT');
          const res = await pending;
          if (res.status !== 409 || res.body?.code !== 'USERNAME_HELD_BY_LIVE_USER') {
            wrong.push(`the racing restore answered ${res.status} ${String(res.body?.code)}: ${JSON.stringify(res.body).slice(0, 200)}`);
          }
          const [after] = await orm.select({ isDeleted: users.isDeleted }).from(users).where(eq(users.id, target.id));
          if (after?.isDeleted !== 1) wrong.push('the deleted user was restored');
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
          await orm.delete(users).where(sql`lower(${users.username}) = ${username}`).catch(() => undefined);
          await deleteTestRoles(eq(roles.code, roleCode)).catch(() => undefined);
        }
      });
  }

  if (shouldRun('reg_workflow_removed_permission_v10_2_0', 'v10_2_0', 'td_1289', 'workflow', 'permissions')) {
    await runCase(results, 'reg_workflow_removed_permission_v10_2_0',
      'v10.2.0: workflow actions still asking the removed key of migration 0123 ask audit.apply, published with an audit row; a definition with a draft waits',
      'replaceRemovedWorkflowPermissions: published definition -> audit.apply in its tables and a new published version, one «طرح گردش کار» row; a second run changes nothing; a definition with a draft untouched',
      async (wrong) => {
        const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
        const { recordDefinitionVersion } = await import('../../services/workflow/workflowSnapshot.js');
        const { replaceRemovedWorkflowPermissions } = await import('../../services/workflow/removedPermissionKeys.js');
        const make = async (label: string) => {
          const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
            code: `WF_V1020_${label}_${tail()}`, entityType: 'item', title: `ERP-TEST-MARKER گردش کار ${label}`,
            states: [
              { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial', stepOrder: 1, slaHours: 24 },
              { stateKey: 'approved', title: 'تأییدشده', stateType: 'terminal', stepOrder: 2, slaHours: 24 },
            ],
            transitions: [
              { from: 'draft', to: 'approved', actionKey: 'approve', title: 'تأیید', requiredRole: '', requiredPermission: 'audit.view', approvalRuleType: 'SINGLE', kValue: 1 },
            ],
          });
          const id = Number(saved?.definition.id);
          // the action as it was before 0123 removed its key, published
          await orm.transaction(async (tx) => {
            await tx.update(workflowTransitions).set({ requiredPermission: ` ${REMOVED_KEY} ` }).where(eq(workflowTransitions.workflowDefinitionId, id));
            await recordDefinitionVersion(tx, id, { title: 'legacy', description: 'legacy key', status: 'published' });
          });
          return id;
        };
        const published = await make('PUB');
        const drafted = await make('DRAFT');
        try {
          await orm.update(workflowDefinitions).set({ version: sql`${workflowDefinitions.version} + 1` }).where(eq(workflowDefinitions.id, drafted));
          const changed = await replaceRemovedWorkflowPermissions();
          if (!changed.includes(published)) wrong.push(`the published definition was not changed (${JSON.stringify(changed)})`);
          if (changed.includes(drafted)) wrong.push('a definition with a draft was published');
          const keyOf = async (id: number) => (await orm.select({ p: workflowTransitions.requiredPermission }).from(workflowTransitions)
            .where(eq(workflowTransitions.workflowDefinitionId, id)))[0]?.p;
          if ((await keyOf(published)) !== 'audit.apply') wrong.push(`the published definition's action asks ${String(await keyOf(published))}`);
          if (!String(await keyOf(drafted)).includes(REMOVED_KEY)) wrong.push('the drafted definition changed');
          const versions = await orm.execute(sql`SELECT v.dsl_json::text AS dsl FROM workflow_definition_versions v
            JOIN workflow_definitions d ON d.id = v.definition_id AND v.version = d.published_version WHERE d.id = ${published}`);
          const dsl = String((versions as unknown as { rows: Array<{ dsl: string }> }).rows[0]?.dsl ?? '');
          if (!dsl.includes('audit.apply') || dsl.includes(REMOVED_KEY)) wrong.push('the published version does not carry audit.apply alone');
          const logs = await orm.select({ id: activityLogs.id }).from(activityLogs)
            .where(and(eq(activityLogs.entityId, String(published)), eq(activityLogs.entity, WORKFLOW_DESIGN_ENTITY), like(activityLogs.description, `%${REPLACEMENT_TITLE}%`)));
          if (logs.length !== 1) wrong.push(`${logs.length} audit rows for the changed definition, expected 1`);
          const again = await replaceRemovedWorkflowPermissions();
          if (again.includes(published)) wrong.push('a second run changed the definition again');
        } finally {
          await orm.update(workflowDefinitions).set({ isActive: 0 }).where(inArray(workflowDefinitions.id, [published, drafted])).catch(() => undefined);
        }
      });
  }

  return results;
}
