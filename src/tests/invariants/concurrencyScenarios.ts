import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';
import { outcomeProblems, raceBehindRowLock, untilQueued } from './concurrencyHarness.js';

/**
 * v8.0.47 — سناریوهای سخت‌گیرانه همزمانی گردش انبار (TD-320) برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

function invoice(lines: Array<[number, number]>, wh: string, date: string, status: 'final' | 'draft' = 'final'): Promise<number> {
  return DocumentService.createDocument({
    docType: 'invoice', inOut: 'out', status, date, user: 'inv', buyerName: 'مشتری آزمون همزمانی',
    items: lines.map(([itemId, quantity]) => ({ itemId, quantity, unitPrice: 250000, location: wh })),
  });
}

function receipt(lines: Array<[number, number]>, wh: string, date: string): Promise<number> {
  return DocumentService.createDocument({
    docType: 'receipt', inOut: 'in', status: 'final', date, user: 'inv', buyerName: 'تامین‌کننده آزمون همزمانی',
    items: lines.map(([itemId, quantity]) => ({ itemId, quantity, unitPrice: 100000, location: wh })),
  });
}

/**
 * TD-320: ابطال هم‌زمان چند فاکتورِ یک کالا. پیش‌تر هر ابطال ردیف کاردکس معکوس را پیش از قفل کالا درج می‌کرد (قفل
 * FOR KEY SHARE کلید خارجی) و سپس برای قفل FOR UPDATE همان کالا منتظر قفل اشتراکی ابطال‌های دیگر می‌ماند: همه جز یکی
 * با بن‌بست شکست می‌خوردند.
 */
export async function checkVoidsOfSharedItemNoDeadlock(wh: string): Promise<string[]> {
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  await receive(item.id, 20, 100000, wh, '2026-02-01');
  const invoices: number[] = [];
  for (let i = 0; i < 8; i++) invoices.push(await invoice([[item.id, 1]], wh, '2026-02-02'));

  const outcomes = await raceBehindRowLock('items', [item.id], invoices.map(id => () => DocumentService.deleteDocument(id, 'inv')));
  const problems = outcomeProblems(invoices.map(id => `ابطال فاکتور ${id}`), outcomes, () => false);
  const { stock, wac } = await itemState(item.id);
  if (stock !== 20) problems.push(`موجودی پس از ابطال هشت فاکتور ${stock} است، نه ۲۰`);
  if (wac !== '100000') problems.push(`میانگین موزون پس از ابطال ${wac} است، نه ۱۰۰٬۰۰۰`);
  problems.push(...await invariantProblems(scope, 'پس از ابطال هم‌زمان'));
  return problems;
}

/**
 * TD-320: گردش‌های هم‌زمان دو کالا به ترتیب‌های مخالف — فاکتور [A,B]، رسید و ابطال و نهایی‌سازی [B,A]، و برگشت از
 * فروش هم‌زمان با ابطال همان فاکتور. همه کالاها را یک‌جا و به ترتیب صعودی شناسه قفل می‌کنند؛ هیچ بن‌بستی نباید رخ دهد.
 */
export async function checkMixedStockPathsNoDeadlock(wh: string): Promise<string[]> {
  const mark = await watermarks();
  const a = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const b = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [a.id, b.id] };
  await receipt([[a.id, 50], [b.id, 50]], wh, '2026-02-03');
  const reversed = await invoice([[b.id, 1], [a.id, 1]], wh, '2026-02-04');
  const voided1 = await invoice([[b.id, 1], [a.id, 1]], wh, '2026-02-04');
  const voided2 = await invoice([[b.id, 1], [a.id, 1]], wh, '2026-02-04');
  const draft = await invoice([[b.id, 1], [a.id, 1]], wh, '2026-02-05', 'draft');

  const ops: Array<[string, () => Promise<unknown>]> = [
    ['فاکتور [A,B] اول', () => invoice([[a.id, 1], [b.id, 1]], wh, '2026-02-05')],
    ['فاکتور [A,B] دوم', () => invoice([[a.id, 1], [b.id, 1]], wh, '2026-02-05')],
    ['رسید [B,A] اول', () => receipt([[b.id, 1], [a.id, 1]], wh, '2026-02-05')],
    ['رسید [B,A] دوم', () => receipt([[b.id, 1], [a.id, 1]], wh, '2026-02-05')],
    ['ابطال فاکتور [B,A] اول', () => DocumentService.deleteDocument(voided1, 'inv')],
    ['ابطال فاکتور [B,A] دوم', () => DocumentService.deleteDocument(voided2, 'inv')],
    ['نهایی‌سازی پیش‌نویس [B,A]', () => DocumentService.finalizeDocument(draft, 'inv')],
    ['برگشت از فروش [B,A]', () => DocumentService.createDocument({
      docType: 'return', inOut: 'in', status: 'final', date: '2026-02-05', user: 'inv', buyerName: 'مشتری آزمون همزمانی',
      returnOfDocumentId: reversed, items: [{ itemId: b.id, quantity: 1, unitPrice: 250000, location: wh }, { itemId: a.id, quantity: 1, unitPrice: 250000, location: wh }],
    })],
    ['ابطال فاکتورِ مرجع برگشت', () => DocumentService.deleteDocument(reversed, 'inv')],
  ];
  const outcomes = await raceBehindRowLock('items', [a.id, b.id], ops.map(([, op]) => op));
  // اگر ابطال فاکتور پیش از برگشت برسد، برگشت درست رد می‌شود (فاکتور مرجع ابطال شده است)
  const problems = outcomeProblems(ops.map(([label]) => label), outcomes,
    (label, message) => label.startsWith('برگشت از فروش') && (message.includes('ابطال') || message.includes('قابل برگشت')));
  problems.push(...await invariantProblems(scope, 'پس از گردش‌های هم‌زمان'));
  return problems;
}

/**
 * TD-320: ردیف کاردکس معکوس ابطال پس از قفل کالا شماره می‌گیرد. پیش‌تر ابطالی که پشت قفل کالا منتظر می‌ماند ردیف
 * معکوسش را پیش‌تر درج کرده بود و فروشِ میان آن، شناسه بزرگ‌تری می‌گرفت؛ بازسازی کاردکس (به ترتیب ثبت) میانگین موزون
 * دیگری می‌ساخت (۱٬۶۶۶٫۶۷ به جای ۱٬۵۴۵٫۴۵).
 */
export async function checkVoidKardexOrderMatchesLive(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [item.id] };
  await receive(item.id, 10, 1000, wh, '2026-02-06');
  const sold = await invoice([[item.id, 5]], wh, '2026-02-07');
  await receive(item.id, 5, 3000, wh, '2026-02-08');

  let voidOutcome: Promise<unknown> | null = null;
  await orm.transaction(async (tx) => {
    await tx.select({ id: items.id }).from(items).where(eq(items.id, item.id)).for('update');
    const pidRes = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number((pidRes.rows[0] as { pid: number }).pid);
    let done = 0;
    voidOutcome = DocumentService.deleteDocument(sold, 'inv').finally(() => { done++; });
    voidOutcome.catch(() => undefined);
    await untilQueued(pid, 1, () => done);
    // فروش ۴ عدد در همان تراکنش نگه‌دارنده، در حالی که ابطال پشت قفل کالا منتظر است
    await DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'final', date: '2026-02-09', user: 'inv', buyerName: 'مشتری آزمون همزمانی',
      items: [{ itemId: item.id, quantity: 4, unitPrice: 250000, location: wh }], externalTx: tx,
    });
  });
  try {
    await voidOutcome;
  } catch (err) {
    problems.push(`ابطال فاکتور رد شد: ${getErrorMessage(err)}`);
  }
  const { stock } = await itemState(item.id);
  if (stock !== 11) problems.push(`موجودی پایانی ${stock} است، نه ۱۱`);
  problems.push(...await invariantProblems(scope, 'پس از ابطال پشت قفل'));
  return problems;
}

