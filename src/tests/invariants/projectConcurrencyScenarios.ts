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
  const overPlanRefusal = (_label: string, message: string) => message.includes('بیش از مقدار برنامه‌ریزی‌شده');
  problems.push(...outcomeProblems(['first delivery', 'second delivery'], outcomes, overPlanRefusal));
  const accepted = outcomes.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`${accepted} of two concurrent whole-project deliveries were accepted, not one`);
  const raceStock = (await itemState(racedItem.id)).stock;
  if (raceStock !== 5) problems.push(`Stock after two concurrent deliveries of the 5-unit project is ${raceStock}, not 5`);

  // ۲) پشت هم: ۳ و ۳ بی‌دلیل رد، با دلیل پذیرفته و دلیل در سند رسید تولید
  const seqItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const seq = await projectWith('پروژه آزمون تحویل پشت هم', seqItem.id, 5);
  await deliver(seq, seqItem.id, 3, wh);
  const second = await rejection(() => deliver(seq, seqItem.id, 3, wh));
  if (!second?.includes('دلیل')) problems.push(`a second over-plan delivery without a reason was not refused (${second ?? 'accepted'})`);
  const withReason = await deliver(seq, seqItem.id, 3, wh, 'سفارش اضافه مشتری');
  const over = withReason.overDeliveries ?? [];
  if (over.length !== 1 || over[0].excess !== 1) problems.push(`The delivery with a reason did not count the excess as 1 (${JSON.stringify(over)})`);
  const notes = await pool.query<{ notes: string }>('SELECT notes FROM documents WHERE id = $1', [withReason.documentId ?? 0]);
  if (!notes.rows[0]?.notes?.includes('سفارش اضافه مشتری')) problems.push('The reason for the over-plan delivery was not recorded on the production receipt document');
  const seqStock = (await itemState(seqItem.id)).stock;
  if (seqStock !== 6) problems.push(`Stock after deliveries of 3 and 3 (with a reason) is ${seqStock}, not 6`);

  // ۳) پروژه لغوشده و کالای بیرون از پروژه
  const cancelledItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const cancelled = await projectWith('پروژه آزمون لغوشده', cancelledItem.id, 5);
  await pool.query(`UPDATE production_projects SET status = 'cancelled' WHERE id = $1`, [cancelled]);
  const cancelledRefusal = await rejection(() => deliver(cancelled, cancelledItem.id, 1, wh));
  if (!cancelledRefusal?.includes('لغو')) problems.push(`delivery of a cancelled project was not refused (${cancelledRefusal ?? 'accepted'})`);
  const strayItem = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const strayRefusal = await rejection(() => deliver(seq, strayItem.id, 1, wh));
  if (!strayRefusal?.includes('از محصولات پروژه')) problems.push(`delivery of an item outside the project was not refused (${strayRefusal ?? 'accepted'})`);
  for (const [item, label] of [[cancelledItem.id, 'the cancelled project item'], [strayItem.id, 'the item outside the project']] as const) {
    const { stock } = await itemState(item);
    if (stock !== 0) problems.push(`Stock of ${label} after the refused delivery is ${stock}, not zero`);
  }
  return problems;
}
