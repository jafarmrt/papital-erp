import { and, eq, inArray } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, itemPrices, journalVouchers, personnel, pieceworkPayrolls } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { DocumentService } from '../../services/document.service.js';
import { ProjectService } from '../../services/projects.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, legacyZeroCostEntry, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.114 — سناریوهای سخت‌گیرانه گروه حسابداری و بهای تمام‌شده (TD-413، TD-400، TD-401، TD-402) برای سوئیت
 * business_invariants. هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

let seq = 0;
const tag = () => `${Date.now().toString().slice(-7)}${++seq}`;

/** ردیف‌های فعال سند حسابداری یک سند انبار: کد حساب ← خالص (بدهکار − بستانکار) */
async function voucherNetByCode(documentId: number): Promise<Map<string, string>> {
  const res = await pool.query<{ code: string; net: string }>(
    `SELECT a.code, SUM(i.debit - i.credit)::text AS net FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 GROUP BY a.code`, [documentId]);
  return new Map(res.rows.map(r => [r.code, fin(r.net).toString()]));
}

function outflow(docType: 'remittance' | 'waste', itemId: number, quantity: number, wh: string, date: string, projectId?: number): Promise<number> {
  return DocumentService.createDocument({
    docType, inOut: 'out', status: 'final', date, user: 'inv', items: [{ itemId, quantity, unitPrice: 0, location: wh }],
    ...(projectId ? { projectId } : {}),
  });
}

/**
 * TD-413: حساب ۶۰۰۱ «بهای تمام‌شده کالای فروش‌رفته» نام دارد و ضایعات حساب جدای «ضایعات و افت کیفی» (۶۰۰۴) از نگاشت
 * حساب‌ها می‌گیرد؛ با نگاشت سفارشی سند ضایعات همان حساب را بدهکار می‌کند. پیش‌تر سند ضایعات کد ثابت ۶۰۰۳ (سربار) داشت.
 */
export async function checkWasteAccountFromMapping(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const named = await pool.query<{ code: string; name: string }>(
    `SELECT code, name FROM accounts WHERE code IN ('6001', '6003', '6004') AND is_deleted = 0 ORDER BY code`);
  const names = new Map(named.rows.map(r => [r.code, r.name]));
  if (names.get('6001') !== 'بهای تمام‌شده کالای فروش‌رفته') problems.push(`Name of account 6001: "${names.get('6001') ?? '-'}"`);
  if (names.get('6004') !== 'ضایعات و افت کیفی') problems.push(`Account 6004 is not "waste and quality loss": "${names.get('6004') ?? '-'}"`);
  if ((names.get('6003') ?? '').includes('ضایعات')) problems.push(`The name of 6003 still mentions waste: "${names.get('6003')}"`);

  const mark = await watermarks();
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [material.id] };
  await receive(material.id, 10, 1000, wh, '2026-06-01');
  const standard = await outflow('waste', material.id, 1, wh, '2026-06-02');
  const net = await voucherNetByCode(standard);
  if (net.get('6004') !== '1000') problems.push(`Waste with the default mapping did not debit 6004 with 1000: ${JSON.stringify([...net])}`);
  if (net.has('6003')) problems.push('The waste voucher still used the fixed account 6003');

  const previous = await AccountMappingService.getMappings();
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '60'), eq(accounts.isDeleted, 0)));
  const code = `60${tag()}`;
  await orm.insert(accounts).values({
    code, name: 'ضایعات (نگاشت آزمون TD-413)', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'cost_of_sales', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  });
  try {
    await AccountMappingService.saveMappings({ wasteExpenseAccountCode: code });
    const mapped = await outflow('waste', material.id, 2, wh, '2026-06-03');
    const mappedNet = await voucherNetByCode(mapped);
    if (mappedNet.get(code) !== '2000') problems.push(`Waste with a custom mapping did not debit account ${code} with 2000: ${JSON.stringify([...mappedNet])}`);
  } finally {
    await AccountMappingService.saveMappings({ wasteExpenseAccountCode: previous.wasteExpenseAccountCode });
  }
  problems.push(...await invariantProblems(scope, 'after the waste documents'));
  return problems;
}

/**
 * TD-400: سند حسابداری حواله و ضایعات به بهای ردیف‌های خروج کاردکس همان سند است؛ رسید تازه‌ای که WAC را عوض کند و
 * همگام‌سازی دوباره سند پیش‌نویس عدد را عوض نمی‌کنند. پیش‌تر سند WAC لحظه صدور را می‌خواند.
 */
export async function checkOutflowVoucherAtKardexCost(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [material.id, product.id] };
  await receive(material.id, 10, 1000, wh, '2026-06-10');
  await receive(product.id, 10, 5000, wh, '2026-06-10');
  const remittance = await DocumentService.createDocument({
    docType: 'remittance', inOut: 'out', status: 'final', date: '2026-06-11', user: 'inv',
    items: [
      { itemId: material.id, quantity: 1, unitPrice: 0, location: wh },
      { itemId: material.id, quantity: 1, unitPrice: 0, location: wh },
      { itemId: product.id, quantity: 1, unitPrice: 0, location: wh },
    ],
  });
  const waste = await outflow('waste', material.id, 3, wh, '2026-06-11');
  // رسید تازه WAC مواد را از ۱۰۰۰ به ۳۰۰۰ و محصول را از ۵۰۰۰ به ۷۰۰۰ می‌برد
  await receive(material.id, 10, 4000, wh, '2026-06-12');
  await receive(product.id, 9, 9000, wh, '2026-06-12');
  for (const docId of [remittance, waste]) {
    await VoucherSyncService.syncWarehouseDocumentVoucher(docId, { username: 'inv' });
  }
  const remNet = await voucherNetByCode(remittance);
  // v10.0.175 (TD-948): a remittance without a project is unassigned consumption (6003), not work in progress
  const expectRem: Array<[string, string]> = [['6003', '7000'], ['1401', '-2000'], ['1403', '-5000']];
  for (const [code, expected] of expectRem) {
    if (remNet.get(code) !== expected) problems.push(`Remittance after re-sync: ${code} = ${remNet.get(code) ?? '0'}, expected ${expected} (Kardex cost)`);
  }
  const wasteNet = await voucherNetByCode(waste);
  if (wasteNet.get('1401') !== '-3000') problems.push(`Waste after re-sync: 1401 = ${wasteNet.get('1401') ?? '0'}, expected -3000 (Kardex cost)`);
  problems.push(...await invariantProblems(scope, 'after re-syncing the remittance and waste'));
  return problems;
}

/**
 * TD-401: بررسی سلامت مالی ارزش انبار را فقط به WAC می‌سنجد؛ قیمت فهرست فروش کالای بی‌WAC ارزش انبار را عوض نمی‌کند
 * و چنین کالایی جدا شمرده می‌شود. پیش‌تر نخستین قیمت فهرست فروش جای WAC صفر می‌نشست.
 */
export async function checkHealthValuationAtWacOnly(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  // v9.0.453 (TD-906): a receipt document refuses this line now; the stock without cost is a legacy entry
  await legacyZeroCostEntry(item.id, 5, wh, '2026-06-15');
  const metricsOf = async () => {
    const report = await FinancialHealthService.runHealthCheck();
    const test = report.tests.find(t => t.id === 'inventory_reconciliation');
    return test?.metrics ?? {};
  };
  const before = await metricsOf();
  await orm.insert(itemPrices).values({ itemId: item.id, title: 'قیمت فروش آزمون TD-401', price: money(1000000), currency: 'IRR', isDeleted: 0 });
  const after = await metricsOf();
  if (String(after.warehouseValuation) !== String(before.warehouseValuation)) {
    problems.push(`The sales price list moved the warehouse value from ${String(before.warehouseValuation)} to ${String(after.warehouseValuation)}`);
  }
  if (!(Number(after.unvaluedStockCount) >= 1)) problems.push(`The item with stock and no WAC was not counted: ${String(after.unvaluedStockCount)}`);
  return problems;
}

/**
 * TD-402: سند فیش حقوق مبالغ فیش را دقیق (FinancialDecimal) می‌گیرد. مبلغ بزرگ با چهار رقم اعشار پیش‌تر با Number()
 * گرد می‌شد و ردیف سند با فیش یکی نبود.
 */
export async function checkPayrollVoucherExactAmounts(): Promise<string[]> {
  const problems: string[] = [];
  const [worker] = await orm.insert(personnel).values({ fullName: `پرسنل آزمون TD-402 ${tag()}`, salaryType: 'mixed', monthlySalary: money(0) })
    .returning({ id: personnel.id });
  const amounts = { piecework: '12345678901234.5678', bonus: '0.0003', fixed: '1.1111', deductions: '0.0001' };
  const [pay] = await orm.insert(pieceworkPayrolls).values({
    payrollNumber: `PAY-TD402-${tag()}`, personnelId: worker.id, startDate: '2026-06-01', endDate: '2026-06-30', title: 'فیش آزمون TD-402',
    totalPieceworkAmount: money(amounts.piecework), totalBonuses: money(amounts.bonus), totalFixedAmount: money(amounts.fixed),
    totalDeductions: money(amounts.deductions), advanceDeduction: money(0), netPayable: money('12345678901235.6791'), status: 'draft',
  }).returning({ id: pieceworkPayrolls.id });
  const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(pay.id, undefined, 'inv', undefined, { strict: true });
  if (!voucher) return ['سند فیش صادر نشد'];
  const rows = await pool.query<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, i.debit::text AS debit, i.credit::text AS credit FROM journal_voucher_items i JOIN accounts a ON a.id = i.account_id
      WHERE i.voucher_id = $1 AND i.is_deleted = 0 ORDER BY i.id`, [voucher.id]);
  const byCode = new Map(rows.rows.map(r => [r.code, fin(r.debit).subtract(r.credit).toString()]));
  const expected: Array<[string, string]> = [['6002', amounts.piecework], ['6003', '1.1114'], ['3205', '-0.0001'], ['3201', '-12345678901235.6791']];
  for (const [code, value] of expected) {
    if (byCode.get(code) !== value) problems.push(`Row ${code} of the payslip voucher ${byCode.get(code) ?? '0'}, expected ${value}`);
  }
  return problems;
}

/**
 * TD-964: the stock vs ledger health check compares the warehouse value with the inventory accounts only. Work in
 * progress (1402) is outside the warehouse: a remittance to production or a material allocation moves value there, and
 * the check counted it as stock, so every approved remittance left a warning. Draft vouchers stay out of the ledger
 * value but their share is reported, so the gap that approving them closes is visible.
 */
export async function checkHealthLedgerExcludesWorkInProgress(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const metricsOf = async () => {
    const report = await FinancialHealthService.runHealthCheck();
    return report.tests.find(t => t.id === 'inventory_reconciliation')?.metrics ?? {};
  };
  const delta = (after: Record<string, unknown>, before: Record<string, unknown>, key: string) =>
    fin(String(after[key] ?? 0)).subtract(fin(String(before[key] ?? 0))).toString();
  const before = await metricsOf();
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const receipt = await receive(material.id, 10, 1000, wh, '2026-06-20');
  // v10.0.175 (TD-948): only a project remittance moves work in progress
  const { project } = await ProjectService.createProject({ title: `Health WIP ${tag()}`, quantity: 1, products: [] } as unknown as Parameters<typeof ProjectService.createProject>[0]);
  const remittance = await outflow('remittance', material.id, 4, wh, '2026-06-21', project.id);
  const drafted = await metricsOf();
  if (delta(drafted, before, 'warehouseValuation') !== '6000') problems.push(`Warehouse value moved by ${delta(drafted, before, 'warehouseValuation')}, expected 6000`);
  if (delta(drafted, before, 'ledgerValuation') !== '0') problems.push(`Draft vouchers moved the ledger value by ${delta(drafted, before, 'ledgerValuation')}, expected 0`);
  if (delta(drafted, before, 'draftLedgerValuation') !== '6000') problems.push(`Draft share moved by ${delta(drafted, before, 'draftLedgerValuation')}, expected 6000`);
  await orm.update(journalVouchers).set({ status: 'approved' }).where(inArray(journalVouchers.sourceDocumentId, [receipt, remittance]));
  const approved = await metricsOf();
  if (delta(approved, before, 'ledgerValuation') !== '6000') problems.push(`Approved vouchers moved the ledger value by ${delta(approved, before, 'ledgerValuation')}, expected 6000 (work in progress counted as stock)`);
  if (delta(approved, before, 'workInProgressValuation') !== '4000') problems.push(`Work in progress moved by ${delta(approved, before, 'workInProgressValuation')}, expected 4000`);
  if (delta(approved, before, 'draftLedgerValuation') !== '0') problems.push(`Draft share after approval moved by ${delta(approved, before, 'draftLedgerValuation')}, expected 0`);
  return problems;
}

/** جدول آزمون‌های گروه حسابداری و بهای تمام‌شده در سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const ACCOUNTING_COST_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_413_waste_account_from_mapping', 'v8.0.114: 6001 is named "cost of goods sold" and the waste voucher debits the "waste and quality loss" account (6004) or the mapped account, not overhead 6003 (TD-413, option A)',
    checkWasteAccountFromMapping, 'Names correct; waste 1000 to 6004 and, with a custom mapping, 2000 to that account'],
  ['inv_td_400_outflow_voucher_at_kardex_cost', 'v8.0.115: the remittance and waste journal voucher is at the Kardex cost of the same document, and a new receipt or a re-sync does not change its amount (TD-400)',
    checkOutflowVoucherAtKardexCost, 'Remittance 7000 (materials 2000, product 5000) and waste 3000 stayed after the WAC change'],
  ['inv_td_401_health_valuation_at_wac_only', 'v8.0.116: warehouse value in the financial health check is at WAC only and the sales price list of an item without WAC does not change it (TD-401)',
    checkHealthValuationAtWacOnly, 'A sales price of 1,000,000 did not change the warehouse value; the item without WAC was counted'],
  ['inv_td_402_payroll_voucher_exact_amounts', 'v8.0.117: the payslip voucher takes the payslip amounts exactly, even a fourteen-digit amount with four decimals (TD-402)',
    () => checkPayrollVoucherExactAmounts(), 'Rows exactly 12345678901234.5678, 1.1114, 0.0001 and 12345678901235.6791'],
  ['inv_td_964_health_ledger_excludes_wip', 'v10.0.7: the stock vs ledger health check leaves work in progress (1402) out of the ledger value and reports the draft voucher share (TD-964)',
    checkHealthLedgerExcludesWorkInProgress, 'Ledger moved 6000 with the warehouse; work in progress 4000 shown apart; draft share 6000 before approval'],
];
