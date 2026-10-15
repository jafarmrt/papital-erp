import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * v10.1.6 (N-06، TD-1262، تصمیم ت۲۶ مالک محصول): محصولی که بی پروژه در کارگاه ساخته شده دوباره از صفحه «ورود و خروج انبار»
 * با رسید تولید وارد انبار می‌شود (از v9.0.325، TD-780، فقط تحویل پروژه بود). رسید تولید پروژه همان مسیر پروژه می‌ماند و از این
 * قاعده‌ها نمی‌گذرد. رسید تولید بی پروژه:
 * - فقط قطعی ثبت می‌شود؛ پیش‌نویس آن را هیچ مسیری قطعی نمی‌کند (`assertProductionReceiptNotFinalized`).
 * - فقط ریالی است: بهای واحد بهای مواد مصرفی به ریال است و سند حسابداری «مصرف مواد بی پروژه» را به ریال بستانکار می‌کند.
 * - فقط کالای «محصول نهایی» می‌گیرد؛ ماده اولیه با رسید خرید وارد انبار می‌شود.
 * بهای واحد همان قاعده تحویل پروژه است: بهای واردشده، وگرنه میانگین موزون فعلی کالا (ردیف بهای صفر به همان میانگین، TD-256)؛
 * کالایی که میانگین ندارد با بهای صفر پذیرفته نمی‌شود (TD-906، `assertIncomingLinesHaveCost`).
 */
export interface ProductionReceiptInput {
  docType: string;
  projectId: number | null;
  status: string;
  /** ارز سند پس از پیش‌فرض (خالی = ریال) */
  currency: string;
  lines: ReadonlyArray<{ itemId: number | string }> | null | undefined;
}

/** رسید تولید بی پروژه است، نه تحویل پروژه */
export function isStandaloneProductionReceipt(docType: string, projectId: number | null): boolean {
  return docType === 'production_receipt' && projectId === null;
}

/** قاعده‌های رسید تولید بی پروژه، درون تراکنش ثبت و پس از قفل کالاها، پیش از هر نوشتن */
export async function assertStandaloneProductionReceipt(tx: DbExecutor, input: ProductionReceiptInput): Promise<void> {
  if (!isStandaloneProductionReceipt(input.docType, input.projectId)) return;
  if (input.status !== 'final') {
    throw new ValidationError(
      'رسید تولید بی پروژه فقط به‌صورت قطعی ثبت می‌شود؛ پیش‌نویس یا پیش‌فاکتور آن پذیرفته نیست.',
      { status: input.status },
      'PRODUCTION_RECEIPT_FINAL_ONLY',
    );
  }
  if (input.currency !== 'IRR') {
    throw new ValidationError(
      'رسید تولید بی پروژه فقط ریالی ثبت می‌شود، چون بهای واحد آن بهای مواد مصرفی به ریال است.',
      { currency: input.currency },
      'PRODUCTION_RECEIPT_RIAL_ONLY',
    );
  }
  const itemIds = [...new Set((input.lines ?? []).map(line => Number(line.itemId)).filter(id => Number.isInteger(id) && id > 0))];
  if (itemIds.length === 0) return;
  const rows = await tx.select({ id: items.id, code: items.code, name: items.name, type: items.type })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0)));
  const notProducts = rows.filter(row => row.type !== 'product').sort((a, b) => a.id - b.id);
  if (notProducts.length === 0) return;
  const names = notProducts.map(row => `«${row.name}» (${row.code})`).join('، ');
  throw new ValidationError(
    `${notProducts.length === 1 ? 'کالای' : 'کالاهای'} ${names} محصول نهایی نیست؛ رسید تولید بی پروژه فقط محصول ساخته‌شده را وارد انبار می‌کند و ماده اولیه با رسید خرید وارد می‌شود.`,
    { items: notProducts.map(row => ({ itemId: row.id, code: row.code, name: row.name, type: row.type })) },
    'PRODUCTION_RECEIPT_PRODUCTS_ONLY',
  );
}
