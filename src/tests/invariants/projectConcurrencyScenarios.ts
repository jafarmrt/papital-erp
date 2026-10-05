import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ProjectService } from '../../services/projects.service.js';
import { getErrorMessage } from '../../utils/formatters.js';
import { createTestItem } from '../fixtures/factories.js';
import { outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import { itemState } from './scenarioHelpers.js';

/**
 * v8.0.72 — سناریوهای سخت‌گیرانه «ورود به انبار» پروژه حوزه J برای سوئیت business_invariants.
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

async function projectWith(title: string, itemId: number, quantity: number): Promise<number> {
  const { project } = await ProjectService.createProject({
    title, startDate: await businessTodayIsoDate(), quantity: 1,
    products: [{ id: 'prod-1', item_id: itemId, item_code: '', item_name: 'محصول آزمون تحویل', customer_code: '', quantity, unit: 'عدد', needs_assembly: false }],
  } as Parameters<typeof ProjectService.createProject>[0]);
  return project.id;
}

function deliver(projectId: number, itemId: number, quantity: number, wh: string, overDeliveryReason?: string) {
  return ProjectService.addProjectToInventory({
    projectId, itemsToAdd: [{ itemId, quantity, unitPrice: 100000, location: wh }], currentUser: 'inv', overDeliveryReason,
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
 * TD-327 (تصمیم مالک محصول — گزینه ب «با دلیل»): جمع تحویل‌های «ورود به انبار» یک پروژه بی‌دلیل از مقدار برنامه‌ریزی‌شده
 * بیشتر نمی‌شود، و پروژه لغوشده یا کالای بیرون از پروژه تحویل نمی‌شود. پیش‌تر دو تحویل ۵ عددی (هم‌زمان یا پشت هم) پروژه
 * ۵ عددی ۱۰ عدد وارد انبار می‌کرد و تحویل پروژه لغوشده و کالای بیرون از پروژه هم پذیرفته می‌شد.
 */
export async function checkProjectDeliveryCapped(wh: string): Promise<string[]> {
  const problems: string[] = [];

  // ۱) دو تحویل هم‌زمان کل مقدار پروژه: فقط یکی بی‌دلیل پذیرفته می‌شود
  const racedItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const raced = await projectWith('پروژه آزمون تحویل هم‌زمان', racedItem.id, 5);
  const outcomes = await raceBehindRowLock<unknown>('production_projects', [raced], [
    () => deliver(raced, racedItem.id, 5, wh), () => deliver(raced, racedItem.id, 5, wh),
  ]);
  problems.push(...outcomeProblems(['تحویل اول', 'تحویل دوم'], outcomes, (_label, message) => message.includes('بیش از مقدار برنامه‌ریزی‌شده')));
  const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`از دو تحویل هم‌زمان کل پروژه ${accepted} پذیرفته شد، نه یکی`);
  const raceStock = (await itemState(racedItem.id)).stock;
  if (raceStock !== 5) problems.push(`موجودی پس از دو تحویل هم‌زمان پروژه ۵ عددی ${raceStock} است، نه ۵`);

  // ۲) پشت هم: ۳ و ۳ بی‌دلیل رد، با دلیل پذیرفته و دلیل در سند رسید تولید
  const seqItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const seq = await projectWith('پروژه آزمون تحویل پشت هم', seqItem.id, 5);
  await deliver(seq, seqItem.id, 3, wh);
  const second = await rejection(() => deliver(seq, seqItem.id, 3, wh));
  if (!second?.includes('دلیل')) problems.push(`تحویل دوم بیش از برنامه بی‌دلیل رد نشد (${second ?? 'پذیرفته شد'})`);
  const withReason = await deliver(seq, seqItem.id, 3, wh, 'سفارش اضافه مشتری');
  const over = withReason.overDeliveries ?? [];
  if (over.length !== 1 || over[0].excess !== 1) problems.push(`تحویل با دلیل مقدار اضافه را ۱ نشمرد (${JSON.stringify(over)})`);
  const notes = await pool.query<{ notes: string }>('SELECT notes FROM documents WHERE id = $1', [withReason.documentId ?? 0]);
  if (!notes.rows[0]?.notes?.includes('سفارش اضافه مشتری')) problems.push('دلیل تحویل بیش از برنامه در سند رسید تولید ثبت نشد');
  const seqStock = (await itemState(seqItem.id)).stock;
  if (seqStock !== 6) problems.push(`موجودی پس از تحویل ۳ و ۳ (با دلیل) ${seqStock} است، نه ۶`);

  // ۳) پروژه لغوشده و کالای بیرون از پروژه
  const cancelledItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const cancelled = await projectWith('پروژه آزمون لغوشده', cancelledItem.id, 5);
  await pool.query(`UPDATE production_projects SET status = 'cancelled' WHERE id = $1`, [cancelled]);
  const cancelledRefusal = await rejection(() => deliver(cancelled, cancelledItem.id, 1, wh));
  if (!cancelledRefusal?.includes('لغو')) problems.push(`تحویل پروژه لغوشده رد نشد (${cancelledRefusal ?? 'پذیرفته شد'})`);
  const strayItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const strayRefusal = await rejection(() => deliver(seq, strayItem.id, 1, wh));
  if (!strayRefusal?.includes('از محصولات پروژه')) problems.push(`تحویل کالای بیرون از پروژه رد نشد (${strayRefusal ?? 'پذیرفته شد'})`);
  for (const [item, label] of [[cancelledItem.id, 'پروژه لغوشده'], [strayItem.id, 'کالای بیرون از پروژه']] as const) {
    const { stock } = await itemState(item);
    if (stock !== 0) problems.push(`موجودی ${label} پس از تحویل ردشده ${stock} است، نه صفر`);
  }
  return problems;
}
