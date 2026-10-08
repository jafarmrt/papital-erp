/**
 * v9.0.363 (TD-749، TD-768): تنها قاعده تطبیق ردیف مواد پروژه با کالای انبار، مشترک میان سرور (رزرو پروژه) و مرورگر
 * (کنترل موجودی، فهرست خرید، سفارش خرید). پیش‌تر این قاعده در ۱۰ جا کپی شده بود و فهرست خرید مرورگر نام را با زیررشته
 * می‌سنجید: «کارتن» موجودی «کارتن بسته‌بندی بزرگ» را می‌گرفت و از فهرست خرید بیرون می‌افتاد، و نام خالی اولین کالا را
 * می‌گرفت؛ سرور همان ماده را با نام دقیق رزرو می‌کرد.
 *
 * ترتیب: شناسه کالای انبار (اگر ردیف آن را دارد)، سپس کد با کلید شناسه کالا (`upper(btrim(code))`، TD-653)، سپس نام دقیق
 * با کلید نام کالا (`lower(btrim(name))`). کد یا نام خالی هرگز تطبیق نمی‌خورد و نام هرگز با زیررشته سنجیده نمی‌شود.
 */

export interface MatchableItem {
  id: number;
  code?: string | null;
  name?: string | null;
}

/** ردیف مواد پروژه: itemId فقط شناسه کالای انبار است، نه شناسه ردیف بخش کنترل موجودی */
export interface ProjectMaterialRef {
  itemId?: number | string | null;
  code?: string | null;
  name?: string | null;
}

/** کلید کد کالا، همان کلید یکتایی کالا (TD-653) */
export const itemCodeKey = (code: unknown): string =>
  typeof code === 'string' || typeof code === 'number' ? String(code).trim().toUpperCase() : '';

/** کلید نام کالا، همان کلید یکتایی کالا (TD-653) */
export const itemNameKey = (name: unknown): string =>
  typeof name === 'string' || typeof name === 'number' ? String(name).trim().toLowerCase() : '';

const positiveId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function findProjectItemMatch<T extends MatchableItem>(ref: ProjectMaterialRef, items: readonly T[] | null | undefined): T | undefined {
  const list = Array.isArray(items) ? items : [];
  const id = positiveId(ref.itemId);
  if (id !== null) {
    const byId = list.find(i => i.id === id);
    if (byId) return byId;
  }
  const code = itemCodeKey(ref.code);
  if (code) {
    const byCode = list.find(i => itemCodeKey(i.code) === code);
    if (byCode) return byCode;
  }
  const name = itemNameKey(ref.name);
  if (name) return list.find(i => itemNameKey(i.name) === name);
  return undefined;
}
