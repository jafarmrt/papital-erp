/**
 * صفحه نقطه سفارش: نوع اقلام هشدار و محاسبات خالص صفحه (فیلتر، دسته‌بندی‌ها، جمع ارزش کسری،
 * اقلام مودال سفارش خرید و محصولات پروژه تولید) — همان محاسبات ReorderAlertsPage پیشین.
 */

export interface ReorderItem {
  id: number;
  name: string;
  code: string;
  type: 'product' | 'raw_material';
  unit: string;
  category?: string;
  image?: string;
  thumbnail?: string;
  current_stock: number;
  reorder_point: number;
  weighted_average_cost: number;
  deficit: number;
  deficit_value: number;
  is_zero_stock: boolean;
  stocks?: Record<string, number>;
  /** v9.0.171 (TD-654): نسخه کالا؛ ویرایش نقطه سفارش آن را همراه کالا می‌فرستد */
  version?: number;
}

/** قلم مودال سفارش خرید مواد اولیه (مقدار و قیمت سفارش قابل ویرایش) */
export interface ReorderModalItem {
  id: number;
  name: string;
  code: string;
  unit: string;
  current_stock: number;
  reorder_point: number;
  deficit: number;
  weighted_average_cost: number;
  type: 'product' | 'raw_material';
  orderQty: number;
  unitPrice: number;
}

/** ردیف محصول پیش‌فرض مودال تعریف پروژه تولید */
export interface ReorderProjectProduct {
  item_id: number;
  item_code: string;
  item_name: string;
  quantity: number;
  unit: string;
}

export type StockStatusFilter = 'all' | 'zero' | 'below_reorder';

/**
 * v9.0.382 (TD-827، یافته B07-11، تصمیم ت۸): هر کالای هشدار یا «بی موجودی» است یا «زیر نقطه سفارش» (موجودی مثبت و حداکثر
 * نقطه سفارش، چون سرور فقط همین‌ها را می‌فرستد) و پالایش وضعیت همین را می‌سنجد. پیش‌تر «زیر آستانه» کالای دارای موجودی را
 * کنار می‌گذاشت و همان کالاهای بی موجودی را نشان می‌داد.
 */
export const STOCK_STATUS_FILTER_LABELS: Record<StockStatusFilter, string> = {
  all: 'همه',
  zero: 'بی موجودی',
  below_reorder: 'زیر نقطه سفارش',
};

export function stockStatusOf(item: Pick<ReorderItem, 'is_zero_stock' | 'current_stock'>): Exclude<StockStatusFilter, 'all'> {
  return item.is_zero_stock || !(Number(item.current_stock) > 0) ? 'zero' : 'below_reorder';
}

export interface ReorderFilters {
  stockStatusFilter: StockStatusFilter;
  selectedCategory: string;
  search: string;
}

/** پاسخ GET /items/reorder-alerts: فقط آرایه پذیرفته می‌شود (هر پاسخ دیگر = فهرست خالی) */
export function reorderItemsFromResponse(data: unknown): ReorderItem[] {
  return Array.isArray(data) ? (data as ReorderItem[]) : [];
}

export function reorderCategories(items: ReorderItem[]): string[] {
  const set = new Set<string>();
  const safeItems = Array.isArray(items) ? items : [];
  safeItems.forEach(it => {
    if (it.category) set.add(it.category);
  });
  return Array.from(set);
}

export function filterReorderItems(items: ReorderItem[], { stockStatusFilter, selectedCategory, search }: ReorderFilters): ReorderItem[] {
  const safeItems = Array.isArray(items) ? items : [];
  return safeItems.filter(it => {
    // Stock status filter
    if (stockStatusFilter !== 'all' && stockStatusOf(it) !== stockStatusFilter) return false;

    // Category filter
    if (selectedCategory !== 'all' && it.category !== selectedCategory) return false;

    // Search
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      const matchName = it.name.toLowerCase().includes(query);
      const matchCode = it.code.toLowerCase().includes(query);
      const matchCat = (it.category || '').toLowerCase().includes(query);
      if (!matchName && !matchCode && !matchCat) return false;
    }

    return true;
  });
}

export function sumDeficitValue(items: ReorderItem[]): number {
  return items.reduce((sum, i) => sum + i.deficit_value, 0);
}

export function toPurchaseModalItem(item: ReorderItem): ReorderModalItem {
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    unit: item.unit,
    current_stock: item.current_stock,
    reorder_point: item.reorder_point,
    deficit: item.deficit,
    weighted_average_cost: item.weighted_average_cost,
    type: item.type,
    orderQty: item.deficit,
    unitPrice: item.weighted_average_cost
  };
}

export function toProjectProduct(item: ReorderItem): ReorderProjectProduct {
  return {
    item_id: item.id,
    item_code: item.code,
    item_name: item.name,
    quantity: item.deficit,
    unit: item.unit || 'عدد'
  };
}

/** درصد پر شدن نوار موجودی نسبت به نقطه سفارش */
export function stockPercentOf(item: ReorderItem): number {
  return item.reorder_point > 0
    ? Math.min(100, Math.round((item.current_stock / item.reorder_point) * 100))
    : 0;
}
