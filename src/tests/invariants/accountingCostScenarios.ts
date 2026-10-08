import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, itemPrices, personnel, pieceworkPayrolls } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, receive, watermarks } from './scenarioHelpers.js';

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

function outflow(docType: 'remittance' | 'waste', itemId: number, quantity: number, wh: string, date: string): Promise<number> {
  return DocumentService.createDocument({
    docType, inOut: 'out', status: 'final', date, user: 'inv', items: [{ itemId, quantity, unitPrice: 0, location: wh }],
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
  if (names.get('6001') !== 'بهای تمام‌شده کالای فروش‌رفته') problems.push(`نام حساب ۶۰۰۱: «${names.get('6001') ?? '-'}»`);
  if (names.get('6004') !== 'ضایعات و افت کیفی') problems.push(`حساب ۶۰۰۴ «ضایعات و افت کیفی» نیست: «${names.get('6004') ?? '-'}»`);
  if ((names.get('6003') ?? '').includes('ضایعات')) problems.push(`نام ۶۰۰۳ هنوز ضایعات دارد: «${names.get('6003')}»`);

  const mark = await watermarks();
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [material.id] };
  await receive(material.id, 10, 1000, wh, '2026-06-01');
  const standard = await outflow('waste', material.id, 1, wh, '2026-06-02');
  const net = await voucherNetByCode(standard);
  if (net.get('6004') !== '1000') problems.push(`ضایعات با نگاشت پیش‌فرض ۶۰۰۴ را ۱۰۰۰ بدهکار نکرد: ${JSON.stringify([...net])}`);
  if (net.has('6003')) problems.push('سند ضایعات هنوز حساب ثابت ۶۰۰۳ را گرفت');

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
    if (mappedNet.get(code) !== '2000') problems.push(`ضایعات با نگاشت سفارشی حساب ${code} را ۲۰۰۰ بدهکار نکرد: ${JSON.stringify([...mappedNet])}`);
  } finally {
    await AccountMappingService.saveMappings({ wasteExpenseAccountCode: previous.wasteExpenseAccountCode });
  }
  problems.push(...await invariantProblems(scope, 'پس از اسناد ضایعات'));
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
  const expectRem: Array<[string, string]> = [['1402', '7000'], ['1401', '-2000'], ['1403', '-5000']];
  for (const [code, expected] of expectRem) {
    if (remNet.get(code) !== expected) problems.push(`حواله پس از همگام‌سازی دوباره: ${code} = ${remNet.get(code) ?? '0'}، انتظار ${expected} (بهای کاردکس)`);
  }
  const wasteNet = await voucherNetByCode(waste);
  if (wasteNet.get('1401') !== '-3000') problems.push(`ضایعات پس از همگام‌سازی دوباره: ۱۴۰۱ = ${wasteNet.get('1401') ?? '0'}، انتظار -3000 (بهای کاردکس)`);
  problems.push(...await invariantProblems(scope, 'پس از همگام‌سازی دوباره حواله و ضایعات'));
  return problems;
}

/**
 * TD-401: بررسی سلامت مالی ارزش انبار را فقط به WAC می‌سنجد؛ قیمت فهرست فروش کالای بی‌WAC ارزش انبار را عوض نمی‌کند
 * و چنین کالایی جدا شمرده می‌شود. پیش‌تر نخستین قیمت فهرست فروش جای WAC صفر می‌نشست.
 */
export async function checkHealthValuationAtWacOnly(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 5, 0, wh, '2026-06-15');
  const metricsOf = async () => {
    const report = await FinancialHealthService.runHealthCheck();
    const test = report.tests.find(t => t.id === 'inventory_reconciliation');
    return test?.metrics ?? {};
  };
  const before = await metricsOf();
  await orm.insert(itemPrices).values({ itemId: item.id, title: 'قیمت فروش آزمون TD-401', price: money(1000000), currency: 'IRR', isDeleted: 0 });
  const after = await metricsOf();
  if (String(after.warehouseValuation) !== String(before.warehouseValuation)) {
    problems.push(`قیمت فهرست فروش ارزش انبار را از ${String(before.warehouseValuation)} به ${String(after.warehouseValuation)} برد`);
  }
  if (!(Number(after.unvaluedStockCount) >= 1)) problems.push(`کالای دارای موجودی بی‌WAC شمرده نشد: ${String(after.unvaluedStockCount)}`);
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
    if (byCode.get(code) !== value) problems.push(`ردیف ${code} سند فیش ${byCode.get(code) ?? '0'}، انتظار ${value}`);
  }
  return problems;
}

/** جدول آزمون‌های گروه حسابداری و بهای تمام‌شده در سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const ACCOUNTING_COST_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_413_waste_account_from_mapping', 'v8.0.114: ۶۰۰۱ «بهای تمام‌شده کالای فروش‌رفته» نام دارد و سند ضایعات حساب «ضایعات و افت کیفی» (۶۰۰۴) یا حساب نگاشت‌شده را بدهکار می‌کند، نه سربار ۶۰۰۳ (TD-413، گزینه الف)',
    checkWasteAccountFromMapping, 'نام‌ها درست؛ ضایعات ۱۰۰۰ به ۶۰۰۴ و با نگاشت سفارشی ۲۰۰۰ به همان حساب'],
  ['inv_td_400_outflow_voucher_at_kardex_cost', 'v8.0.115: سند حسابداری حواله و ضایعات به بهای کاردکس همان سند است و رسید تازه و همگام‌سازی دوباره عددش را عوض نمی‌کند (TD-400)',
    checkOutflowVoucherAtKardexCost, 'حواله ۷۰۰۰ (مواد ۲۰۰۰، محصول ۵۰۰۰) و ضایعات ۳۰۰۰ پس از تغییر WAC ماندند'],
  ['inv_td_401_health_valuation_at_wac_only', 'v8.0.116: ارزش انبار در بررسی سلامت مالی فقط به WAC است و قیمت فهرست فروش کالای بی‌WAC آن را عوض نمی‌کند (TD-401)',
    checkHealthValuationAtWacOnly, 'قیمت فروش ۱٬۰۰۰٬۰۰۰ ارزش انبار را عوض نکرد؛ کالای بی‌WAC شمرده شد'],
  ['inv_td_402_payroll_voucher_exact_amounts', 'v8.0.117: سند فیش حقوق مبالغ فیش را دقیق می‌گیرد، حتی مبلغ چهارده‌رقمی با چهار رقم اعشار (TD-402)',
    () => checkPayrollVoucherExactAmounts(), 'ردیف‌ها دقیقاً ۱۲۳۴۵۶۷۸۹۰۱۲۳۴٫۵۶۷۸، ۱٫۱۱۱۴، ۰٫۰۰۰۱ و ۱۲۳۴۵۶۷۸۹۰۱۲۳۵٫۶۷۹۱'],
];
