import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { roles } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type ShouldRun } from './workflowTestHarness.js';
import { deleteTestRoles } from '../fixtures/roleCleanup.js';

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
          await deleteTestRoles(eq(roles.code, code));
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

  return results;
}
