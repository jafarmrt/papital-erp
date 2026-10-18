import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { activityLogs, roles, users, webhookSubscriptions, workflowDefinitions, workflowInstances, workflowTasks, workflowTransitions } from '../../db/schema.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

/**
 * v10.2.0, package 1 of the 10.2 start plan (TD-1289): urgent fixes found after the 10.1 upgrade.
 * - the item list with a negative or huge page answered 500 (negative OFFSET);
 * - users.is_deleted took NULL, and migration 0126 makes it NOT NULL DEFAULT 0 without breaking the username key;
 * - webhook retry limits outside 1 to 10 saved before v10.1.66 are brought to the number delivery already used;
 * - a restore racing a new user with the same username key answered a raw database error, not the friendly 409;
 * - workflow actions still asking the removed key of migration 0123 ask audit.apply after the boot step.
 * Each case is red on v10.1.72. v10.2.8 (TD-1320) adds the inbox: a task of a running instance whose snapshot still
 * asks the removed key reaches the inbox, the recipients and the task run of an audit.apply holder, and the event lists
 * read a negative or text page as the first page (both red on v10.2.7).
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
      'with uq_users_username_key: live name -> 0; no role -> 1; key held by a live user -> 1; two NULL rows of one key -> first 0, second 1; a WARNING counts 1 + 2. Without the index only the no-role row -> 1. One audit row each; column NOT NULL DEFAULT 0',
      async (wrong) => {
        const { ensureTestRole } = await import('../fixtures/factories.js');
        const roleCode = `v1020_role_${tail()}`;
        await ensureTestRole(roleCode);
        try {
          for (const withIndex of [true, false]) {
            const scenario = withIndex ? 'with the username index' : 'without the username index';
            const base = `v1020null_${tail()}`;
            const notices: string[] = [];
            const client = await pool.connect();
            const onNotice = (n: { severity?: string; message?: string }) => {
              if (String(n.severity ?? '').toUpperCase() === 'WARNING') notices.push(String(n.message ?? ''));
            };
            client.on('notice', onNotice);
            try {
              await client.query('BEGIN');
              await client.query('ALTER TABLE users ALTER COLUMN is_deleted DROP NOT NULL');
              await client.query('ALTER TABLE users ALTER COLUMN is_deleted DROP DEFAULT');
              await client.query(withIndex
                ? 'CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_key ON users (lower(btrim(username))) WHERE is_deleted = 0'
                : 'DROP INDEX IF EXISTS uq_users_username_key');
              const insert = async (username: string, role: string | null, isDeleted: number | null) => {
                const res = await client.query(`INSERT INTO users (username, password, full_name, role, is_deleted)
                  VALUES ($1, 'x', 'ERP-TEST-MARKER', $2, $3) RETURNING id`, [username, role, isDeleted]);
                return Number(res.rows[0].id);
              };
              const liveName = await insert(`${base}_a`, roleCode, null);
              const noRole = await insert(`${base}_b`, null, null);
              await insert(`${base}_c`, roleCode, 0);
              const heldKey = await insert(` ${base.toUpperCase()}_C`, roleCode, null);
              const firstTwin = await insert(`${base}_d`, roleCode, null);
              const secondTwin = await insert(`${base}_D`, roleCode, null);
              for (const statement of migrationStatements()) await client.query(statement);
              const keyTaken = withIndex ? 1 : 0;
              const expected: Array<[string, number, number]> = [
                ['live name', liveName, 0], ['no role', noRole, 1], ['key held by a live user', heldKey, keyTaken],
                ['first of two NULL rows', firstTwin, 0], ['second of two NULL rows', secondTwin, keyTaken],
              ];
              const flags = await client.query('SELECT id, is_deleted FROM users WHERE id = ANY($1::int[])', [expected.map(([, id]) => id)]);
              const flagOf = (id: number) => (flags.rows as Array<{ id: number; is_deleted: number }>).find(f => Number(f.id) === id)?.is_deleted;
              for (const [label, id, value] of expected) {
                if (flagOf(id) !== value) wrong.push(`${scenario}, ${label}: is_deleted ${String(flagOf(id))}, expected ${value}`);
              }
              const logs = await client.query(`SELECT entity_id, details->>'reason' AS reason FROM activity_logs
                WHERE details->>'migration' = $1 AND details->>'username' ILIKE $2`, [MIGRATION_TAG, `%${base}%`]);
              const logged = (logs.rows as Array<{ entity_id: string }>).map(l => l.entity_id).sort();
              const wanted = expected.map(([, id]) => String(id)).sort();
              if (JSON.stringify(logged) !== JSON.stringify(wanted)) wrong.push(`${scenario}: audit rows for ${JSON.stringify(logged)}, expected ${JSON.stringify(wanted)}`);
              const takenRows = (logs.rows as Array<{ reason: string }>).filter(l => l.reason === 'username_key_taken').length;
              if (takenRows !== (withIndex ? 2 : 0)) wrong.push(`${scenario}: ${takenRows} audit rows say the username key is taken`);
              const warning = notices.find(n => n.includes('marked deleted'));
              const wantedCounts = withIndex ? ': 1 without a role, 2 whose username' : ': 1 without a role, 0 whose username';
              if (!warning?.includes(wantedCounts)) wrong.push(`${scenario}: warning ${JSON.stringify(warning ?? null)} does not count ${wantedCounts}`);
              const column = await client.query(`SELECT is_nullable, column_default FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'is_deleted'`);
              const info = column.rows[0] as { is_nullable: string; column_default: string | null } | undefined;
              if (info?.is_nullable !== 'NO' || !String(info?.column_default ?? '').startsWith('0')) {
                wrong.push(`${scenario}: users.is_deleted is nullable ${String(info?.is_nullable)} with default ${String(info?.column_default)}`);
              }
            } finally {
              await client.query('ROLLBACK').catch(() => undefined);
              client.off('notice', onNotice);
              client.release();
            }
          }
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
      'replaceRemovedWorkflowPermissions: published definition -> audit.apply in its tables and a new published version, one workflow design audit row; a second run changes nothing; a definition with a draft untouched',
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
          // a running instance keeps its snapshot asking the removed key: the holder of the replacement signs it
          const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
          const snapshotAction = { requiredPermission: ` ${REMOVED_KEY} ` };
          const holder = await WorkflowTransitionExecutor.holdsRequiredPermission(snapshotAction,
            { role: `v1020_none_${tail()}`, permissions: ['audit.apply'], ownPermissions: true });
          if (!holder) wrong.push('a holder of audit.apply cannot sign a snapshot action asking the removed key');
          const stranger = await WorkflowTransitionExecutor.holdsRequiredPermission(snapshotAction,
            { role: `v1020_none_${tail()}`, permissions: ['audit.view'], ownPermissions: true });
          if (stranger) wrong.push('a user without audit.apply signs a snapshot action asking the removed key');
        } finally {
          await orm.update(workflowDefinitions).set({ isActive: 0 }).where(inArray(workflowDefinitions.id, [published, drafted])).catch(() => undefined);
        }
      });
  }


  if (shouldRun('reg_workflow_removed_permission_inbox_td_1320', 'v10_2_0', 'td_1320', 'workflow', 'inbox', 'permissions')) {
    await runCase(results, 'reg_workflow_removed_permission_inbox_td_1320',
      'v10.2.8: an inbox task whose snapshot action still asks the removed key reaches the holder of audit.apply',
      'snapshot action asks the removed key: getMyTasks lists the task for a role holding audit.apply, workflowTaskRecipients names that user, the task runs from the inbox',
      async (wrong) => {
        const { defineWorkflow, startWf, tasksOf, runTask, wfUser, instanceRow } = await import('../invariants/workflowScenarioHelpers.js');
        const { createTestRole } = await import('../fixtures/factories.js');
        const { WorkflowTaskService } = await import('../../services/workflow/workflowTaskService.js');
        const { workflowTaskRecipients } = await import('../../services/workflow/workflowTaskRecipients.js');
        const { effectivePermissionKey } = await import('../../services/workflow/removedPermissionKeys.js');
        // an own-property lookup: a stored text named like an object prototype member stays as it is
        for (const stored of ['constructor', 'toString', '__proto__']) {
          if (effectivePermissionKey(stored) !== stored) wrong.push(`the stored key ${stored} was read as ${String(effectivePermissionKey(stored))}`);
        }
        const role = `v1020_inbox_${tail()}`;
        await createTestRole({ code: role, name: role, permissions: ['audit.apply', 'workflow.approve'] });
        const holder = await wfUser(role, []);
        const wf = await defineWorkflow({
          states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
          transitions: [{ from: 'draft', to: 'done', action: 'approve', role, permission: 'audit.view' }],
        });
        try {
          const instanceId = await startWf(wf);
          // the running instance as it was before 0123: its own snapshot still asks the removed key
          await pool.query(`UPDATE workflow_instances SET snapshot_dsl = replace(snapshot_dsl::text, '"audit.view"', $2)::jsonb WHERE id = $1`,
            [instanceId, JSON.stringify(` ${REMOVED_KEY} `)]);
          const [task] = await tasksOf(instanceId);
          if (!task) throw new Error('the step made no inbox task');
          const inbox = await WorkflowTaskService.getMyTasks({ userId: holder.id, userRole: holder.role, userPermissions: holder.permissions });
          if (!inbox.data.some(t => t.instanceId === instanceId)) wrong.push('the task is missing from the inbox of the audit.apply holder');
          const [taskRow] = await orm.select().from(workflowTasks).where(eq(workflowTasks.id, task.id));
          const [instance] = await orm.select({ snapshotDsl: workflowInstances.snapshotDsl }).from(workflowInstances).where(eq(workflowInstances.id, instanceId));
          const recipients = await workflowTaskRecipients(orm, taskRow, wf.code, instance.snapshotDsl, new Date());
          if (!recipients.includes(holder.id)) wrong.push('the audit.apply holder is not among the recipients of the task');
          await runTask(task.id, holder);
          if ((await instanceRow(instanceId)).status !== 'COMPLETED') wrong.push('the task run from the inbox did not finish the workflow');
        } finally {
          await orm.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.id, wf.definitionId)).catch(() => undefined);
        }

        // the other side: a user holding the step's role but not audit.apply stays out of the inbox and the recipients,
        // and a refusal names the replacement (the key an administrator can grant), never the removed key
        const { transit } = await import('../invariants/workflowScenarioHelpers.js');
        const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
        const plainRole = `v1020_plain_${tail()}`;
        await createTestRole({ code: plainRole, name: plainRole, permissions: ['workflow.approve'] });
        const stranger = await wfUser(plainRole, []);
        const wf2 = await defineWorkflow({
          states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
          transitions: [{ from: 'draft', to: 'done', action: 'approve', role: plainRole, permission: 'audit.view' }],
        });
        try {
          const instanceId = await startWf(wf2);
          await pool.query(`UPDATE workflow_instances SET snapshot_dsl = replace(snapshot_dsl::text, '"audit.view"', $2)::jsonb WHERE id = $1`,
            [instanceId, JSON.stringify(` ${REMOVED_KEY} `)]);
          const [task] = await tasksOf(instanceId);
          if (!task) throw new Error('the second step made no inbox task');
          const inbox = await WorkflowTaskService.getMyTasks({ userId: stranger.id, userRole: stranger.role, userPermissions: stranger.permissions });
          if (inbox.data.some(t => t.instanceId === instanceId)) wrong.push('the task reached the inbox of a role without audit.apply');
          const [taskRow] = await orm.select().from(workflowTasks).where(eq(workflowTasks.id, task.id));
          const [instance] = await orm.select({ snapshotDsl: workflowInstances.snapshotDsl }).from(workflowInstances).where(eq(workflowInstances.id, instanceId));
          const recipients = await workflowTaskRecipients(orm, taskRow, wf2.code, instance.snapshotDsl, new Date());
          if (recipients.includes(stranger.id)) wrong.push('a role without audit.apply is among the recipients of the task');
          try {
            await transit(instanceId, wf2.transitionId.approve, stranger);
            wrong.push('a role without audit.apply ran the step');
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const details = (err as { details?: { permission?: string } }).details;
            if (!message.includes(REPLACEMENT_TITLE) || message.includes(REMOVED_KEY)) wrong.push(`the refusal reads: ${message}`);
            if (details?.permission !== 'audit.apply') wrong.push(`the refusal details name ${String(details?.permission)}`);
          }
          const check = await WorkflowTransitionExecutor.checkCanTransition({
            instanceId, transitionId: wf2.transitionId.approve, userRole: stranger.role, userPermissions: stranger.permissions,
          });
          if (check.allowed || !String(check.reason).includes(REPLACEMENT_TITLE)) wrong.push(`the transition check answers ${JSON.stringify(check)}`);
          if ((await instanceRow(instanceId)).status !== 'IN_PROGRESS') wrong.push('the refused step moved the workflow');
        } finally {
          await orm.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.id, wf2.definitionId)).catch(() => undefined);
        }
      });
  }

  if (shouldRun('reg_events_negative_page_td_1320', 'v10_2_0', 'td_1320', 'events', 'pagination')) {
    await runCase(results, 'reg_events_negative_page_td_1320',
      'v10.2.8: the event lists read a bad page as page 1 and a bad limit as 50, and page with the cap of their service',
      'GET /api/events/{outbox,action-logs,dlq,webhooks/deliveries/list}?page=-1|0|abc&limit=-5|abc -> 200 with the seeded rows at limit 50, offset 0; page=2&limit=500 -> the service cap as limit and offset',
      async (wrong) => {
        const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
        const { outboxEvents, eventActionLogs, deadLetterEvents, webhookDeliveries } = await import('../../db/schema.js');
        const app = await getTestApp();
        const session = await getAdminSession();
        // one row in each list, so a list that swallowed its database error and answered an empty page is caught
        // (before, /dlq and /webhooks/deliveries/list answered 200 and no row for a negative page)
        const tag = `td1320_${tail()}`;
        const [outbox] = await orm.insert(outboxEvents).values({ eventId: tag, eventType: 'InvoiceApproved', aggregateType: 'Invoice', aggregateId: tag, status: 'completed' })
          .returning({ id: outboxEvents.id });
        const [log] = await orm.insert(eventActionLogs).values({ eventId: tag, eventType: 'InvoiceApproved', actionType: 'audit_log', status: 'success' })
          .returning({ id: eventActionLogs.id });
        const [dlq] = await orm.insert(deadLetterEvents).values({ originalEventId: tag, eventType: 'InvoiceApproved', aggregateType: 'Invoice', aggregateId: tag, failureReason: 'td1320' })
          .returning({ id: deadLetterEvents.id });
        const [sub] = await orm.insert(webhookSubscriptions).values({ name: `TD1320 ${tag}`, targetUrl: 'https://partner.example.org/hook', secretKey: '', isActive: 0 })
          .returning({ id: webhookSubscriptions.id });
        await orm.insert(webhookDeliveries).values({ subscriptionId: sub.id, eventId: tag, eventType: 'InvoiceApproved', targetUrl: 'https://partner.example.org/hook', status: 'success' });
        try {
          const lists: Array<{ path: string; rows: string; cap: number }> = [
            { path: 'outbox', rows: 'events', cap: 1000 },
            { path: 'action-logs', rows: 'data', cap: 100 },
            { path: 'dlq', rows: 'data', cap: 200 },
            { path: 'webhooks/deliveries/list', rows: 'data', cap: 100 },
          ];
          for (const list of lists) {
            for (const query of ['page=-1', 'page=0', 'page=abc', 'limit=-5', 'limit=abc&page=-3']) {
              const res = await request(app).get(`/api/events/${list.path}?${query}`).set('Cookie', session.cookie);
              const rows = res.body?.[list.rows];
              if (res.status !== 200) { wrong.push(`${list.path}?${query} answered ${res.status}`); continue; }
              if (!Array.isArray(rows) || rows.length === 0) wrong.push(`${list.path}?${query} answered no row`);
              if (res.body.limit !== 50) wrong.push(`${list.path}?${query} read limit ${String(res.body.limit)}`);
              if ('offset' in res.body && res.body.offset !== 0) wrong.push(`${list.path}?${query} read offset ${String(res.body.offset)}`);
              if ('page' in res.body && res.body.page !== 1) wrong.push(`${list.path}?${query} read page ${String(res.body.page)}`);
            }
            // a malformed limit with a good page reads that page at the default limit
            const bad = await request(app).get(`/api/events/${list.path}?limit=abc&page=2`).set('Cookie', session.cookie);
            if (bad.status !== 200 || bad.body.limit !== 50) wrong.push(`${list.path}?limit=abc&page=2 read limit ${String(bad.body?.limit)}`);
            if ('offset' in bad.body && bad.body.offset !== 50) wrong.push(`${list.path}?limit=abc&page=2 read offset ${String(bad.body.offset)}`);
            if ('page' in bad.body && bad.body.page !== 2) wrong.push(`${list.path}?limit=abc&page=2 read page ${String(bad.body.page)}`);
            // a limit above the service's cap pages with that cap: page 2 starts where page 1 ended
            const res = await request(app).get(`/api/events/${list.path}?page=2&limit=5000`).set('Cookie', session.cookie);
            if (res.status !== 200 || res.body.limit !== list.cap) wrong.push(`${list.path}?page=2&limit=5000 read limit ${String(res.body?.limit)}`);
            if ('offset' in res.body && res.body.offset !== list.cap) wrong.push(`${list.path}?page=2&limit=5000 read offset ${String(res.body.offset)}`);
            if ('page' in res.body && res.body.page !== 2) wrong.push(`${list.path}?page=2&limit=5000 read page ${String(res.body.page)}`);
          }
        } finally {
          await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, sub.id)).catch(() => undefined);
          await orm.delete(deadLetterEvents).where(eq(deadLetterEvents.id, dlq.id)).catch(() => undefined);
          await orm.delete(eventActionLogs).where(eq(eventActionLogs.id, log.id)).catch(() => undefined);
          await orm.delete(outboxEvents).where(eq(outboxEvents.id, outbox.id)).catch(() => undefined);
        }
      });
  }
  return results;
}
