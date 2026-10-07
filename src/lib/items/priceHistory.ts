import { serverTimestampToUtcIso } from '../serverTimestamp.js';

/**
 * v9.0.153 (TD-662): «زمان ثبت» یک ردیف تاریخچه قیمت زمان ساخت همان ردیف است (`created_at`، زمان سرور UTC با Z)؛
 * پیش‌تر `updated_at` نشان داده می‌شد که هنگام جایگزینی قیمت بازنویسی می‌شود.
 */
export function priceHistoryRegisteredAt(row: { created_at?: string | null; createdAt?: string | null; updated_at?: string | null; updatedAt?: string | null }): string | null {
  return serverTimestampToUtcIso(row.created_at ?? row.createdAt ?? row.updated_at ?? row.updatedAt ?? null);
}
