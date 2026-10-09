/**
 * v10.0.32 (OBS-R1-74): مرتب‌سازی فهرست کالا در سرور. پیش‌تر صفحه فقط ردیف‌های صفحه جاری را مرتب می‌کرد؛ اکنون ستون و جهت
 * به `GET /items` فرستاده می‌شود و پایگاه‌داده همه کالاهای پالایش را مرتب می‌کند. کلیدی بیرون از این فهرست نادیده گرفته
 * می‌شود و ترتیب پیش‌فرض (تازه‌ترین کالا) می‌ماند. این فایل مشترک سرور و صفحه کالاهاست.
 */
export const ITEM_LIST_SORT_KEYS = ['category', 'code', 'name', 'reorder_point', 'weighted_average_cost', 'current_stock'] as const;
export type ItemListSortKey = typeof ITEM_LIST_SORT_KEYS[number];
export type SortDirection = 'asc' | 'desc';

export interface ItemListSort {
  key: ItemListSortKey;
  direction: SortDirection;
}

export function parseItemListSort(key: unknown, direction: unknown): ItemListSort | null {
  if (typeof key !== 'string' || !(ITEM_LIST_SORT_KEYS as readonly string[]).includes(key)) return null;
  return { key: key as ItemListSortKey, direction: direction === 'desc' ? 'desc' : 'asc' };
}

/** آمار فهرست کالا که سرور روی همه کالاهای پالایش (نه فقط صفحه) می‌شمارد */
export interface ItemListStats {
  /** کالاهای دارای نقطه سفارش که موجودی‌شان به آن رسیده یا کمتر است */
  lowStock: number;
}
