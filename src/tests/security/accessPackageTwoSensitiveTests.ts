import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { roles } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M3 — اطلاعات بانکی پرسنل و فیش فقط با مجوز (TD-882)، از مسیرهای واقعی Express با ورود واقعی.
 * هر آزمون روی کد پیشین قرمز است.
 */

const CARD = '6037991234567890';

async function createPersonnelWithCard(h: Harness): Promise<number> {
  const created = await h.post('/api/personnel', {
    firstName: 'مریم', lastName: `آزمون ${h.tag}`, personnelCode: `S882-${h.tag}`, jobTitle: 'زرگر', employmentStatus: 'فعال',
    salaryType: 'monthly_fixed', monthlySalary: 30000000, cardNumber: CARD, shebaNumber: 'IR120120000000001234567890', accountNumber: '123456789',
  });
  if (created.status !== 201) throw new Error(`creating personnel returned ${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);
  return Number(created.body.id);
}

export async function runAccessPackageTwoSensitiveTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_sensitive_personnel_permissions_td_882', 'security', 'td882', 'personnel', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_sensitive_personnel_permissions_td_882',
      name: 'v9.0.109: unmasked personnel and payslip bank details need a catalog permission; the role code manager and «*» no longer open them (TD-882)',
      details: 'a role with personnel.view_sensitive can be saved and sees the card number; the seed manager role without the keys sees it masked; payroll.view_sensitive opens payslips only (GET /api/piecework/payrolls); «*» opens nothing; personnel.manage opens both',
    }, async (h, wrong) => {
      const { invalidateRoleCache } = await import('../../lib/memoryCache.js');
      const pid = await createPersonnelWithCard(h);
      const cardSeenBy = async (s: Awaited<ReturnType<Harness['sessionWith']>>) => {
        const res = await h.get(`/api/personnel/${pid}`, s);
        if (res.status !== 200) throw new Error(`reading the personnel returned ${res.status}`);
        return res.body?.cardNumber === CARD;
      };

      // 1) the key is a catalog key: a role holding it is saved and its user sees the card number
      const code = `td882_sens_${h.tag}`;
      const saved = await h.post('/api/roles', { name: `نقش ۸۸۲ ${h.tag}`, code, permissions: ['personnel.view', 'personnel.view_sensitive'] });
      if (saved.status !== 200 && saved.status !== 201) {
        wrong.push(`saving a role with personnel.view_sensitive returned ${saved.status}: ${JSON.stringify(saved.body).slice(0, 160)}`);
      } else {
        try {
          if (!await cardSeenBy(await h.sessionWith(code))) wrong.push('personnel.view_sensitive did not show the card number');
        } finally {
          await orm.delete(roles).where(eq(roles.code, code));
        }
      }

      // 2) the role coded manager opens nothing by its code
      const [manager] = await orm.select({ permissions: roles.permissions }).from(roles).where(eq(roles.code, 'manager'));
      try {
        await orm.update(roles).set({ permissions: ['personnel.view'] }).where(eq(roles.code, 'manager'));
        invalidateRoleCache('manager');
        if (await cardSeenBy(await h.sessionWith('manager'))) wrong.push('the manager role without the keys saw the card number by its code');
      } finally {
        await orm.update(roles).set({ permissions: manager?.permissions ?? [] }).where(eq(roles.code, 'manager'));
        invalidateRoleCache('manager');
      }

      // 3) payroll.view_sensitive opens payslips only, «*» opens nothing, personnel.manage opens both
      const payroll = await h.post('/api/piecework/payrolls', { personnelId: pid, startDate: '2026-03-21', endDate: '2026-04-20', title: `فیش ۸۸۲ ${h.tag}` });
      if (payroll.status !== 200 && payroll.status !== 201) throw new Error(`creating the payroll returned ${payroll.status}: ${JSON.stringify(payroll.body).slice(0, 160)}`);
      const payslipCardSeenBy = async (s: Awaited<ReturnType<Harness['sessionWith']>>) => {
        const res = await h.get(`/api/piecework/payrolls?personnelId=${pid}`, s);
        const rows = Array.isArray(res.body) ? res.body : [];
        if (res.status !== 200 || rows.length === 0) throw new Error(`reading the payslips returned ${res.status} with ${rows.length} rows`);
        return rows.every((r: { cardNumber?: string }) => r.cardNumber === CARD);
      };
      const payrollOnly = await h.sessionWith(['personnel.view', 'piecework.view', 'piecework.payroll', 'payroll.view_sensitive']);
      if (await cardSeenBy(payrollOnly)) wrong.push('payroll.view_sensitive showed the personnel card number');
      if (!await payslipCardSeenBy(payrollOnly)) wrong.push('payroll.view_sensitive did not show the payslip card number');
      if (await payslipCardSeenBy(await h.sessionWith(['piecework.view', 'piecework.payroll']))) wrong.push('a payroll reader without the key saw the payslip card number');
      const star = await h.sessionWith(['*', 'personnel.view', 'piecework.view', 'piecework.payroll']);
      if (await cardSeenBy(star)) wrong.push('«*» showed the personnel card number');
      if (await payslipCardSeenBy(star)) wrong.push('«*» showed the payslip card number');
      const managerKey = await h.sessionWith(['personnel.view', 'personnel.manage']);
      if (!await cardSeenBy(managerKey)) wrong.push('personnel.manage did not show the card number');
      if (!await payslipCardSeenBy(managerKey)) wrong.push('personnel.manage did not show the payslip card number');
      await h.q(`UPDATE piecework_payrolls SET is_deleted = 1 WHERE personnel_id = $1`, [pid]);
      await h.q(`UPDATE personnel SET is_deleted = 1 WHERE id = $1`, [pid]);
    });
  }

  if (shouldRun('sec_sensitive_personnel_migration_td_882', 'security', 'td882', 'permissions', 'package2', 'migration')) {
    await runCase(results, {
      id: 'sec_sensitive_personnel_migration_td_882',
      name: 'v9.0.109: migration 0064 gives the seed manager both bank-detail keys and the other key to roles holding one, and logs every change (TD-882)',
      details: 'seed manager without the keys gets personnel.view_sensitive and payroll.view_sensitive; a role with only payroll.view_sensitive gets personnel.view_sensitive; a custom role coded manager-like and a role with neither key are untouched; one activity_logs row per changed role',
    }, async (h, wrong) => {
      const { runMigrationRolledBack } = await import('./workflowLifecycleTests.js');
      const legacy = `td882_legacy_${h.tag}`;
      const plain = `td882_plain_${h.tag}`;
      const outcome = await runMigrationRolledBack('0064_sensitive_personnel_permissions.sql', async (q) => {
        await q(`UPDATE roles SET permissions = '["personnel.view","personnel.manage"]'::jsonb, is_system = 1 WHERE code = 'manager'`);
        await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ($1, $1, '["piecework.view","payroll.view_sensitive"]'::jsonb, 0), ($2, $2, '["personnel.view"]'::jsonb, 0)`, [legacy, plain]);
      }, async (q) => ({
        roles: await q(`SELECT id, code, permissions FROM roles WHERE code = ANY($1::text[])`, [['manager', legacy, plain]]),
        logs: await q(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0064_sensitive_personnel_permissions' ORDER BY id`),
      }));
      const permsOf = (code: string) => JSON.stringify(outcome.roles.find(r => r.code === code)?.permissions ?? null);
      if (permsOf('manager') !== JSON.stringify(['personnel.view', 'personnel.manage', 'personnel.view_sensitive', 'payroll.view_sensitive'])) wrong.push(`manager after 0064: ${permsOf('manager')}`);
      if (permsOf(legacy) !== JSON.stringify(['piecework.view', 'payroll.view_sensitive', 'personnel.view_sensitive'])) wrong.push(`legacy role after 0064: ${permsOf(legacy)}`);
      if (permsOf(plain) !== JSON.stringify(['personnel.view'])) wrong.push(`a role with neither key changed: ${permsOf(plain)}`);
      const idOf = (code: string) => String(outcome.roles.find(r => r.code === code)?.id);
      const logged = outcome.logs.map(l => String(l.entity_id)).sort();
      const expected = [idOf('manager'), idOf(legacy)].sort();
      if (JSON.stringify(logged) !== JSON.stringify(expected)) wrong.push(`activity_logs rows for roles ${logged.join(', ')}, expected ${expected.join(', ')}`);
    });
  }

  return results;
}
