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
  if (!tooMuch?.includes('قابل برگشت')) problems.push(`return of 6 from an invoice of 5 was not refused (${tooMuch ?? 'accepted'})`);
  const partial = await rejection(() => giveBack(item.id, 2, wh, '2025-12-12', invoice));
  if (partial) problems.push(`return of 2 out of 5 was refused: ${partial}`);
  const rest = await rejection(() => giveBack(item.id, 3, wh, '2025-12-13', invoice));
  if (rest) problems.push(`return of the remaining 3 was refused: ${rest}`);
  const again = await rejection(() => giveBack(item.id, 1, wh, '2025-12-13', invoice));
  if (!again?.includes('قابل برگشت')) problems.push(`another return after the whole invoice was returned was not refused (${again ?? 'accepted'})`);
  const afterRefusals = await itemState(item.id);
  if (afterRefusals.stock !== 20) problems.push(`stock after the allowed and refused returns is ${afterRefusals.stock}, not 20`);

  // پیش‌نویس بیش از سقف ثبت می‌شود (موجودی تغییر نمی‌کند) ولی نهایی‌سازی آن رد می‌شود
  const draft = await giveBack(item.id, 1, wh, '2025-12-14', invoice, 'draft');
  const finalizeOver = await rejection(() => DocumentService.finalizeDocument(draft, 'inv'));
  if (!finalizeOver?.includes('قابل برگشت')) problems.push(`finalizing a return above the cap was not refused (${finalizeOver ?? 'accepted'})`);

  // ابطال برگشت ۲ عددی، همان مقدار را دوباره قابل برگشت می‌کند
  const [partialReturn] = (await pool.query<{ id: number }>(
    `SELECT id FROM documents WHERE return_of_document_id = $1 AND is_deleted = 0 AND status = 'final' ORDER BY id LIMIT 1`, [invoice])).rows;
  if (partialReturn) await DocumentService.deleteDocument(partialReturn.id, 'inv');
  const finalizeAfterVoid = await rejection(() => DocumentService.finalizeDocument(draft, 'inv'));
  if (finalizeAfterVoid) problems.push(`after voiding a return, finalizing a return within the cap was refused: ${finalizeAfterVoid}`);
  const { stock } = await itemState(item.id);
  if (stock !== 19) problems.push(`final stock is ${stock}, not 19`);

  problems.push(...await invariantProblems(scope, 'end of the sales return scenario'));
  return problems;
}
