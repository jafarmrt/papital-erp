import { drizzle } from 'drizzle-orm/node-postgres';
import { TestCaseResult } from '../types.js';
import { pool, type DbExecutor } from '../../db/drizzle.js';
import { runCase, type Harness, type Row, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M3 — گردش کار گام را با مجوز لازم و نقش دقیق می‌سنجد، نه با جدول هم‌ارزی کد نقش (TD-542، یافته
 * B02-27). هر آزمون روی کد پیشین قرمز است.
 */

async function tasksOf(h: Harness, s: Session, instanceId: number): Promise<Row[]> {
  const res = await h.get('/api/workflow/tasks/my-tasks?limit=100', s);
  const rows = Array.isArray(res.body?.data) ? (res.body.data as Row[]) : [];
  return rows.filter(t => Number(t.instanceId ?? (t.instance as Row | undefined)?.id) === instanceId);
}

/** گردش کار آزمایشی دو گامی (ارسال، تأیید) با نگهبان داده‌شده روی هر دو اقدام، و یک فرایند تازه از آن */
async function guardedInstance(h: Harness, label: string, role: string, permission: string): Promise<{ instanceId: number; definitionId: number; code: string }> {
  const { createTestWorkflow } = await import('../fixtures/factories.js');
  const { definition } = await createTestWorkflow({ definition: { entityType: 'test_document' } });
  await h.q(`UPDATE workflow_transitions SET required_role = $2, required_permission = $3 WHERE workflow_definition_id = $1`, [definition.id, role, permission]);
  const started = await h.start({ workflowCode: definition.code, entityType: 'test_document', entityId: `TD542-${label}-${h.tag}` });
  const instanceId = Number(started.body?.data?.id);
  if (!(instanceId > 0)) throw new Error(`starting the test workflow (${label}) returned ${started.status}: ${JSON.stringify(started.body).slice(0, 160)}`);
  return { instanceId, definitionId: definition.id, code: definition.code };
}

export async function runAccessPackageTwoWorkflowTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_role_exact_match_td_542', 'security', 'td542', 'workflow', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_workflow_role_exact_match_td_542',
      name: 'v9.0.111: a workflow step with a role is signed only by that role and the system admin; who signs is the required permission (TD-542)',
      details: 'a custom role with accounting.vouchers_approve approves a journal voucher through the seeded workflow; cfo_accountant no longer signs an accountant step and a warehouse.out holder no longer signs a warehouse_keeper step (inbox and transition); the role itself and the system admin do; a deputy of a permission holder signs a permission-only step in the holder\'s name',
    }, async (h, wrong) => {
      const { createTestVoucher } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');

      // ۱) گردش کار پیش‌فرض سند حسابداری فقط مجوز می‌خواهد: نقش سفارشی با accounting.vouchers_approve تأیید می‌کند
      //    (v10.0.27، TD-965: تأیید سند حسابداری مجوز جدای خود را دارد)
      const seeded = await h.q(`SELECT t.required_role, t.required_permission FROM workflow_transitions t
        JOIN workflow_definitions d ON d.id = t.workflow_definition_id WHERE d.code = 'JOURNAL_VOUCHER_WORKFLOW' AND t.action_key = 'approve_voucher'`);
      if (seeded.length === 0 || seeded.some(t => String(t.required_role ?? '') !== '' || t.required_permission !== 'accounting.vouchers_approve')) {
        wrong.push(`seeded journal voucher approval guard is ${JSON.stringify(seeded)}, not permission accounting.vouchers_approve without a role`);
      }
      const branch = await h.sessionWith(['accounting.view', 'accounting.vouchers', 'accounting.vouchers_approve', 'workflow.view', 'workflow.approve', 'workflow.execute']);
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 1500000, totalCredit: 1500000 } as never);
      const started = await h.start({ workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      const voucherInstance = Number(started.body?.data?.id);
      if (!(voucherInstance > 0)) throw new Error(`starting the journal voucher workflow returned ${started.status}`);
      if ((await tasksOf(h, branch, voucherInstance)).length === 0) wrong.push('a custom role with accounting.vouchers_approve did not see the journal voucher task');
      const branchWalk = await h.walk(voucherInstance, ['approve_voucher'], branch);
      if (branchWalk[0] !== 200) wrong.push(`a custom role with accounting.vouchers_approve approving a journal voucher returned ${branchWalk.join(',')}, not 200`);

      // ۲) گام نقش «accountant»: مدیر مالی دیگر هم‌ارز نیست
      const accountantStep = await guardedInstance(h, 'acc', 'accountant', '');
      const cfo = await h.sessionWith('cfo_accountant');
      if ((await tasksOf(h, cfo, accountantStep.instanceId)).length > 0) wrong.push('cfo_accountant saw an accountant step in the inbox');
      const cfoWalk = await h.walk(accountantStep.instanceId, ['submit'], cfo);
      if (cfoWalk[0] !== 403) wrong.push(`cfo_accountant running an accountant step returned ${cfoWalk.join(',')}, not 403`);
      const accountant = await h.sessionWith('accountant');
      if ((await tasksOf(h, accountant, accountantStep.instanceId)).length === 0) wrong.push('accountant did not see its own step in the inbox');
      const accountantWalk = await h.walk(accountantStep.instanceId, ['submit'], accountant);
      if (accountantWalk[0] !== 200) wrong.push(`accountant running its own step returned ${accountantWalk.join(',')}, not 200`);
      const adminWalk = await h.walk(accountantStep.instanceId, ['approve'], h.admin);
      if (adminWalk[0] !== 200) wrong.push(`the system admin running an accountant step returned ${adminWalk.join(',')}, not 200`);

      // ۳) گام نقش «warehouse_keeper»: مجوز ثبت انبار دیگر گام نقش را باز نمی‌کند
      const keeperStep = await guardedInstance(h, 'wh', 'warehouse_keeper', '');
      const stockOut = await h.sessionWith(['workflow.view', 'workflow.approve', 'warehouse.view', 'warehouse.out']);
      if ((await tasksOf(h, stockOut, keeperStep.instanceId)).length > 0) wrong.push('a warehouse.out holder saw a warehouse_keeper step in the inbox');
      const stockOutWalk = await h.walk(keeperStep.instanceId, ['submit'], stockOut);
      if (stockOutWalk[0] !== 403) wrong.push(`a warehouse.out holder running a warehouse_keeper step returned ${stockOutWalk.join(',')}, not 403`);
      const keeper = await h.sessionWith('warehouse_keeper');
      const keeperWalk = await h.walk(keeperStep.instanceId, ['submit'], keeper);
      if (keeperWalk[0] !== 200) wrong.push(`warehouse_keeper running its own step returned ${keeperWalk.join(',')}, not 200`);

      // ۴) گام «فقط مجوز» با تفویض: جانشینی که خودش مجوز را ندارد به نام دارنده امضا می‌کند
      const permissionStep = await guardedInstance(h, 'perm', '', 'accounting.vouchers');
      const holder = await h.sessionWith(['accounting.view', 'accounting.vouchers', 'workflow.view', 'workflow.approve']);
      const deputy = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const start = new Date(Date.now() - 3600_000).toISOString();
      const end = new Date(Date.now() + 86_400_000).toISOString();
      const delegation = await h.post('/api/workflow/delegations', { fromUserId: holder.userId, toUserId: deputy.userId, scope: 'ALL', startDate: start, endDate: end, reason: `td542 ${h.tag}` });
      if (delegation.status !== 200 && delegation.status !== 201) throw new Error(`creating the delegation returned ${delegation.status}: ${JSON.stringify(delegation.body).slice(0, 160)}`);
      const outsider = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const outsiderWalk = await h.walk(permissionStep.instanceId, ['submit'], outsider);
      if (outsiderWalk[0] !== 403) wrong.push(`a user without accounting.vouchers and no delegation returned ${outsiderWalk.join(',')}, not 403`);
      const deputyWalk = await h.walk(permissionStep.instanceId, ['submit'], deputy);
      if (deputyWalk[0] !== 200) wrong.push(`the deputy of an accounting.vouchers holder returned ${deputyWalk.join(',')}, not 200`);
      await h.q(`DELETE FROM workflow_delegations WHERE to_user_id = $1`, [deputy.userId]).catch(() => undefined);
    });
  }

  if (shouldRun('sec_workflow_sla_reminder_permission_td_542', 'security', 'td542', 'workflow', 'permissions', 'sla', 'package2')) {
    await runCase(results, {
      id: 'sec_workflow_sla_reminder_permission_td_542',
      name: 'v9.0.111: an overdue step reminder goes only to users who may sign it, the holders of its required permission (TD-542)',
      details: 'an overdue permission-only step (accounting.vouchers) reminds the holder of that permission, not every workflow approver; an overdue step whose role lacks the step permission reminds none of its members',
    }, async (h, wrong) => {
      const { WorkflowSlaReminderService } = await import('../../services/workflow/workflowSlaReminderService.js');
      const holder = await h.sessionWith(['accounting.view', 'accounting.vouchers', 'workflow.view', 'workflow.approve']);
      const approver = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const permissionStep = await guardedInstance(h, 'sla-perm', '', 'accounting.vouchers');
      const roleStep = await guardedInstance(h, 'sla-role', approver.role, 'accounting.vouchers');
      await h.q(`UPDATE workflow_tasks SET due_at = now() - interval '1 hour', sla_reminded_at = NULL
        WHERE instance_id = ANY($1::int[]) AND status = 'pending'`, [[permissionStep.instanceId, roleStep.instanceId]]);
      await WorkflowSlaReminderService.sendDueReminders();
      const reminders = async (userId: number) => Number((await h.q(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title = 'مهلت کار تاییدی گذشت'`, [userId],
      ))[0]?.n ?? 0);
      const held = await reminders(holder.userId);
      if (held !== 1) wrong.push(`the accounting.vouchers holder got ${held} reminders, not 1`);
      const other = await reminders(approver.userId);
      if (other !== 0) wrong.push(`a workflow approver without accounting.vouchers got ${other} reminders, not 0`);
    });
  }

  if (shouldRun('sec_workflow_design_role_and_permission_td_542', 'security', 'td542', 'workflow', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_workflow_design_role_and_permission_td_542',
      name: 'v9.0.111: a workflow design is saved only with existing roles and catalog permissions, and a role a workflow step needs is not deleted (TD-542)',
      details: 'POST /api/workflow/definitions with an unknown role or a non-catalog permission gets 422 and stores nothing; an existing role in another case is stored as its code; DELETE /api/roles/:id of a role a step needs gets 409 ROLE_USED_BY_WORKFLOW and succeeds once no step needs it',
    }, async (h, wrong) => {
      const { createTestRole } = await import('../fixtures/factories.js');
      const role = await createTestRole({ permissions: ['workflow.view', 'workflow.approve'] });
      const design = (code: string, transition: Record<string, unknown>) => ({
        code, title: `گردش کار آزمون ۵۴۲ ${code}`, entityType: 'test_document',
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
          { stateKey: 'done', title: 'پایان', stateType: 'terminal' },
        ],
        transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تأیید', ...transition }],
      });
      const codes = [`TD542_A_${h.tag}`, `TD542_B_${h.tag}`, `TD542_C_${h.tag}`];
      try {
        const unknownRole = await h.post('/api/workflow/definitions', design(codes[0], { requiredRole: `td542_ghost_${h.tag}` }));
        if (unknownRole.status !== 422) wrong.push(`a design with an unknown role returned ${unknownRole.status}, not 422`);
        const unknownPermission = await h.post('/api/workflow/definitions', design(codes[1], { requiredPermission: 'accounting.no_such_key' }));
        if (unknownPermission.status !== 422) wrong.push(`a design with a non-catalog permission returned ${unknownPermission.status}, not 422`);
        const stored = await h.q(`SELECT code FROM workflow_definitions WHERE code = ANY($1::text[])`, [codes.slice(0, 2)]);
        if (stored.length > 0) wrong.push(`refused designs were stored: ${stored.map(r => String(r.code)).join(', ')}`);

        const saved = await h.post('/api/workflow/definitions', design(codes[2], { requiredRole: ` ${role.code.toUpperCase()} `, requiredPermission: 'workflow.approve' }));
        if (saved.status !== 200 && saved.status !== 201) {
          wrong.push(`a design with an existing role returned ${saved.status}: ${JSON.stringify(saved.body).slice(0, 160)}`);
        } else {
          const [tr] = await h.q(`SELECT t.required_role FROM workflow_transitions t JOIN workflow_definitions d ON d.id = t.workflow_definition_id WHERE d.code = $1`, [codes[2]]);
          if (tr?.required_role !== role.code) wrong.push(`the existing role was stored as "${String(tr?.required_role)}", not "${role.code}"`);
        }

        const refused = await h.del(`/api/roles/${role.id}`);
        if (refused.status !== 409 || refused.body?.code !== 'ROLE_USED_BY_WORKFLOW') wrong.push(`deleting a role a workflow step needs returned ${refused.status} ${String(refused.body?.code)}, not 409 ROLE_USED_BY_WORKFLOW`);
        // v10.1.21 (TD-1270): the step stops needing the role once a design without it is saved and published
        const [def] = await h.q(`SELECT id FROM workflow_definitions WHERE code = $1`, [codes[2]]);
        const draft = await h.post('/api/workflow/definitions', { ...design(codes[2], { requiredPermission: 'workflow.approve' }), id: Number(def?.id) });
        const publish = await h.post(`/api/workflow/definitions/${Number(def?.id)}/publish`, { draftVersion: Number(draft.body?.data?.definition?.version ?? draft.body?.data?.version) });
        if (publish.status !== 200) wrong.push(`publishing the design without the role returned ${publish.status}`);
        const deleted = await h.del(`/api/roles/${role.id}`);
        if (deleted.status !== 200) wrong.push(`deleting the role once no step needs it returned ${deleted.status}`);
      } finally {
        for (const code of codes) {
          await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]).catch(() => undefined);
          await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]).catch(() => undefined);
          await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]).catch(() => undefined);
          await h.q(`DELETE FROM workflow_definitions WHERE code = $1`, [code]).catch(() => undefined);
        }
        await h.q(`DELETE FROM roles WHERE id = $1`, [role.id]).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_workflow_role_migration_td_542', 'security', 'td542', 'workflow', 'permissions', 'health', 'package2')) {
    await runCase(results, {
      id: 'sec_workflow_role_migration_td_542',
      name: 'v9.0.111: the health check lists the workflow steps recorded for role review until the step changes or the instance ends (TD-542)',
      details: 'review rows (as an upgraded database holds them) for a definition step, the same step of a running instance and a step with a missing role are listed; after the step gets a permission and the instance completes only the missing-role step stays',
    }, async (_h, wrong) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows as Row[];
        const tag = String(Date.now()).slice(-7);
        // v10.1.7 (TD-1229): one active workflow per record type; the earlier test ones step aside inside this rolled-back transaction
        await q(`UPDATE workflow_definitions SET is_active = 0 WHERE entity_type = 'test_document' AND is_active = 1`);
        const [def] = await q(`INSERT INTO workflow_definitions (code, title, entity_type, version, is_active) VALUES ($1, $2, 'test_document', 1, 1) RETURNING id`, [`TD542_REV_${tag}`, `گردش کار بازبینی ۵۴۲ ${tag}`]);
        const defId = Number(def.id);
        const states = await q(`INSERT INTO workflow_states (workflow_definition_id, state_key, title, state_type, step_order) VALUES
          ($1, 'a', 'گام یک', 'initial', 1), ($1, 'b', 'گام دو', 'intermediate', 2) RETURNING id`, [defId]);
        const [sa, sb] = states.map(s => Number(s.id));
        const ghostRole = `td542_ghost_${tag}`;
        const ids: Record<string, number> = {};
        for (const [key, role] of [['t4', 'accountant'], ['t5', ghostRole]] as const) {
          const [row] = await q(`INSERT INTO workflow_transitions (workflow_definition_id, from_state_id, to_state_id, action_key, title, required_role, required_permission, approval_rule_type)
            VALUES ($1, $2, $3, $4, $5, $6, '', 'SINGLE') RETURNING id`, [defId, sa, sb, key, `اقدام ${key}`, role]);
          ids[key] = Number(row.id);
        }
        const [inst] = await q(`INSERT INTO workflow_instances (workflow_definition_id, definition_version, snapshot_dsl, entity_type, entity_id, current_state_id, status)
          VALUES ($1, 1, '{}'::jsonb, 'test_document', $2, $3, 'IN_PROGRESS') RETURNING id`, [defId, `TD542-REV-${tag}`, sa]);
        const running = Number(inst.id);
        const review = (details: Record<string, unknown>) => q(`INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
          VALUES ('system', 'سیستم', 'UPDATE', 'نقش و دسترسی', $1, 'td542 review', $2::jsonb, '', now())`,
        [String(defId), JSON.stringify({ source: 'td542_workflow_role_review', definitionId: defId, definitionTitle: `گردش کار بازبینی ۵۴۲ ${tag}`, ...details })]);
        const lostRoles = [{ id: 0, code: 'cfo_accountant', name: 'cfo_accountant' }];
        await review({ scope: 'definition', transitionId: ids.t4, transitionTitle: 'اقدام t4', requiredRole: 'accountant', roleExists: true, lostRoles });
        await review({ scope: 'instance', instanceId: running, transitionId: ids.t4, transitionTitle: 'اقدام t4', requiredRole: 'accountant', roleExists: true, lostRoles });
        await review({ scope: 'definition', transitionId: ids.t5, transitionTitle: 'اقدام t5', requiredRole: ghostRole, roleExists: false, lostRoles: [] });

        const { findWorkflowRoleReviews } = await import('../../services/workflow/workflowRoleReview.js');
        const db = drizzle(client) as unknown as DbExecutor;
        const listed = async () => (await findWorkflowRoleReviews(db)).filter(r => r.definitionId === defId);
        const before = await listed();
        if (before.length !== 3) wrong.push(`the health check lists ${before.length} review rows of the test workflow, not 3`);
        const ghost = before.find(r => r.transitionId === ids.t5);
        if (!ghost || ghost.roleExists !== false) wrong.push(`the review of the missing role: ${JSON.stringify(ghost)}`);
        await q(`UPDATE workflow_transitions SET required_role = '', required_permission = 'accounting.vouchers' WHERE id = $1`, [ids.t4]);
        await q(`UPDATE workflow_instances SET status = 'COMPLETED' WHERE id = $1`, [running]);
        const after = await listed();
        if (after.length !== 1 || after[0].scope !== 'definition' || after[0].transitionId !== ids.t5) {
          wrong.push(`after changing step t4 and completing the instance the health check lists ${JSON.stringify(after.map(r => [r.scope, r.transitionId]))}`);
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });
  }

  return results;
}
