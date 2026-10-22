import type {
  InventoryControlPresetItem,
  ProjectInventoryControlItemResult,
  ProjectInventoryControlSectionData,
} from '../../types/project.types';
import { NEW_ROW_QTY_PER_UNIT, perUnitRowFields, productOrderQuantity } from './materialQuantity.js';

/**
 * v9.0.413 (TD-748، B11-14): بخش‌های «الگوی کنترل موجودی» (تنظیمات و الگوی پیش‌فرض) مواد را در `items` نگه می‌دارند،
 * ولی کنترل موجودی پروژه، فهرست خرید، پیشرفت مواد و رزرو ثبت نهایی فقط ردیف‌های پروژه را می‌خوانند: کنترل کد به کد
 * `perItemResults` (برای هر محصول) و `itemsSchema`، کنترل کلی `globalItems`. پیش‌تر الگوی پیش‌فرض با ۱۰ ماده
 * فهرست خرید خالی، پیشرفت مواد ۱۰۰٪ و ثبت نهایی بی رزرو می‌داد. این تابع بخش الگو را به همان ردیف‌ها می‌برد؛ بخشی که
 * ردیف پروژه دارد دست نمی‌خورد، پس تبدیل دوباره بی‌اثر است.
 */

/** موجودی ماده‌ای که با کالای انبار جور است، یا undefined وقتی کالایی جور نیست */
export type MaterialStockLookup = (material: { code: string; name: string }) => number | undefined;

/** مقدار لازم هر ماده الگو، مثل ماده‌ای که کاربر به بخش می‌افزاید (در بخش کد به کد برای هر عدد محصول، TD-1343) */
export const PRESET_MATERIAL_REQUIRED_QTY = NEW_ROW_QTY_PER_UNIT;

type SectionLike = Record<string, unknown>;

const isObject = (v: unknown): v is SectionLike => !!v && typeof v === 'object' && !Array.isArray(v);
const hasRows = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : isObject(v) && Object.keys(v).length > 0);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * کلید ردیف‌های یک محصول در `perItemResults`: شناسه ردیف محصول، وگرنه `prod_<شناسه کالا>`، وگرنه جایگاه آن؛ همان که زبانه مواد
 * می‌سازد و ثبت نهایی و تکمیل رزرو می‌خوانند (TD-1343: پیش‌تر ثبت نهایی محصول بی شناسه را با کلید خالی می‌جست)
 */
export function perItemProductKey(product: { id?: unknown; item_id?: unknown } | null | undefined, idx: number): string {
  return text(product?.id) || `prod_${text(product?.item_id) || idx}`;
}

/** بخش الگو: مواد در `items` و هنوز هیچ ردیف پروژه‌ای ندارد */
export function isPresetShapedSection(section: unknown): boolean {
  if (!isObject(section) || !Array.isArray(section.items) || section.items.length === 0) return false;
  return !hasRows(section.itemsSchema) && !hasRows(section.globalItems) && !hasRows(section.perItemResults);
}

export const hasPresetShapedSections = (sections: unknown): boolean => Array.isArray(sections) && sections.some(isPresetShapedSection);

function presetItems(section: SectionLike): InventoryControlPresetItem[] {
  return (section.items as unknown[]).filter(isObject).map((item, idx) => ({
    id: text(item.id) || `preset_item_${idx + 1}`,
    name: text(item.name),
    itemCode: text(item.itemCode) || undefined,
    unit: text(item.unit) || 'عدد',
    ...(item.isOptional === true ? { isOptional: true } : {}),
    ...(text(item.notes) ? { notes: text(item.notes) } : {}),
  }));
}

/**
 * ردیف ماده الگو با وضعیت از موجودی جور، مانند افزودن ماده از انبار؛ با تعداد سفارش (بخش کد به کد) ردیف «برای هر عدد» است
 * و نیاز کل آن یک × تعداد سفارش محصول (TD-1343)
 */
function materialRow(item: InventoryControlPresetItem, stockOf?: MaterialStockLookup, orderQty?: number): ProjectInventoryControlItemResult {
  const stock = stockOf?.({ code: item.itemCode ?? '', name: item.name });
  const stockQty = Number.isFinite(stock) ? Number(stock) : 0;
  const qty = orderQty === undefined ? { requiredQty: PRESET_MATERIAL_REQUIRED_QTY } : perUnitRowFields(PRESET_MATERIAL_REQUIRED_QTY, orderQty);
  return {
    itemId: item.id,
    name: item.name,
    itemCode: item.itemCode ?? '',
    unit: item.unit || 'عدد',
    ...qty,
    stockQty,
    status: stockQty >= qty.requiredQty ? 'available' : 'needs_procurement',
    ...(item.notes ? { notes: item.notes } : {}),
  };
}

/** OBS-R2-45 (TD-1322): the code and name of each material of the preset-shaped sections, the refs `materialRow` matches */
export function presetMaterialRefs(sections: unknown): Array<{ code: string; name: string }> {
  if (!Array.isArray(sections)) return [];
  return sections.filter(isObject).filter(isPresetShapedSection)
    .flatMap(section => presetItems(section).map(m => ({ code: m.itemCode ?? '', name: m.name })));
}

/**
 * `perUnit`: ردیف کد به کد «برای هر عدد» محصول باشد (الگوی تنظیمات یا پیش‌فرض برای پروژه‌ای که هنوز بخشی ندارد، TD-1343).
 * بی آن ردیف همان عدد کل پیشین را دارد: بخشی که هنوز به شکل الگو ذخیره شده (ثبت نهایی پیش از v9.0.413) ردیف پیشین است
 * و نیازش با به‌روزرسانی عوض نمی‌شود (بازبینی M1).
 */
export interface PresetConversionOptions { perUnit?: boolean }

/**
 * بخش‌های کنترل موجودی پروژه از بخش‌های الگو: کنترل کد به کد برای هر محصول پروژه یک ردیف از هر ماده (و `itemsSchema` برای
 * محصولی که بعداً افزوده شود)، کنترل کلی یک ردیف کلی از هر ماده. بخش دیگر همان‌طور برمی‌گردد.
 */
export function projectSectionsFromPreset(
  sections: unknown,
  products: ReadonlyArray<{ id?: unknown; item_id?: unknown; quantity?: unknown }>,
  stockOf?: MaterialStockLookup,
  { perUnit = false }: PresetConversionOptions = {},
): ProjectInventoryControlSectionData[] {
  if (!Array.isArray(sections)) return [];
  // شناسه محصول همان است که صفحه کنترل موجودی می‌سازد: شناسه ردیف، وگرنه `prod_<شناسه کالا>`
  const productRows = products.map((p, idx) => ({ key: perItemProductKey(p, idx), orderQty: perUnit ? productOrderQuantity(p) : undefined }));
  return sections.filter(isObject).map(section => {
    if (!isPresetShapedSection(section)) return section as unknown as ProjectInventoryControlSectionData;
    const { items: _presetItems, ...rest } = section;
    const materials = presetItems(section);
    const base = rest as unknown as ProjectInventoryControlSectionData;
    if (section.checkType === 'per_item') {
      const perItemResults: Record<string, Record<string, ProjectInventoryControlItemResult>> = {};
      for (const { key, orderQty } of productRows) {
        perItemResults[key] = Object.fromEntries(materials.map(m => [m.id, materialRow(m, stockOf, orderQty)]));
      }
      return { ...base, itemsSchema: materials, perItemResults };
    }
    return { ...base, checkType: 'global', globalItems: materials.map(m => materialRow(m, stockOf)) };
  });
}
