import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';

/** Incoming documents that bring their own cost into stock (a sales return enters at the original invoice's cost) */
const COSTED_INCOMING_TYPES: ReadonlySet<string> = new Set(['receipt', 'purchase', 'production_receipt']);

export interface IncomingCostLine {
  itemId: number | string;
  /** The line's net unit cost in IRR, as the stock movement records it */
  unitCostIrr: DecimalValue;
}

/**
 * v9.0.453 (TD-906 / TD-916، یافته‌های P5-M04 و P5-P09 فاز ۵، تصمیم ت۲ الف): کالایی که هنوز میانگین موزون بها ندارد با بهای صفر
 * وارد انبار نمی‌شود؛ همان قاعده فرم هشدار نقطه سفارش (TD-830) اکنون در کارساز است، برای رسید و خرید قطعی، نهایی‌سازی آن‌ها
 * (تحویل سفارش تدارکات هم) و رسید تولید تحویل پروژه. پیش‌تر چنین ردیفی کالا را با بهای صفر وارد می‌کرد (کاردکس صفر، سند
 * حسابداری بی ردیف) و پس از آن هر فاکتور و حواله‌ای برای آن کالا ۴۲۲ «هنوز بهای تمام‌شده ندارد» می‌گرفت. ردیف بهای صفر کالایی
 * که میانگین دارد همان «کالای اهدایی» TD-268 است و پذیرفته می‌شود. کالاها پیش از این تابع قفل شده‌اند.
 */
export async function assertIncomingLinesHaveCost(tx: DbExecutor, docType: string, lines: IncomingCostLine[]): Promise<void> {
  if (!COSTED_INCOMING_TYPES.has(docType)) return;
  const zeroCostIds = [...new Set(lines
    .filter(line => !fin(line.unitCostIrr).isPositive())
    .map(line => Number(line.itemId))
    .filter(id => Number.isInteger(id) && id > 0))];
  if (zeroCostIds.length === 0) return;

  const rows = await tx
    .select({ id: items.id, code: items.code, name: items.name, weightedAverageCost: items.weightedAverageCost })
    .from(items)
    .where(and(inArray(items.id, zeroCostIds), eq(items.isDeleted, 0)));
  const withoutCost = rows.filter(row => !fin(row.weightedAverageCost).isPositive()).sort((a, b) => a.id - b.id);
  if (withoutCost.length === 0) return;

  const names = withoutCost.map(row => `«${row.name}» (${row.code})`).join('، ');
  throw new ValidationError(
    `${withoutCost.length === 1 ? 'کالای' : 'کالاهای'} ${names} هنوز میانگین موزون بها ندارد و با بهای صفر وارد انبار نمی‌شود؛ ` +
    'چنین کالایی پس از ورود بی بها در هیچ فروش و حواله‌ای پذیرفته نمی‌شود. بهای واحد آن را وارد کنید.',
    { items: withoutCost.map(row => ({ itemId: row.id, code: row.code, name: row.name })) },
    'INCOMING_LINE_WITHOUT_COST'
  );
}
