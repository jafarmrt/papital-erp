import { pool } from '../../db/drizzle.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.8 — سناریوی سخت‌گیرانه سقف برگشت از فروش (TD-253) برای سوئیت business_invariants.
 * تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function sell(itemId: number, quantity: number, wh: string, date: string): Promise<number> {
  return DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status: 'final', date, user: 'inv', buyerName: 'مشتری آزمون برگشت',
    items: [{ itemId, quantity, unitPrice: 250000, location: wh }],
  });
}

async function giveBack(itemId: number, quantity: number, wh: string, date: string, invoiceId: number, status: 'final' | 'draft' = 'final'): Promise<number> {
  return DocumentService.createDocument({
    docType: 'return', inOut: 'in', status, date, user: 'inv', buyerName: 'مشتری آزمون برگشت', returnOfDocumentId: invoiceId,
    items: [{ itemId, quantity, unitPrice: 250000, location: wh }],
  });
}

async function rejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
}

/**
 * TD-253: برگشت با فاکتور مرجع تا «فروخته‌شده منهای برگشت‌های نهایی قبلی» پذیرفته می‌شود؛ بیش از آن (یک‌جا، چندباره یا
 * با نهایی‌سازی پیش‌نویس) رد می‌شود و اثری نمی‌گذارد؛ ابطال یک برگشت مقدار آن را دوباره قابل برگشت می‌کند.
 */
export async function checkReturnWithinSold(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  await receive(item.id, 20, 100000, wh, '2025-12-10');
  const invoice = await sell(item.id, 5, wh, '2025-12-11');

  const tooMuch = await rejection(() => giveBack(item.id, 6, wh, '2025-12-12', invoice));
  if (!tooMuch?.includes('قابل برگشت')) problems.push(`برگشت ۶ از فاکتور ۵ عددی رد نشد (${tooMuch ?? 'پذیرفته شد'})`);
  const partial = await rejection(() => giveBack(item.id, 2, wh, '2025-12-12', invoice));
  if (partial) problems.push(`برگشت ۲ از ۵ رد شد: ${partial}`);
  const rest = await rejection(() => giveBack(item.id, 3, wh, '2025-12-13', invoice));
  if (rest) problems.push(`برگشت ۳ باقی‌مانده رد شد: ${rest}`);
  const again = await rejection(() => giveBack(item.id, 1, wh, '2025-12-13', invoice));
  if (!again?.includes('قابل برگشت')) problems.push(`برگشت دوباره پس از برگشت کامل فاکتور رد نشد (${again ?? 'پذیرفته شد'})`);
  const afterRefusals = await itemState(item.id);
  if (afterRefusals.stock !== 20) problems.push(`موجودی پس از برگشت‌های مجاز و ردشده ${afterRefusals.stock} است، نه ۲۰`);

  // پیش‌نویس بیش از سقف ثبت می‌شود (موجودی تغییر نمی‌کند) ولی نهایی‌سازی آن رد می‌شود
  const draft = await giveBack(item.id, 1, wh, '2025-12-14', invoice, 'draft');
  const finalizeOver = await rejection(() => DocumentService.finalizeDocument(draft, 'inv'));
  if (!finalizeOver?.includes('قابل برگشت')) problems.push(`نهایی‌سازی برگشت بیش از سقف رد نشد (${finalizeOver ?? 'پذیرفته شد'})`);

  // ابطال برگشت ۲ عددی، همان مقدار را دوباره قابل برگشت می‌کند
  const [partialReturn] = (await pool.query<{ id: number }>(
    `SELECT id FROM documents WHERE return_of_document_id = $1 AND is_deleted = 0 AND status = 'final' ORDER BY id LIMIT 1`, [invoice])).rows;
  if (partialReturn) await DocumentService.deleteDocument(partialReturn.id, 'inv');
  const finalizeAfterVoid = await rejection(() => DocumentService.finalizeDocument(draft, 'inv'));
  if (finalizeAfterVoid) problems.push(`پس از ابطال یک برگشت، نهایی‌سازی برگشت در سقف رد شد: ${finalizeAfterVoid}`);
  const { stock } = await itemState(item.id);
  if (stock !== 19) problems.push(`موجودی پایانی ${stock} است، نه ۱۹`);

  problems.push(...await invariantProblems(scope, 'پایان سناریوی برگشت از فروش'));
  return problems;
}
