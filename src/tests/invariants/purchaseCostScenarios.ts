import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { KardexWacRecalculatorService } from '../../services/inventory/kardexWacRecalculator.service.js';
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

/**
 * TD-254: ابطال خروج (فروش با سند حسابداری پیش‌نویس یا تأییدشده، و حواله) پس از تغییر WAC، کالا را با بهای همان خروج
 * برمی‌گرداند و WAC را بازمحاسبه می‌کند؛ ارزش انبار با دفتر کل یکی می‌ماند و بازسازی کاردکس همان WAC را می‌دهد.
 */
export async function checkVoidOutflowRestoresCost(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const sold = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const approved = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const issued = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [sold.id, approved.id, issued.id] };
  const receipt = (itemId: number, quantity: number, unitPrice: number, date: string) => DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date, user: 'inv', buyerName: 'تامین‌کننده آزمون ابطال خروج',
    items: [{ itemId, quantity, unitPrice, location: wh }],
  });
  const outflow = (docType: 'invoice' | 'remittance', itemId: number, quantity: number, date: string) => DocumentService.createDocument({
    docType, inOut: 'out', status: 'final', date, user: 'inv', buyerName: 'مشتری آزمون ابطال خروج',
    items: [{ itemId, quantity, unitPrice: 250000, location: wh }],
  });

  // ۱۰ × ۱۰۰٬۰۰۰، خروج ۵ (بها ۱۰۰٬۰۰۰)، ۵ × ۳۰۰٬۰۰۰ (WAC ۲۰۰٬۰۰۰)، ابطال خروج ← ۱۵ عدد با WAC ۱۶۶٬۶۶۶٫۶۶۶۷
  const cases: Array<[string, { id: number }, 'invoice' | 'remittance', boolean]> = [
    ['فروش با سند پیش‌نویس', sold, 'invoice', false],
    ['فروش با سند تأییدشده', approved, 'invoice', true],
    ['حواله خروج', issued, 'remittance', false],
  ];
  for (const [label, item, docType, approve] of cases) {
    await receipt(item.id, 10, 100000, '2026-03-01');
    const out = await outflow(docType, item.id, 5, '2026-03-02');
    await receipt(item.id, 5, 300000, '2026-03-03');
    if (approve) {
      const vouchers = await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [out]);
      await VoucherService.approveJournalVouchers(vouchers.rows.map(v => v.id), undefined, 'inv');
    }
    await DocumentService.deleteDocument(out, 'inv');
    const state = await itemState(item.id);
    if (state.stock !== 15 || fin(state.wac).subtract(fin('166666.6667')).abs().greaterThan(fin(0.01))) {
      problems.push(`${label}: پس از ابطال خروج موجودی ${state.stock} و WAC ${state.wac}، انتظار ۱۵ و ۱۶۶٬۶۶۶٫۶۶۶۷`);
    }
    await KardexWacRecalculatorService.rebuildItemFromLedger(item.id, { user: 'inv' });
    const rebuilt = await itemState(item.id);
    if (fin(rebuilt.wac).subtract(fin(state.wac)).abs().greaterThan(fin(0.01))) problems.push(`${label}: بازسازی کاردکس WAC را ${state.wac} ← ${rebuilt.wac} کرد`);
  }
  problems.push(...await invariantProblems(scope, 'پس از ابطال خروج‌ها'));
  return problems;
}

