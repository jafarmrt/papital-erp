import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { AccountMappingService, type ConceptualAccountMappingConfig } from '../../services/accounting/accountMapping.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.14 — سناریوی سخت‌گیرانه نگاشت حساب‌ها در اسناد خودکار خرید، رسید تولید و برگشت از فروش (TD-259) برای سوئیت
 * business_invariants. تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

type MappedConcept = 'inventoryRawMaterialsCode' | 'inventoryFinishedGoodsCode' | 'tradePayablesAccountCode' | 'tradeReceivablesAccountCode';

let accountSeq = 0;

async function customAccount(parentCode: string, name: string, accountType: string, nature: 'debit' | 'credit'): Promise<{ id: number; code: string }> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, parentCode), eq(accounts.isDeleted, 0)));
  accountSeq += 1;
  const code = `${parentCode}${Date.now().toString().slice(-6)}${accountSeq}`;
  const [row] = await orm.insert(accounts).values({
    code, name, level: 'subsidiary', parentId: parent?.id ?? null, accountType, nature, isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  return { id: row.id, code };
}

async function netByAccountCode(documentIds: number[]): Promise<Map<string, string>> {
  const res = await pool.query<{ code: string; net: string }>(
    `SELECT a.code, SUM(i.debit - i.credit)::text AS net FROM journal_voucher_items i
       JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = ANY($1::int[]) AND v.is_deleted = 0 AND i.is_deleted = 0 GROUP BY a.code`, [documentIds]);
  return new Map(res.rows.map(r => [r.code, fin(r.net).toString()]));
}

/**
 * TD-259: با نگاشت سفارشی موجودی مواد، موجودی کالای ساخته‌شده، بستانکاران و بدهکاران تجاری، سند رسید خرید، رسید تولید و
 * برگشت از فروش همان حساب‌های نگاشت‌شده را می‌گیرند (مانند سند فروش و حواله)؛ خرید و فروش یک کالا به یک حساب موجودی
 * می‌روند، حساب‌های پیش‌فرض ۱۴۰۱، ۱۴۰۳، ۳۰۰۱ و ۱۲۰۱ سطری نمی‌گیرند و ارزش انبار با دفتر کل یکی می‌ماند.
 */
export async function checkVouchersFollowAccountMapping(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const previous = await AccountMappingService.getMappings();
  const raw = await customAccount('14', 'موجودی مواد (نگاشت آزمون TD-259)', 'asset', 'debit');
  const finished = await customAccount('14', 'موجودی کالای ساخته‌شده (نگاشت آزمون TD-259)', 'asset', 'debit');
  const payables = await customAccount('30', 'بستانکاران تجاری (نگاشت آزمون TD-259)', 'liability', 'credit');
  const receivables = await customAccount('12', 'بدهکاران تجاری (نگاشت آزمون TD-259)', 'asset', 'debit');
  const mapped: Pick<ConceptualAccountMappingConfig, MappedConcept> = {
    inventoryRawMaterialsCode: raw.code,
    inventoryFinishedGoodsCode: finished.code,
    tradePayablesAccountCode: payables.code,
    tradeReceivablesAccountCode: receivables.code,
  };
  try {
    await AccountMappingService.saveMappings(mapped);
    const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
    const scope: InvariantScope = { ...mark, itemIds: [material.id, product.id] };
    const doc = (fields: Record<string, unknown>, itemId: number, quantity: number, unitPrice: number, date: string) =>
      DocumentService.createDocument({ status: 'final', date, user: 'inv', ...fields, items: [{ itemId, quantity, unitPrice, location: wh }] });

    const receipt = await doc({ docType: 'receipt', inOut: 'in', buyerName: 'تامین‌کننده آزمون نگاشت' }, material.id, 10, 100000, '2026-05-01');
    const production = await doc({ docType: 'production_receipt', inOut: 'in' }, product.id, 5, 200000, '2026-05-01');
    const sale = await doc({ docType: 'invoice', inOut: 'out', buyerName: 'مشتری آزمون نگاشت' }, material.id, 4, 250000, '2026-05-02');
    const salesReturn = await doc({ docType: 'return', inOut: 'in', buyerName: 'مشتری آزمون نگاشت', returnOfDocumentId: sale }, material.id, 1, 250000, '2026-05-03');
    const remittance = await doc({ docType: 'remittance', inOut: 'out' }, material.id, 1, 0, '2026-05-03');

    const net = await netByAccountCode([receipt, production, sale, salesReturn, remittance]);
    for (const code of ['1401', '1403', '3001', '1201']) {
      if (net.has(code)) problems.push(`حساب پیش‌فرض ${code} با وجود نگاشت سفارشی سطر گرفت (خالص ${net.get(code)})`);
    }
    // مواد: ۱۰ × ۱۰۰٬۰۰۰ − فروش ۴ + برگشت ۱ − حواله ۱ ← ۶ × ۱۰۰٬۰۰۰
    const expectations: Array<[string, string, string]> = [
      ['موجودی مواد نگاشت‌شده', raw.code, '600000'],
      ['موجودی کالای ساخته‌شده نگاشت‌شده', finished.code, '1000000'],
      ['بستانکاران تجاری نگاشت‌شده', payables.code, '-1000000'],
    ];
    for (const [label, code, expected] of expectations) {
      const actual = net.get(code) ?? '0';
      if (!fin(actual).equals(fin(expected))) problems.push(`${label} (${code}): خالص ${actual}، انتظار ${expected}`);
    }
    const receivable = fin(net.get(receivables.code) ?? 0);
    const saleDebit = await pool.query<{ d: string }>(
      `SELECT COALESCE(SUM(i.debit), 0)::text AS d FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
        WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2`, [sale, receivables.id]);
    if (!fin(saleDebit.rows[0]?.d ?? 0).isPositive() || !receivable.lessThan(fin(saleDebit.rows[0]?.d ?? 0))) {
      problems.push(`برگشت از فروش بدهکاران نگاشت‌شده را بستانکار نکرد: بدهکار فروش ${saleDebit.rows[0]?.d ?? 0}، خالص ${receivable.toString()}`);
    }
    problems.push(...await invariantProblems(scope, 'اسناد با نگاشت سفارشی'));
  } finally {
    const restore: Pick<ConceptualAccountMappingConfig, MappedConcept> = {
      inventoryRawMaterialsCode: previous.inventoryRawMaterialsCode,
      inventoryFinishedGoodsCode: previous.inventoryFinishedGoodsCode,
      tradePayablesAccountCode: previous.tradePayablesAccountCode,
      tradeReceivablesAccountCode: previous.tradeReceivablesAccountCode,
    };
    await AccountMappingService.saveMappings(restore);
  }
  return problems;
}
