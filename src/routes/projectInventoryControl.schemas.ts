import { z } from 'zod';
import { DECIMAL_PATTERN, normalizeDecimalString } from '../lib/numericInput.js';

/**
 * The body shape of a project's inventory control (`inventory_control` / `inventoryControl` of `POST` and
 * `PUT /projects`; v10.2.28, TD-1326, OBS-R1-92). Before it was `z.unknown()`, so a row quantity typed as «۱۲» or as
 * text reached the reservation as `NaN`. Only what the server reads is checked: the sections, their rows and the purchase
 * lists are objects and arrays, and every quantity, stock or rate of a row is a non-negative number. A quantity sent as
 * text with Persian or Arabic digits is stored as its number; an empty text or null stays as sent (the reservation reads
 * them as it did); any other text is 400. Fields the server does not read (names, units, notes, the browser's own
 * fields) pass through unchanged, and the parts the server writes itself (`reservedItems`, `reservationShortages`,
 * `finalizedAt`) are ignored as before (TD-306).
 */
const ROW_QUANTITY_FIELDS = [
  'requiredQty', 'stockQty', 'convertedQty', 'conversionRate', 'fulfilledQty', 'issuedQty',
  'totalRequiredQty', 'warehouseStockQty', 'toPurchaseQty', 'convertedRequiredQty', 'convertedToPurchaseQty',
] as const;

const QUANTITY_LABELS: Record<(typeof ROW_QUANTITY_FIELDS)[number], string> = {
  requiredQty: 'مقدار لازم',
  stockQty: 'موجودی',
  convertedQty: 'مقدار تبدیل‌شده',
  conversionRate: 'ضریب تبدیل واحد',
  fulfilledQty: 'مقدار تأمین‌شده',
  issuedQty: 'مقدار داده‌شده',
  totalRequiredQty: 'مقدار کل لازم',
  warehouseStockQty: 'موجودی انبار',
  toPurchaseQty: 'مقدار خرید',
  convertedRequiredQty: 'مقدار لازم تبدیل‌شده',
  convertedToPurchaseQty: 'مقدار خرید تبدیل‌شده',
};

const ROWS_MAX = 5000;
const SECTIONS_MAX = 500;

const rowQuantity = (label: string) => z.union([z.number(), z.string(), z.null()]).transform((v, ctx): number | string | null => {
  if (v === null) return v;
  if (typeof v === 'string' && v.trim() === '') return v;
  const n = typeof v === 'number' ? v : (DECIMAL_PATTERN.test(normalizeDecimalString(v)) ? Number(normalizeDecimalString(v)) : NaN);
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} در کنترل موجودی پروژه باید عدد نامنفی باشد (مقدار دریافتی: ${String(v)})` });
    return z.NEVER;
  }
  return n;
}).optional();

const rowShape = Object.fromEntries(ROW_QUANTITY_FIELDS.map(field => [field, rowQuantity(QUANTITY_LABELS[field])])) as {
  [K in (typeof ROW_QUANTITY_FIELDS)[number]]: ReturnType<typeof rowQuantity>;
};

const controlRow = z.object(rowShape).passthrough();
const rowList = z.array(controlRow).max(ROWS_MAX, `هر فهرست کنترل موجودی پروژه حداکثر ${ROWS_MAX} ردیف دارد`);

const controlSection = z.object({
  perItemResults: z.record(z.string(), z.record(z.string(), controlRow)).optional(),
  globalItems: rowList.optional(),
  // a section in the preset shape holds its materials in `items` (TD-748)
  items: rowList.optional(),
  itemsSchema: z.array(z.object({}).passthrough()).max(ROWS_MAX).optional(),
}).passthrough();

export const projectInventoryControlInput = z.object({
  sections: z.array(controlSection).max(SECTIONS_MAX, `کنترل موجودی پروژه حداکثر ${SECTIONS_MAX} بخش دارد`).optional(),
  purchaseList: rowList.optional(),
  manualPurchaseItems: rowList.optional(),
  productRequirements: z.record(z.string(), z.unknown()).optional(),
  isFinalized: z.boolean({ message: 'وضعیت ثبت نهایی کنترل موجودی پروژه باید درست یا نادرست باشد' }).optional(),
}).passthrough().nullable().optional();
