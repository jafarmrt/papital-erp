import { z } from 'zod';
import { readDecimalInputText } from '../lib/decimalInputText.js';
import { toLatinDigits } from '../lib/numericInput.js';

/**
 * The body shape of a project's inventory control (`inventory_control` / `inventoryControl` of `POST` and
 * `PUT /projects`; v10.2.30, TD-1326, OBS-R1-92). Before it was `z.unknown()`, so a row quantity typed as «۱۲» or as
 * text reached the reservation as `NaN`. Only what the server reads is checked: the sections, their rows and the purchase
 * lists are objects and arrays, and the quantities the finalize reads with `Number` are non-negative numbers: a row's
 * `requiredQty` and `qtyPerUnit` (TD-1343) and a manual row's `totalRequiredQty`. A quantity sent as text is read with
 * the number field's own rule (`readDecimalInputText`): Persian or Arabic digits, «٫», and «٬» only between groups of
 * three digits, so «۱٬۲» or «12,5» is 400, not 12 or 125, and so is a space between digits («1 2»); it is stored as its
 * number. An empty text or null stays as sent (the reservation reads them as it did); a `qtyPerUnit` of null is a «کل»
 * row, but an empty text there is 400, since it would silently turn the row into one. Every other field passes through
 * unchanged: the conversion rate (the finalize already treats a rate that is not a positive number as no conversion), the
 * stock and purchase figures the browser computes, and the parts the server writes itself (`reservedItems`,
 * `reservationShortages`, `finalizedAt`, ignored as before, TD-306). The tab resends every section on each save, so a 400
 * names the section and the row (its name and code) as the tab shows them, and each checked field is one the tab edits, so
 * an odd value stored before is fixed in that row.
 */
const QUANTITY_LABELS = {
  requiredQty: 'مقدار لازم',
  qtyPerUnit: 'مقدار برای هر عدد',
  totalRequiredQty: 'مقدار کل لازم',
} as const;

type QuantityField = keyof typeof QUANTITY_LABELS;

const SECTION_ROW_FIELDS: readonly QuantityField[] = ['requiredQty', 'qtyPerUnit'];
const MANUAL_ROW_FIELDS: readonly QuantityField[] = ['totalRequiredQty'];

const ROWS_MAX = 5000;
const SECTIONS_MAX = 500;

type Row = Record<string, unknown>;

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** The row as the tab shows it: its name, with its code when both are there */
function rowLabel(row: Row, index: number): string {
  const name = textOf(row.name) || textOf(row.itemName);
  const code = textOf(row.itemCode) || textOf(row.code);
  if (name && code) return `«${name}» (کد ${code})`;
  if (name || code) return `«${name || code}»`;
  return `شمارهٔ ${index + 1}`;
}

/** A quantity read with the number field's rule: a number ≥ 0, or the value kept as sent, or why it is wrong */
function readQuantity(value: unknown, field: QuantityField): { value: unknown } | { error: string } {
  if (value === null || value === undefined) return { value };
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? { value } : { error: 'عدد منفی یا نامعتبر است.' };
  if (typeof value !== 'string') return { error: 'عدد نیست.' };
  if (value.trim() === '') return field === 'qtyPerUnit' ? { error: 'خالی است.' } : { value };
  // the number field drops spaces as it is typed; a stored «1 2» is two numbers, not 12
  if (/\d[\s\u200c]+\d/.test(toLatinDigits(value))) return { error: 'فاصله میان رقم‌ها پذیرفته نیست.' };
  const read = readDecimalInputText(value, { min: 0 });
  if (read.kind === 'invalid') return { error: read.error };
  if (read.kind === 'partial' || read.text === '') return { error: 'عدد کامل نیست.' };
  if (read.rangeError) return { error: read.rangeError };
  return { value: Number(read.text) };
}

/** The row with its checked quantities as numbers; each wrong one is an issue naming the section and the row */
function checkRow(row: Row, index: number, place: string, fields: readonly QuantityField[], ctx: z.RefinementCtx): Row {
  let out = row;
  for (const field of fields) {
    if (!(field in row)) continue;
    const read = readQuantity(row[field], field);
    if ('error' in read) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${place}، ردیف ${rowLabel(row, index)}: ${QUANTITY_LABELS[field]} باید عدد نامنفی باشد (${read.error} مقدار دریافتی: ${String(row[field])})`,
      });
    } else if (read.value !== row[field]) {
      out = { ...out, [field]: read.value };
    }
  }
  return out;
}

const controlRow = z.object({}).passthrough();
const rowList = z.array(controlRow).max(ROWS_MAX, `هر فهرست کنترل موجودی پروژه حداکثر ${ROWS_MAX} ردیف دارد`);

const controlSection = z.object({
  perItemResults: z.record(z.string(), z.record(z.string(), controlRow)).optional(),
  globalItems: rowList.optional(),
  // a section in the preset shape holds its materials in `items` (TD-748)
  items: rowList.optional(),
  itemsSchema: z.array(z.object({}).passthrough()).max(ROWS_MAX).optional(),
}).passthrough();

function checkSection(section: z.infer<typeof controlSection>, index: number, ctx: z.RefinementCtx) {
  const place = `بخش «${textOf(section.title) || textOf(section.name) || String(index + 1)}»`;
  const rows = (list: Row[]) => list.map((row, i) => checkRow(row, i, place, SECTION_ROW_FIELDS, ctx));
  const perItemResults = section.perItemResults && Object.fromEntries(Object.entries(section.perItemResults).map(([product, results]) => [
    product,
    Object.fromEntries(Object.entries(results).map(([key, row], i) => [key, checkRow(row, i, place, SECTION_ROW_FIELDS, ctx)])),
  ]));
  return {
    ...section,
    ...(perItemResults ? { perItemResults } : {}),
    ...(section.globalItems ? { globalItems: rows(section.globalItems) } : {}),
    ...(section.items ? { items: rows(section.items) } : {}),
  };
}

export const projectInventoryControlInput = z.object({
  sections: z.array(controlSection).max(SECTIONS_MAX, `کنترل موجودی پروژه حداکثر ${SECTIONS_MAX} بخش دارد`).optional(),
  purchaseList: rowList.optional(),
  manualPurchaseItems: rowList.optional(),
  productRequirements: z.record(z.string(), z.unknown()).optional(),
  isFinalized: z.boolean({ message: 'وضعیت ثبت نهایی کنترل موجودی پروژه باید درست یا نادرست باشد' }).optional(),
}).passthrough().transform((control, ctx) => ({
  ...control,
  ...(control.sections ? { sections: control.sections.map((section, i) => checkSection(section, i, ctx)) } : {}),
  ...(control.manualPurchaseItems
    ? { manualPurchaseItems: control.manualPurchaseItems.map((row, i) => checkRow(row, i, 'اقلام دستی', MANUAL_ROW_FIELDS, ctx)) }
    : {}),
})).nullable().optional();
