import { codeFormatError } from '../items/itemCodeFormat.js';

/**
 * v10.0.103 (TD-1202): one unit list for a raw-material request and its approval. Before, the project's request form
 * (`COMMON_UNITS` of `projectInventoryUtils.ts`) and the keeper's approval window (a list of its own) offered different
 * units, so a unit chosen in the request could be missing from the approval window.
 */
export const MATERIAL_UNITS: readonly string[] = Object.freeze([
  'عدد', 'ریسه', 'برگ', 'جفت', 'ست', 'بسته', 'پک', 'کارتن', 'قوطی', 'رول', 'ورق', 'پارت', 'شاخه', 'طغره', 'طاقه', 'کلاف',
  'متر', 'سانتی‌متر', 'مترمربع', 'کیلوگرم', 'گرم', 'لیتر', 'میلی‌لیتر',
]);

/** the units a select offers: the shared list, plus the stored value when an older record holds another unit */
export function materialUnitOptions(current?: string | null): readonly string[] {
  const value = String(current ?? '').trim();
  return value && !MATERIAL_UNITS.includes(value) ? [...MATERIAL_UNITS, value] : MATERIAL_UNITS;
}

export interface MaterialCategoryLike {
  name: string;
  prefix?: string | null;
  type?: string | null;
}

/** v10.0.103 (TD-1202): a raw-material request offers only raw-material categories, never product categories */
export function rawMaterialCategories<T extends MaterialCategoryLike>(categories: readonly T[]): T[] {
  return (Array.isArray(categories) ? categories : []).filter(c => c && c.type === 'raw_material');
}

/** a category prefix as codes carry it: trimmed, upper-case, no edge dashes («B-H-» → «B-H») */
export function materialCodePrefix(prefix: string | null | undefined): string {
  return String(prefix ?? '').trim().toUpperCase().replace(/^-+|-+$/g, '');
}

/** the sample code of a category for the approval form, e.g. «C-001» */
export function materialCodeExample(prefix: string | null | undefined): string {
  const p = materialCodePrefix(prefix);
  return p ? `${p}-001` : 'B-H-101';
}

/**
 * v10.0.103 (roles-b finding 8, TD-1202): the code an approved raw-material request takes follows the raw-material code
 * pattern (`codeFormatError`) and starts with its category's prefix, the rule the item form and the next-code
 * suggestion build codes with. Before, any code («XYZ-9») was accepted. Shared by the approval window and
 * `PendingMaterialsService.approvePendingMaterial` (422 `PENDING_MATERIAL_CODE_FORMAT`).
 */
export function pendingMaterialCodeError(code: string, category: MaterialCategoryLike | null | undefined): string | null {
  const clean = String(code ?? '').trim();
  if (!clean) return null;
  const formatError = codeFormatError(clean, 'raw_material', '');
  if (formatError) return formatError;
  const prefix = materialCodePrefix(category?.prefix);
  if (!prefix) return null;
  const head = clean.toUpperCase().replace(/-{1,2}\d{2,3}$/, '');
  if (head !== prefix) {
    return `کد ماده اولیه دسته «${category?.name ?? ''}» باید با پیشوند «${prefix}» و شماره دو یا سه‌رقمی باشد، مانند ${materialCodeExample(prefix)}. کد فرستاده‌شده: ${clean}`;
  }
  return null;
}
