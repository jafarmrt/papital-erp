import { pool } from '../../db/drizzle.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.81 — سناریوهای سخت‌گیرانه حوزه L (تطابق فرانت‌اند و سرور) برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

type Line = { itemId: number; quantity: number; unitPrice: number; discount?: number; location: string };

function salesInvoice(lines: Line[], status: 'final' | 'proforma', extra: Record<string, unknown> = {}): Promise<number> {
  return DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status, date: '2026-03-02', user: 'inv', buyerName: 'مشتری آزمون حوزه L',
    items: lines, ...extra,
  });
}

async function refusedWith(run: () => Promise<unknown>, needle: string): Promise<string | null> {
  try {
    await run();
    return 'پذیرفته شد';
  } catch (err) {
    const message = getErrorMessage(err);
    return message.includes(needle) ? null : `با پیام دیگری رد شد: ${message}`;
  }
}

/**
 * TD-380: تخفیف ردیف بیشتر از مبلغ همان ردیف رد می‌شود. پیش‌تر فاکتور نهایی [۱۰۰۰ با تخفیف ۳۰۰۰، ۵۰۰۰] پذیرفته می‌شد و
 * ۲۰۰۰ از تخفیف ردیف اول از درآمد ردیف دوم کم می‌شد؛ پیش‌فاکتوری که تخفیفش از کل مبلغ بیشتر بود با مبلغ قابل پرداخت منفی
 * ثبت و نهایی‌سازی‌اش با خطای نامفهوم سند حسابداری رد می‌شد.
 */
export async function checkLineDiscountWithinAmount(wh: string): Promise<string[]> {
  const mark = await watermarks();
  const a = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const b = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [a.id, b.id] };
  await receive(a.id, 10, 1000, wh, '2026-03-01');
  await receive(b.id, 10, 1000, wh, '2026-03-01');
  const problems: string[] = [];
  const over = 'از مبلغ همان ردیف';

  const finalMixed = await refusedWith(() => salesInvoice([
    { itemId: a.id, quantity: 1, unitPrice: 1000, discount: 3000, location: wh },
    { itemId: b.id, quantity: 1, unitPrice: 5000, discount: 0, location: wh },
  ], 'final'), over);
  if (finalMixed) problems.push(`فاکتور نهایی با تخفیف ردیف ۳۰۰۰ روی مبلغ ۱۰۰۰: ${finalMixed}`);

  const proforma = await refusedWith(() => salesInvoice([
    { itemId: a.id, quantity: 1, unitPrice: 1000, discount: 3000, location: wh },
  ], 'proforma'), over);
  if (proforma) problems.push(`پیش‌فاکتور با تخفیف بیشتر از کل مبلغ: ${proforma}`);

  const editable = await salesInvoice([{ itemId: a.id, quantity: 2, unitPrice: 1000, discount: 2000, location: wh }], 'proforma');
  const edited = await refusedWith(() => DocumentService.updateDocument(editable, {
    items: [{ itemId: a.id, quantity: 1, unitPrice: 1000, discount: 1500, location: wh }],
  }), over);
  if (edited) problems.push(`ویرایش پیش‌فاکتور به تخفیف ۱۵۰۰ روی مبلغ ۱۰۰۰: ${edited}`);

  // تخفیف برابر مبلغ ردیف (کالای رایگان) پذیرفته می‌شود
  try {
    await salesInvoice([
      { itemId: a.id, quantity: 1, unitPrice: 1000, discount: 1000, location: wh },
      { itemId: b.id, quantity: 1, unitPrice: 5000, discount: 0, location: wh },
    ], 'final');
  } catch (err) {
    problems.push(`فاکتور با تخفیف برابر مبلغ ردیف رد شد: ${getErrorMessage(err)}`);
  }
  const negative = await pool.query<{ id: number }>(
    `SELECT d.id FROM documents d JOIN document_items i ON i.document_id = d.id AND i.is_deleted = 0
      WHERE d.id > $1 AND d.is_deleted = 0 AND i.discount > i.quantity * i.unit_price`,
    [mark.documentIdAfter]
  );
  if (negative.rows.length > 0) problems.push(`سندهای ${negative.rows.map(r => r.id).join('، ')} ردیف با تخفیف بیشتر از مبلغ دارند`);
  problems.push(...await invariantProblems(scope, 'پس از فاکتورهای تخفیف‌دار'));
  return problems;
}
