import { pool } from '../../db/drizzle.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.103 — سناریوهای سخت‌گیرانه حوزه L (تطابق فرانت‌اند و سرور) برای سوئیت business_invariants.
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

async function vatOf(docId: number): Promise<{ percent: string; amount: string }> {
  const r = await pool.query<{ percent: string; amount: string }>(`SELECT vat_percent::text AS percent, vat_amount::text AS amount FROM documents WHERE id = $1`, [docId]);
  return r.rows[0];
}

/**
 * TD-381: مبلغ مالیات ارسالی همراه درصد مثبت باید همان مبلغ درصدی سرور باشد. پیش‌تر پیش‌فاکتور ۱۰۰۰ ریالی با درصد ۱۰ و
 * مبلغ ۱ ریال ذخیره می‌شد و سند حسابداری همان ۱ ریال را مالیات می‌برد. مبلغ صریح بی درصد (ووکامرس) پذیرفته می‌ماند.
 */
export async function checkVatAmountMatchesPercent(wh: string): Promise<string[]> {
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 10, 1000, wh, '2026-03-01');
  const line = (quantity: number, unitPrice: number): Line => ({ itemId: item.id, quantity, unitPrice, location: wh });
  const problems: string[] = [];
  const mismatch = 'یکی نیست';

  const created = await refusedWith(() => salesInvoice([line(1, 1000)], 'proforma', { vatPercent: 10, vatAmount: 1 }), mismatch);
  if (created) problems.push(`پیش‌فاکتور با درصد ۱۰ و مالیات ۱ ریال: ${created}`);

  const ok = await salesInvoice([line(1, 1000)], 'proforma', { vatPercent: 10, vatAmount: 100 });
  const okVat = await vatOf(ok);
  if (Number(okVat.amount) !== 100) problems.push(`مالیات درست ۱۰۰ ذخیره نشد (${okVat.amount})`);

  const edited = await refusedWith(() => DocumentService.updateDocument(ok, { vatPercent: 10, vatAmount: 5 }), mismatch);
  if (edited) problems.push(`ویرایش پیش‌فاکتور به مالیات ۵ با درصد ۱۰: ${edited}`);
  await DocumentService.updateDocument(ok, { vatPercent: 9 });
  if (Number((await vatOf(ok)).amount) !== 90) problems.push(`ویرایش فقط درصد به ۹، مالیات را ${(await vatOf(ok)).amount} کرد، نه ۹۰`);

  const finalized = await refusedWith(() => DocumentService.finalizeDocument(ok, 'inv', undefined, { vatPercent: 9, vatAmount: 0 }), mismatch);
  if (finalized) problems.push(`نهایی‌سازی با درصد ۹ و مالیات صفر: ${finalized}`);

  const amountOnly = await salesInvoice([line(1, 1000)], 'proforma', { vatAmount: 37 });
  const amountOnlyVat = await vatOf(amountOnly);
  if (Number(amountOnlyVat.amount) !== 37 || Number(amountOnlyVat.percent) !== 0) problems.push(`مالیات صریح بی درصد ۳۷ ذخیره نشد (${amountOnlyVat.amount}، ${amountOnlyVat.percent}٪)`);
  return problems;
}

/**
 * TD-382: مالیات درصدی فاکتور ارزی به سِنت گرد می‌شود. پیش‌تر ۹٪ از ۱۵٫۵۵ دلار «۱ دلار» ذخیره می‌شد (گرد به واحد کامل،
 * قاعده ریال)؛ درست ۱٫۴۰ است. فاکتور ریالی بی‌اعشار می‌ماند.
 */
export async function checkForeignVatRoundedToCents(wh: string): Promise<string[]> {
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 10, 1000, wh, '2026-03-01');
  const problems: string[] = [];
  const usd = await salesInvoice([{ itemId: item.id, quantity: 1, unitPrice: 15.55, location: wh }], 'proforma', { currency: 'USD', exchangeRate: 600000, vatPercent: 9 });
  if (Number((await vatOf(usd)).amount) !== 1.4) problems.push(`مالیات ۹٪ فاکتور ۱۵٫۵۵ دلاری ${(await vatOf(usd)).amount} ذخیره شد، نه ۱٫۴۰`);
  await DocumentService.updateDocument(usd, { items: [{ itemId: item.id, quantity: 2, unitPrice: 15.55, location: wh }] });
  if (Number((await vatOf(usd)).amount) !== 2.8) problems.push(`پس از ویرایش به ۲ عدد مالیات ${(await vatOf(usd)).amount} شد، نه ۲٫۸۰`);
  const irr = await salesInvoice([{ itemId: item.id, quantity: 1, unitPrice: 15, location: wh }], 'proforma', { vatPercent: 10 });
  if (Number((await vatOf(irr)).amount) !== 2) problems.push(`مالیات ۱۰٪ فاکتور ۱۵ ریالی ${(await vatOf(irr)).amount} شد، نه ۲`);
  return problems;
}
