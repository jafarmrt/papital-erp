import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { pieceworkLogs, pieceworkPayrolls, pieceworkPersonnelRates, pieceworkTasks, taskCategories } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { fundedBank, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { runCase, type Harness, type ShouldRun } from './workflowTestHarness.js';

/**
 * Package 12 payroll, PR «ج» (TD-805, B12P-02, product-owner decision t2 «الف»): every payroll action asks the key of its
 * own name, through the real Express routes. Each case is red on the code before v9.0.320.
 */

type Session = Awaited<ReturnType<Harness['sessionWith']>>;

export async function runPieceworkPermissionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_piecework_action_permissions_td_805', 'security', 'td805', 'piecework', 'payroll', 'permissions', 'package12')) {
    await runCase(results, {
      id: 'sec_piecework_action_permissions_td_805',
      name: 'v9.0.320: each payroll action asks its own key; personnel.manage alone writes no piecework record (TD-805)',
      details: 'roles holding only personnel.manage, only settings.manage or another piecework key get 403 on task titles, categories, custom rates, work log create/edit/delete, payroll issue/status/voucher/delete and payment/void; piecework.manage_tasks writes titles, categories and rates; piecework.log writes logs and its manual rate is ignored on create and edit; piecework.payroll issues, re-statuses and deletes the payroll; piecework.pay reads the bank pick list, pays and voids the payment',
    }, async (h, wrong) => {
      const sessions = {
        personnel: await h.sessionWith(['personnel.view', 'personnel.manage']),
        settings: await h.sessionWith(['settings.manage']),
        tasks: await h.sessionWith(['piecework.view', 'piecework.manage_tasks']),
        log: await h.sessionWith(['piecework.view', 'piecework.log']),
        payroll: await h.sessionWith(['piecework.view', 'piecework.payroll']),
        pay: await h.sessionWith(['piecework.view', 'piecework.pay']),
      };
      type Who = keyof typeof sessions;
      const call = (method: 'post' | 'put' | 'del', url: string, s: Session, body: unknown = {}) =>
        method === 'del' ? h.del(url, s) : h[method](url, body, s);
      /** every role in `refused` gets 403 (nothing written), then `allowed` succeeds */
      const only = async (label: string, method: 'post' | 'put' | 'del', url: string, body: unknown, allowed: Who, refused: Who[]) => {
        for (const who of refused) {
          const res = await call(method, url, sessions[who], body);
          if (res.status !== 403) wrong.push(`${label}: ${who} got ${res.status}, not 403`);
        }
        const res = await call(method, url, sessions[allowed], body);
        if (res.status >= 300) wrong.push(`${label}: ${allowed} got ${res.status} ${JSON.stringify(res.body)}`);
        return res;
      };

      const worker = await newWorker('کارگر آزمون مجوز کارمزدی');
      const taskIds: number[] = [];
      const categoryIds: number[] = [];
      try {
        // titles and categories: piecework.manage_tasks only (settings.manage used to write categories, personnel.manage both)
        const created = await only('create task title', 'post', '/api/piecework/tasks',
          { code: `PWP${h.tag}`, title: `ERP-TEST-MARKER عنوان مجوز ${h.tag}`, defaultRate: '1000' }, 'tasks', ['personnel', 'settings', 'log', 'payroll', 'pay']);
        const taskId = Number(created.body?.id);
        if (!(taskId > 0)) return;
        taskIds.push(taskId);
        const cat = await only('create task category', 'post', '/api/piecework/categories',
          { name: `ERP-TEST-MARKER دسته مجوز ${h.tag}` }, 'tasks', ['personnel', 'settings', 'log']);
        if (Number(cat.body?.id) > 0) categoryIds.push(Number(cat.body.id));
        await only('edit task base rate', 'put', `/api/piecework/tasks/${taskId}`,
          { title: `ERP-TEST-MARKER عنوان مجوز ${h.tag}`, defaultRate: '2000' }, 'tasks', ['personnel', 'log']);

        // custom rate: piecework.manage_tasks only
        await only('set custom rate', 'post', '/api/piecework/personnel-rates',
          { personnelId: worker, taskId, customRate: '3000' }, 'tasks', ['personnel', 'log', 'payroll']);

        // work logs: piecework.log; a manual rate without piecework.manage_tasks is ignored on create and on edit
        const item = { personnelId: worker, taskId, date: '2026-04-05', quantity: 10, unitRate: '900000' };
        const logged = await only('create work log', 'post', '/api/piecework/logs', { items: [item] }, 'log', ['personnel', 'tasks', 'payroll', 'pay']);
        const logId = Number(logged.body?.insertedIds?.[0]);
        if (!(logId > 0)) return;
        const rateOf = async () => (await orm.select({ unitRate: pieceworkLogs.unitRate, quantity: pieceworkLogs.quantity })
          .from(pieceworkLogs).where(eq(pieceworkLogs.id, logId)))[0];
        let row = await rateOf();
        if (!row || !fin(row.unitRate).equals(3000)) wrong.push(`work log of piecework.log saved rate ${row?.unitRate}, not the custom rate 3000`);
        await only('edit work log', 'put', `/api/piecework/logs/${logId}`, { quantity: 12, unitRate: '900000' }, 'log', ['personnel', 'tasks', 'payroll']);
        row = await rateOf();
        if (!row || !fin(row.unitRate).equals(3000) || !fin(row.quantity).equals(12)) wrong.push(`edited work log has rate ${row?.unitRate} and quantity ${row?.quantity}, not 3000 and 12`);
        const spare = await h.post('/api/piecework/logs', { items: [{ ...item, quantity: 1 }] }, sessions.log);
        await only('delete work log', 'del', `/api/piecework/logs/${Number(spare.body?.insertedIds?.[0])}`, {}, 'log', ['personnel', 'tasks', 'payroll']);

        // payroll: piecework.payroll issues, re-statuses, syncs and deletes; piecework.pay pays and voids
        const issued = await only('issue payroll', 'post', '/api/piecework/payrolls',
          { personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30' }, 'payroll', ['personnel', 'pay', 'log']);
        const payrollId = Number(issued.body?.id);
        if (!(payrollId > 0)) return;
        await only('payroll back to draft', 'put', `/api/piecework/payrolls/${payrollId}/status`, { status: 'draft' }, 'payroll', ['personnel', 'pay']);
        await only('approve payroll', 'put', `/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' }, 'payroll', ['personnel', 'pay']);
        const sync = await h.post(`/api/piecework/payrolls/${payrollId}/sync-voucher`, {}, sessions.personnel);
        if (sync.status !== 403) wrong.push(`payroll voucher sync: personnel got ${sync.status}, not 403`);

        for (const who of ['personnel', 'payroll'] as const) {
          const options = await h.get('/api/accounting/bank-accounts/options', sessions[who]);
          if (options.status !== 403) wrong.push(`bank pick list: ${who} got ${options.status}, not 403`);
        }
        const options = await h.get('/api/accounting/bank-accounts/options', sessions.pay);
        if (options.status !== 200) wrong.push(`bank pick list: pay got ${options.status}, not 200`);
        const payrolls = await h.get('/api/piecework/payrolls', sessions.pay);
        if (payrolls.status !== 200) wrong.push(`payroll list: pay got ${payrolls.status}, not 200`);

        const bankId = await fundedBank();
        const paid = await only('pay payroll', 'post', `/api/piecework/payrolls/${payrollId}/register-payment`,
          { bankAccountId: bankId, method: 'cash', amount: '36000', paymentDate: '2026-05-01' }, 'pay', ['personnel', 'payroll']);
        const transactionId = Number(paid.body?.transactionId);
        if (!(transactionId > 0)) return;
        await only('void payment', 'post', `/api/piecework/payrolls/${payrollId}/payments/${transactionId}/void`,
          { reason: 'آزمون مجوز ابطال پرداخت' }, 'pay', ['personnel', 'payroll']);
        await only('delete payroll', 'del', `/api/piecework/payrolls/${payrollId}`, {}, 'payroll', ['personnel', 'pay']);

        await only('delete task title', 'del', `/api/piecework/tasks/${taskId}`, {}, 'tasks', ['personnel', 'log']);
      } finally {
        await orm.delete(pieceworkPersonnelRates).where(eq(pieceworkPersonnelRates.personnelId, worker)).catch(() => undefined);
        await orm.update(pieceworkPayrolls).set({ isDeleted: 1 }).where(eq(pieceworkPayrolls.personnelId, worker)).catch(() => undefined);
        await orm.update(pieceworkLogs).set({ isDeleted: 1 }).where(eq(pieceworkLogs.personnelId, worker)).catch(() => undefined);
        if (taskIds.length > 0) await orm.update(pieceworkTasks).set({ isDeleted: 1 }).where(inArray(pieceworkTasks.id, taskIds)).catch(() => undefined);
        if (categoryIds.length > 0) await orm.delete(taskCategories).where(inArray(taskCategories.id, categoryIds)).catch(() => undefined);
      }
    });
  }

  if (shouldRun('sec_piecework_action_permissions_migration_td_805', 'security', 'td805', 'piecework', 'permissions', 'migration', 'package12')) {
    await runCase(results, {
      id: 'sec_piecework_action_permissions_migration_td_805',
      name: 'v9.0.320: migration 0078 gives roles the piecework keys of what they did through personnel.manage or settings.manage, and logs it (TD-805)',
      details: 'a personnel.manage role gets piecework.view, manage_tasks, log, payroll and pay; a role already holding some gets only the missing ones; a settings.manage role gets piecework.view and manage_tasks; a role with neither key is untouched; one activity_logs row per changed role with before, after and added keys',
    }, async (h, wrong) => {
      const { runMigrationRolledBack } = await import('./workflowLifecycleTests.js');
      const codes = { manager: `td805_pm_${h.tag}`, partial: `td805_part_${h.tag}`, settings: `td805_set_${h.tag}`, plain: `td805_plain_${h.tag}` };
      const outcome = await runMigrationRolledBack('0078_piecework_action_permissions.sql', async (q) => {
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES
          ($1, $1, '["personnel.view","personnel.manage"]'::jsonb, 0),
          ($2, $2, '["piecework.view","piecework.log","personnel.manage"]'::jsonb, 0),
          ($3, $3, '["settings.manage"]'::jsonb, 0),
          ($4, $4, '["projects.view","piecework.view"]'::jsonb, 0)`, [codes.manager, codes.partial, codes.settings, codes.plain]);
      }, async (q) => ({
        roles: await q(`SELECT id, code, permissions FROM roles WHERE code = ANY($1::text[])`, [Object.values(codes)]),
        logs: await q(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0078_piecework_action_permissions' AND entity_id = ANY(
          SELECT id::text FROM roles WHERE code = ANY($1::text[])) ORDER BY id`, [Object.values(codes)]),
      }));
      const permsOf = (code: string) => JSON.stringify(outcome.roles.find(r => r.code === code)?.permissions ?? null);
      const expect = (code: string, perms: string[]) => {
        if (permsOf(code) !== JSON.stringify(perms)) wrong.push(`${code} after 0078: ${permsOf(code)}, expected ${JSON.stringify(perms)}`);
      };
      expect(codes.manager, ['personnel.view', 'personnel.manage', 'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll', 'piecework.pay']);
      expect(codes.partial, ['piecework.view', 'piecework.log', 'personnel.manage', 'piecework.manage_tasks', 'piecework.payroll', 'piecework.pay']);
      expect(codes.settings, ['settings.manage', 'piecework.view', 'piecework.manage_tasks']);
      expect(codes.plain, ['projects.view', 'piecework.view']);
      const idOf = (code: string) => String(outcome.roles.find(r => r.code === code)?.id);
      const logged = outcome.logs.map(l => String(l.entity_id)).sort();
      const expected = [idOf(codes.manager), idOf(codes.partial), idOf(codes.settings)].sort();
      if (JSON.stringify(logged) !== JSON.stringify(expected)) wrong.push(`activity_logs rows for roles ${logged.join(', ')}, expected ${expected.join(', ')}`);
      const partialLog = outcome.logs.find(l => String(l.entity_id) === idOf(codes.partial))?.details as { addedPermissions?: string[] } | undefined;
      if (JSON.stringify(partialLog?.addedPermissions) !== JSON.stringify(['piecework.manage_tasks', 'piecework.payroll', 'piecework.pay'])) {
        wrong.push(`logged keys added to the partial role: ${JSON.stringify(partialLog?.addedPermissions)}`);
      }
    });
  }


  if (shouldRun('sec_piecework_rate_readers_td_806', 'security', 'td806', 'piecework', 'rates', 'permissions', 'package12')) {
    await runCase(results, {
      id: 'sec_piecework_rate_readers_td_806',
      name: 'v9.0.321: a personnel custom rate is read by the piecework keys and the payroll amount readers only (TD-806)',
      details: 'decision t3 «الف»: GET /piecework/personnel-rates/:id answers piecework.view, piecework.log, piecework.manage_tasks, piecework.payroll, piecework.pay, personnel.manage and accounting.treasury with the rate, and projects.view and settings.manage with 403; those two still read task titles and categories, and get no work log without a project id',
    }, async (h, wrong) => {
      const worker = await newWorker('کارگر آزمون خواننده نرخ');
      const taskId = await newTask();
      try {
        await orm.insert(pieceworkPersonnelRates).values({ personnelId: worker, taskId, customRate: money(333000) });
        const readers = ['piecework.view', 'piecework.log', 'piecework.manage_tasks', 'piecework.payroll', 'piecework.pay', 'personnel.manage', 'accounting.treasury'];
        for (const key of readers) {
          const res = await h.get(`/api/piecework/personnel-rates/${worker}`, await h.sessionWith([key]));
          const rates = Array.isArray(res.body) ? res.body as Array<{ taskId?: number; customRate?: unknown }> : [];
          const rate = rates.find((r) => Number(r.taskId) === taskId);
          if (res.status !== 200 || !rate || !fin(rate.customRate as string).equals(333000)) {
            wrong.push(`${key} reading custom rates got ${res.status} ${JSON.stringify(res.body)}, not 200 with 333000`);
          }
        }
        for (const key of ['projects.view', 'settings.manage']) {
          const s = await h.sessionWith([key]);
          const rates = await h.get(`/api/piecework/personnel-rates/${worker}`, s);
          if (rates.status !== 403) wrong.push(`${key} reading custom rates got ${rates.status}, not 403`);
          const logs = await h.get('/api/piecework/logs', s);
          if (logs.status !== 403) wrong.push(`${key} reading every work log got ${logs.status}, not 403`);
          for (const url of ['/api/piecework/tasks', '/api/piecework/categories']) {
            const res = await h.get(url, s);
            if (res.status !== 200) wrong.push(`${key} reading ${url} got ${res.status}, not 200`);
          }
        }
      } finally {
        await orm.delete(pieceworkPersonnelRates).where(eq(pieceworkPersonnelRates.personnelId, worker)).catch(() => undefined);
        await orm.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.id, taskId)).catch(() => undefined);
      }
    });
  }
  return results;
}
