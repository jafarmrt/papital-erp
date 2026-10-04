import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.18 — سناریوی سخت‌گیرانه ردیف‌های بهای ریالی در سند ارزی (TD-261) برای سوئیت business_invariants.
 * تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const USD = { currency: 'USD', exchangeRate: 600000 };

/** گردش ریالی هر حساب در سند حسابداری سند تجاری (ردیف ارزی با نرخ همان ردیف، گرد به ریال — قاعده تراز آزمایشی) */
async function irrNetByCode(documentId: number): Promise<Map<string, string>> {
  const res = await pool.query<{ code: string; net: string }>(
    `SELECT a.code, SUM(CASE WHEN UPPER(COALESCE(NULLIF(i.currency, ''), 'IRR')) = 'IRR' THEN i.debit - i.credit
                             ELSE ROUND(i.debit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0)
                                - ROUND(i.credit * COALESCE(NULLIF(i.exchange_rate, 0), 1), 0) END)::text AS net
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 GROUP BY a.code`, [documentId]);
  return new Map(res.rows.map(r => [r.code, fin(r.net).toString()]));
}

/** جمع بدهکار و بستانکار ارزی سند (باید دقیقاً برابر باشند) */
async function foreignTotals(documentId: number): Promise<{ debit: string; credit: string }> {
  const res = await pool.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(SUM(i.debit), 0)::text AS debit, COALESCE(SUM(i.credit), 0)::text AS credit
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0`, [documentId]);
  return res.rows[0] ?? { debit: '0', credit: '0' };
}

async function expectIrr(problems: string[], label: string, documentId: number, expected: Record<string, number>): Promise<void> {
  const net = await irrNetByCode(documentId);
  for (const [code, amount] of Object.entries(expected)) {
    const actual = net.get(code) ?? '0';
    if (!fin(actual).equals(amount)) problems.push(`${label}: گردش ریالی ${code} ${actual}، انتظار دقیقاً ${amount}`);
  }
  const totals = await foreignTotals(documentId);
  if (!fin(totals.debit).equals(fin(totals.credit))) problems.push(`${label}: سند ارزی تراز نیست (بدهکار ${totals.debit}، بستانکار ${totals.credit})`);
}

/**
 * TD-261 (تصمیم مالک محصول — گزینه ب): ردیف‌های بهای تمام‌شده و موجودی سند ارزی در ارز سند می‌مانند و نرخ همان ردیف
 * طوری است که معادل ریالی آن دقیقاً برابر بهای کاردکس باشد — فاکتور فروش، برگشت از فروش، کالای رایگان رسید و خرید
 * ترکیبی؛ سند ارزی تراز می‌ماند. پیش‌تر مبلغ ارزی تا ۴ رقم گرد و با نرخ سند تسعیر می‌شد (۰٫۱۶۶۷ × ۶۰۰٬۰۰۰ = ۱۰۰٬۰۲۰).
 */
export async function checkForeignCostRowsExactInIrr(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [product.id, material.id] };
  type Line = { itemId: number; quantity: number; unitPrice: number };
  const doc = (fields: Record<string, unknown>, lines: Line[], date: string) => DocumentService.createDocument({
    status: 'final', date, user: 'inv', buyerName: 'طرف‌حساب آزمون ارزی', ...fields, items: lines.map(l => ({ ...l, location: wh })),
  });

  // فروش دلاری یک عدد با WAC ۱۰۰٬۰۰۰ ← بهای تمام‌شده و موجودی دقیقاً ۱۰۰٬۰۰۰ ریال (۰٫۱۶۶۷ دلار)
  await doc({ docType: 'receipt', inOut: 'in' }, [{ itemId: product.id, quantity: 3, unitPrice: 100000 }], '2026-09-01');
  const sale = await doc({ docType: 'invoice', inOut: 'out', ...USD }, [{ itemId: product.id, quantity: 1, unitPrice: 2 }], '2026-09-02');
  await expectIrr(problems, 'فروش دلاری', sale, { '6001': 100000, '1403': -100000 });

  // برگشت دلاری همان یک عدد ← موجودی و بهای تمام‌شده دقیقاً ۱۰۰٬۰۰۰ ریال برمی‌گردد
  const salesReturn = await doc({ docType: 'return', inOut: 'in', returnOfDocumentId: sale, ...USD },
    [{ itemId: product.id, quantity: 1, unitPrice: 2 }], '2026-09-03');
  await expectIrr(problems, 'برگشت دلاری', salesReturn, { '1403': 100000, '6001': -100000 });

  // رسید دلاری کالای رایگان (WAC ۱۰۰٬۰۰۰) ← موجودی و درآمد کالای اهدایی دقیقاً ۱۰۰٬۰۰۰ ریال
  await doc({ docType: 'receipt', inOut: 'in' }, [{ itemId: material.id, quantity: 2, unitPrice: 100000 }], '2026-09-01');
  const free = await doc({ docType: 'receipt', inOut: 'in', ...USD }, [{ itemId: material.id, quantity: 1, unitPrice: 0 }], '2026-09-02');
  await expectIrr(problems, 'کالای رایگان دلاری', free, { '1401': 100000, '5204': -100000 });

  // خرید دلاری ترکیبی با نرخ ۷۰۰٬۰۰۰: ۱ × ۰٫۵ دلار (۳۵۰٬۰۰۰ ریال، WAC ← ۱۶۲٬۵۰۰) و ۱ عدد رایگان (به WAC ۱۶۲٬۵۰۰ =
  // ۰٫۲۳۲۱ دلار؛ با نرخ سند ۱۶۲٬۴۷۰ ریال می‌شد)
  const mixed = await doc({ docType: 'purchase', inOut: 'in', currency: 'USD', exchangeRate: 700000 }, [
    { itemId: material.id, quantity: 1, unitPrice: 0.5 },
    { itemId: material.id, quantity: 1, unitPrice: 0 },
  ], '2026-09-03');
  await expectIrr(problems, 'خرید دلاری ترکیبی', mixed, { '1401': 512500, '3001': -350000, '5204': -162500 });

  problems.push(...await invariantProblems(scope, 'پس از اسناد ارزی'));
  return problems;
}
