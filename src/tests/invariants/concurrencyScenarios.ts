import { eq, sql } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { DocumentService } from '../../services/document.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v8.0.47 — سناریوهای سخت‌گیرانه همزمانی حوزه J (TD-320 به بعد) برای سوئیت business_invariants.
 * عملیات‌ها پشت قفل یک تراکنش نگه‌دارنده صف می‌کشند و با هم آزاد می‌شوند، تا هم‌زمانی واقعی و تکرارپذیر باشد.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const WAIT_DEADLINE_MS = 10000;

/** بن‌بست PostgreSQL (40P01)، در خطای خام یا در زنجیره cause خطای نگاشت‌شده */
export function isDeadlock(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === '40P01' || (typeof e.message === 'string' && e.message.includes('deadlock detected'))) return true;
    cur = e.cause;
  }
  return false;
}

/** شمار نشست‌هایی که مستقیم یا پشت سر نشست دیگری منتظر قفل‌های نشست holderPid هستند */
async function waitersBehind(holderPid: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `WITH RECURSIVE w(pid) AS (
       SELECT $1::int
       UNION
       SELECT a.pid FROM pg_stat_activity a JOIN w ON w.pid = ANY(pg_blocking_pids(a.pid))
     ) SELECT (count(*) - 1)::int AS n FROM w`, [holderPid]);
  return res.rows[0]?.n ?? 0;
}

/** تا همه عملیات‌ها پشت قفل برسند (یا پیش از آن تمام شوند) صبر می‌کند؛ پس از مهلت بی‌خطا ادامه می‌دهد */
async function untilQueued(holderPid: number, expected: number, settled: () => number): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if ((await waitersBehind(holderPid)) + settled() >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/**
 * ردیف‌های کالا را در یک تراکنش جدا FOR UPDATE نگه می‌دارد، عملیات‌ها را شروع می‌کند، تا همه پشت قفل صف بکشند
 * صبر می‌کند و سپس قفل را رها می‌کند تا همه با هم ادامه دهند.
 */
async function raceBehindItemLock<T>(itemIds: number[], ops: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  const holder = await pool.connect();
  let open = false;
  try {
    await holder.query('BEGIN');
    open = true;
    await holder.query('SELECT id FROM items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [itemIds]);
    const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let done = 0;
    const running = ops.map(op => op().finally(() => { done++; }));
    const all = Promise.allSettled(running);
    await untilQueued(pid, ops.length, () => done);
    await holder.query('COMMIT');
    open = false;
    return await all;
  } finally {
    if (open) await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
}

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

/** خلاصه نتیجه عملیات‌های هم‌زمان: بن‌بست‌ها و خطاهای دیگر با برچسب هر عملیات */
function outcomeProblems(labels: string[], outcomes: PromiseSettledResult<unknown>[], allowed: (label: string, message: string) => boolean): string[] {
  const problems: string[] = [];
  const deadlocks = outcomes.filter(o => o.status === 'rejected' && isDeadlock(o.reason)).length;
  if (deadlocks > 0) problems.push(`${deadlocks} عملیات از ${outcomes.length} با بن‌بست (40P01) شکست خورد`);
  outcomes.forEach((o, i) => {
    if (o.status !== 'rejected' || isDeadlock(o.reason)) return;
    const message = getErrorMessage(o.reason);
    if (!allowed(labels[i], message)) problems.push(`${labels[i]} رد شد: ${message.slice(0, 160)}`);
  });
  return problems;
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

  const outcomes = await raceBehindItemLock([item.id], invoices.map(id => () => DocumentService.deleteDocument(id, 'inv')));
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
  const outcomes = await raceBehindItemLock([a.id, b.id], ops.map(([, op]) => op));
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

/** آزمون‌های سخت‌گیرانه حوزه J در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const CONCURRENCY_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_320_void_shared_item_no_deadlock', 'v8.0.47: هشت ابطال هم‌زمانِ فاکتورهای یک کالا بی‌بن‌بست پشت هم اجرا می‌شوند و موجودی و میانگین موزون دقیق برمی‌گردند (TD-320)',
    checkVoidsOfSharedItemNoDeadlock, 'هر هشت ابطال انجام شد؛ موجودی ۲۰ و میانگین موزون ۱۰۰٬۰۰۰ برگشت؛ بدون نقض'],
  ['inv_td_320_stock_paths_no_deadlock', 'v8.0.47: فاکتور، رسید، ابطال، نهایی‌سازی و برگشت از فروش هم‌زمان روی دو کالا با ترتیب سطرهای مخالف به بن‌بست نمی‌رسند (TD-320)',
    checkMixedStockPathsNoDeadlock, 'نُه عملیات هم‌زمان بدون بن‌بست؛ ناوردایی‌ها برقرار'],
  ['inv_td_320_void_kardex_order', 'v8.0.47: ردیف کاردکس معکوسِ ابطالی که پشت قفل کالا منتظر مانده پس از فروش میانی شماره می‌گیرد و بازسازی کاردکس همان میانگین موزون زنده را می‌دهد (TD-320)',
    checkVoidKardexOrderMatchesLive, 'موجودی ۱۱؛ بازسازی کاردکس با میانگین موزون زنده یکی است (I13)'],
];
