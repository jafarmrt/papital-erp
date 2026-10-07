import fs from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, appSettings } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { DEFAULT_ACCOUNT_MAPPINGS } from '../../services/accounting/accountMapping.service.js';
import { addLog, newTask, newWorker, personNet } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Package 3 PR «ز»: payslip deductions get their own liability account (decision t6 «الف»). Each scenario runs in its
 * own isolated schema with the standard chart of accounts and is red on the version before its fix.
 */

const PERIOD = { startDate: '2026-04-01', endDate: '2026-04-30' };
const MAPPINGS_KEY = 'accounting_account_mappings';
const MIGRATION = '0076_payroll_deductions_account.sql';

const brief = (body: unknown) => JSON.stringify(body).slice(0, 200);

async function storedMappings(): Promise<Record<string, string>> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, MAPPINGS_KEY));
  return row ? JSON.parse(row.value) as Record<string, string> : {};
}

async function storeMappings(value: Record<string, string>): Promise<void> {
  await orm.insert(appSettings).values({ key: MAPPINGS_KEY, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(value) } });
}

async function runMigration(): Promise<void> {
  const text = fs.readFileSync(path.join(process.cwd(), 'drizzle', MIGRATION), 'utf8');
  for (const stmt of text.split('--> statement-breakpoint')) {
    if (stmt.replace(/--.*$/gm, '').trim()) await pool.query(stmt);
  }
}

async function activeAccount(code: string) {
  const [row] = await orm.select({ id: accounts.id, name: accounts.name, level: accounts.level, parentId: accounts.parentId, accountType: accounts.accountType, nature: accounts.nature, isSystem: accounts.isSystem })
    .from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  return row;
}

async function deductionsHealth() {
  const report = await FinancialHealthService.runHealthCheck();
  return report.tests.find(t => t.id === 'payroll_deductions_in_customer_prepayments');
}

export async function runPayrollDeductionAccountTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_payroll_deductions_own_account_td_554';
  if (shouldRun(id, 'td554', 'payroll', 'deductions', 'package3')) {
    await runCase(results, id, 'v9.0.275: payslip deductions credit the new standard account 3205 «employee deductions payable» instead of 3202 «customer prepayments», migration 0076 adds 3205 to an existing chart and moves a stored default mapping, past vouchers are not moved and the health check lists the personnel deductions left on 3202 until a correction voucher moves them (TD-554)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const general = await accountIdsByCode('32');

      // 1) the standard chart has 3205 under 32 as a credit liability, and the default mapping points to it
      const standard = await activeAccount('3205');
      if (!standard) problems.push('the standard chart has no account 3205');
      else if (standard.parentId !== general['32'] || standard.level !== 'subsidiary' || standard.accountType !== 'liability' || standard.nature !== 'credit' || standard.isSystem !== 1 || !standard.name.includes('کسورات حقوق')) {
        problems.push(`account 3205 is ${brief(standard)}, expected a system credit liability subsidiary under 32 named for payslip deductions`);
      }
      if (DEFAULT_ACCOUNT_MAPPINGS.employeeDeductionsPayableAccountCode !== '3205') {
        problems.push(`the default deductions mapping is ${DEFAULT_ACCOUNT_MAPPINGS.employeeDeductionsPayableAccountCode}, expected 3205`);
      }

      // 2) migration 0076 on an older install: no 3205 yet and a mapping saved with the old default 3202
      if (standard) await orm.update(accounts).set({ isDeleted: 1 }).where(eq(accounts.id, standard.id));
      const saved = { ...DEFAULT_ACCOUNT_MAPPINGS, employeeDeductionsPayableAccountCode: '3202' };
      await storeMappings(saved);
      await runMigration();
      const added = await activeAccount('3205');
      if (!added || added.parentId !== general['32'] || added.accountType !== 'liability' || added.nature !== 'credit') problems.push(`migration 0076 left 3205 as ${brief(added)}`);
      const afterMigration = await storedMappings();
      if (afterMigration.employeeDeductionsPayableAccountCode !== '3205') problems.push(`migration 0076 left the stored deductions mapping at ${afterMigration.employeeDeductionsPayableAccountCode}`);
      if (afterMigration.salesRevenueAccountCode !== saved.salesRevenueAccountCode || afterMigration.wagesPayableAccountCode !== saved.wagesPayableAccountCode) problems.push('migration 0076 changed another stored mapping');
      const logged = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM activity_logs WHERE details->>'migration' = '0076_payroll_deductions_account'`);
      if (Number(logged.rows[0]?.n) !== 1) problems.push(`migration 0076 wrote ${logged.rows[0]?.n} audit rows, expected 1`);
      // a second run adds nothing, and a mapping the user chose (not the old default) is kept
      await storeMappings({ ...saved, employeeDeductionsPayableAccountCode: '3204' });
      await runMigration();
      const count3205 = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM accounts WHERE code = '3205' AND is_deleted = 0`);
      if (Number(count3205.rows[0]?.n) !== 1) problems.push(`after a second run there are ${count3205.rows[0]?.n} active 3205 accounts`);
      if ((await storedMappings()).employeeDeductionsPayableAccountCode !== '3204') problems.push('migration 0076 overwrote a chosen deductions mapping 3204');
      await storeMappings({ ...saved, employeeDeductionsPayableAccountCode: '3205' });

      // 3) B03-12 S15: a payslip of 1,000,000 with deductions 150,000 credits 3205, not 3202
      const task = await newTask();
      const worker = await newWorker('TD-554 worker');
      await addLog(worker, task, '2026-04-05', 1_000_000);
      const pay = await admin.post('/api/piecework/payrolls/generate', { personnelId: worker, ...PERIOD, deductions: 150000 });
      if (pay.status !== 200 && pay.status !== 201) problems.push(`the payslip answered ${pay.status} ${brief(pay.body)}`);
      const on3205 = await personNet('3205', worker);
      const on3202 = await personNet('3202', worker);
      if (!fin(on3205).equals(-150000) || !fin(on3202).isZero()) problems.push(`the deductions went 3205 ${on3205} / 3202 ${on3202}, expected credit 150,000 on 3205 and nothing on 3202`);
      const clean = await deductionsHealth();
      if (!clean || clean.status !== 'healthy') problems.push(`health check payroll_deductions_in_customer_prepayments is ${clean?.status} before any legacy row`);

      // 4) a voucher posted by an older version (deductions on 3202) is not moved, and the health check lists it
      await storeMappings({ ...saved, employeeDeductionsPayableAccountCode: '3202' });
      const legacyWorker = await newWorker('TD-554 legacy worker');
      await addLog(legacyWorker, task, '2026-04-06', 2_000_000);
      const legacyPay = await admin.post('/api/piecework/payrolls/generate', { personnelId: legacyWorker, ...PERIOD, deductions: 300000 });
      if (legacyPay.status !== 200 && legacyPay.status !== 201) problems.push(`the legacy payslip answered ${legacyPay.status} ${brief(legacyPay.body)}`);
      await storeMappings({ ...saved, employeeDeductionsPayableAccountCode: '3205' });
      if (!fin(await personNet('3202', legacyWorker)).equals(-300000)) problems.push(`the legacy deductions on 3202 are ${await personNet('3202', legacyWorker)}, expected credit 300,000 left as posted`);
      const listed = await deductionsHealth();
      const items = listed?.items ?? [];
      if (!listed || listed.status !== 'warning' || items.length !== 1 || Number(items[0]?.id) !== legacyWorker) {
        problems.push(`health check payroll_deductions_in_customer_prepayments: ${listed?.status} ${brief(items)}, expected warning with personnel ${legacyWorker} only`);
      } else if (!String(items[0]?.subtitle ?? '').includes('۳۰۰٬۰۰۰')) problems.push(`the listed subtitle is ${JSON.stringify(items[0]?.subtitle)}, expected the amount 300,000 in Persian digits`);

      // 5) a correction voucher that moves the amount to 3205 with the personnel detail clears the listing
      const acc = await accountIdsByCode('3202', '3205');
      const today = await businessTodayIsoDate();
      const name = String(items[0]?.title ?? 'TD-554');
      await VoucherService.createJournalVoucher({
        date: today, voucherType: 'general', status: 'approved', description: 'TD-554 move deductions', referenceModule: 'manual',
        items: [
          { accountId: acc['3202'], debit: 300000, credit: 0, detailedType: 'personnel', detailedId: legacyWorker, detailedName: name },
          { accountId: acc['3205'], debit: 0, credit: 300000, detailedType: 'personnel', detailedId: legacyWorker, detailedName: name },
        ],
      });
      const moved = await deductionsHealth();
      if (!moved || moved.status !== 'healthy') problems.push(`after the correction voucher the health check is ${moved?.status} ${brief(moved?.items)}`);

      assertNoProblems(problems);
      return 'payslip deductions 150,000 on 3205; migration added 3205 and moved the stored default only; legacy 300,000 on 3202 listed until moved';
    }));
  }

  return results;
}
