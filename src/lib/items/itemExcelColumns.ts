/**
 * سرستون نقطه سفارش در اکسل کالا، مشترک خروجی سرور، الگوی مرورگر و ورود اکسل (v9.0.183، TD-664: «هشدار» به‌جای «آلارم»).
 * سرستون‌های پیشین هنوز خوانده می‌شوند تا فایل‌های قدیمی همان نقطه سفارش را بدهند.
 */
export const ITEM_REORDER_POINT_COLUMN = 'حد نقطه سفارش (هشدار کسری)';
export const LEGACY_REORDER_POINT_COLUMNS = ['حد نقطه سفارش (آلارم کسری)'] as const;
/** همه سرستون‌هایی که نقطه سفارش را می‌دهند، به ترتیب اولویت */
export const REORDER_POINT_COLUMNS: readonly string[] = [
  ITEM_REORDER_POINT_COLUMN, ...LEGACY_REORDER_POINT_COLUMNS, 'حد نقطه سفارش', 'نقطه سفارش', 'reorder_point',
];
