import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.9 — سناریوی سخت‌گیرانه بهای ورود خرید با تخفیف (TD-250) برای سوئیت business_invariants.
 * تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function kardexInPrice(documentId: number): Promise<string> {
  const res = await pool.query<{ p: string }>(
    `SELECT unit_price::text AS p FROM transactions WHERE document_id = $1 AND type = 'in' AND is_deleted = 0 AND reversal_of_id IS NULL LIMIT 1`,
    [documentId]);
  return fin(res.rows[0]?.p ?? 0).toString();
}

/**
 * TD-250: کالای خرید با تخفیف ردیف با قیمت خالص پس از تخفیف وارد انبار می‌شود — ریالی، ارزی (تسعیر روی قیمت خالص) و
 * با نهایی‌سازی پیش‌نویس؛ WAC، کاردکس و دفتر کل یکی می‌مانند و ابطال آن را دقیق برمی‌گرداند.
 */
export async function checkPurchaseDiscountInCost(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const irr = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const usd = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const usdRounding = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const drafted = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [irr.id, usd.id, usdRounding.id, drafted.id] };
  const receipt = (itemId: number, quantity: number, unitPrice: number, discount: number, date: string, extra: Record<string, unknown> = {}) =>
    DocumentService.createDocument({
      docType: 'receipt', inOut: 'in', status: 'final', date, user: 'inv', buyerName: 'تامین‌کننده آزمون تخفیف',
      items: [{ itemId, quantity, unitPrice, discount, location: wh }], ...extra,
    });

  // ریالی: ۱۰ × ۱۰۰٬۰۰۰ با تخفیف ردیف ۱۰۰٬۰۰۰ ← خالص ۹۰۰٬۰۰۰، بهای واحد ۹۰٬۰۰۰
  const irrReceipt = await receipt(irr.id, 10, 100000, 100000, '2026-01-10');
  const irrPrice = await kardexInPrice(irrReceipt);
  const irrState = await itemState(irr.id);
  if (!fin(irrPrice).equals(90000) || !fin(irrState.wac).equals(90000)) problems.push(`رسید ریالی با تخفیف: بهای کاردکس ${irrPrice} و WAC ${irrState.wac}، انتظار ۹۰٬۰۰۰`);

  // ارزی: ۱۰ × ۲ دلار با تخفیف ۲ دلار و نرخ ۶۰۰٬۰۰۰ ← خالص ۱٫۸ دلار = ۱٬۰۸۰٬۰۰۰ ریال
  await receipt(usd.id, 10, 2, 2, '2026-01-10', { currency: 'USD', exchangeRate: 600000 });
  const usdState = await itemState(usd.id);
  if (!fin(usdState.wac).equals(1080000)) problems.push(`رسید ارزی با تخفیف: WAC ${usdState.wac}، انتظار ۱٬۰۸۰٬۰۰۰`);
  // ارزی با قیمت خالص غیرگرد: ۸ × ۰٫۴۷ − ۰٫۱۹ = ۳٫۵۷ دلار ← ۰٫۴۴۶۲۵ دلار = ۲۶۷٬۷۵۰ ریال (نه ۰٫۴۴۶۳ × ۶۰۰٬۰۰۰ = ۲۶۷٬۷۸۰)
  await receipt(usdRounding.id, 8, 0.47, 0.19, '2026-01-10', { currency: 'USD', exchangeRate: 600000 });
  const usdRoundingState = await itemState(usdRounding.id);
  if (!fin(usdRoundingState.wac).equals(267750)) problems.push(`رسید ارزی با قیمت خالص غیرگرد: WAC ${usdRoundingState.wac}، انتظار ۲۶۷٬۷۵۰`);

  // پیش‌نویس و نهایی‌سازی: ۴ × ۵۰٬۰۰۰ با تخفیف ۴۰٬۰۰۰ ← بهای واحد ۴۰٬۰۰۰
  const draft = await receipt(drafted.id, 4, 50000, 40000, '2026-01-11', { status: 'draft' });
  await DocumentService.finalizeDocument(draft, 'inv');
  const draftPrice = await kardexInPrice(draft);
  if (!fin(draftPrice).equals(40000)) problems.push(`نهایی‌سازی رسید پیش‌نویس با تخفیف: بهای کاردکس ${draftPrice}، انتظار ۴۰٬۰۰۰`);

  problems.push(...await invariantProblems(scope, 'پس از رسیدهای با تخفیف'));

  await DocumentService.deleteDocument(irrReceipt, 'inv');
  const afterVoid = await itemState(irr.id);
  if (afterVoid.stock !== 0) problems.push(`ابطال رسید با تخفیف موجودی را صفر نکرد: ${afterVoid.stock}`);
  problems.push(...await invariantProblems(scope, 'پس از ابطال رسید با تخفیف'));
  return problems;
}
