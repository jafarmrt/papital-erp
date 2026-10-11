/**
 * v10.0.243 (TD-1208، یافته B-08): نام انبار یک ردیف کاردکس یا تخصیص برای نمایش. کاربر کد انبار (`raw`) را نمی‌شناسد؛
 * کد خالی و `default` انبار پیش‌فرض است (فعال با کمترین شناسه، همان قاعده سرور)، کد دیگر نام انبارش را می‌گیرد
 * (بی‌توجه به بزرگی و کوچکی حروف) و کدی که در فهرست نیست همان‌طور نشان داده می‌شود.
 */
export interface WarehouseNameRow {
  id: number;
  code: string;
  name: string;
  is_active?: number;
  isActive?: number;
}

const DEFAULT_WAREHOUSE_CODES = new Set(['', 'default']);

function isActiveRow(row: WarehouseNameRow): boolean {
  const flag = row.isActive ?? row.is_active;
  return flag === undefined || Number(flag) === 1;
}

export function warehouseLabel(code: string | null | undefined, warehouses: readonly WarehouseNameRow[] | null | undefined): string {
  const raw = String(code ?? '').trim();
  const rows = Array.isArray(warehouses) ? warehouses : [];
  if (DEFAULT_WAREHOUSE_CODES.has(raw.toLowerCase())) {
    const fallback = [...rows].filter(isActiveRow).sort((a, b) => a.id - b.id)[0];
    return fallback?.name?.trim() || 'انبار پیش‌فرض';
  }
  const key = raw.toLowerCase();
  const match = rows.find((row) => String(row.code ?? '').trim().toLowerCase() === key);
  return match?.name?.trim() || raw;
}
