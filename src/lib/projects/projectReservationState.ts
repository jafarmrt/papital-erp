/**
 * v9.0.371 (TD-817، یافته B07-01، تصمیم ت۲ بسته ۷): رزرو پروژه فقط ردیف‌های ذخیره‌شده `inventory_control.reservedItems`
 * پروژه‌ای است که ثبت نهایی شده است (`isFinalized === true`). سرور این ردیف‌ها را هنگام ثبت نهایی می‌سازد، با حواله خروج
 * پروژه کم می‌کند و با خروج از ثبت نهایی خالی می‌کند (TD-306)؛ هیچ خواننده‌ای رزرو را از بخش‌های کنترل موجودی، فهرست خرید
 * یا اقلام دستی دوباره نمی‌سازد، پس پروژه پیش‌نویس رزرو ندارد و رزرو مصرف‌شده دوباره زنده نمی‌شود.
 * این قاعده در سرور (گزارش رزروها و دروازه فروش) و در مرورگر (فرم سند انبار) یکی است.
 */

import type { ReservationShortage } from './projectReservation.js';

const asObject = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** پروژه ثبت نهایی شده است («ثبت نهایی و فریز اقلام»)؛ فقط مقدار بولی true */
export function isProjectFinalized(inventoryControl: unknown): boolean {
  return asObject(inventoryControl)?.isFinalized === true;
}

/** ردیف‌های رزرو ذخیره‌شده پروژه، بی‌توجه به ثبت نهایی (کسر و برگشت رزرو با حواله خروج همین ردیف‌ها را می‌خوانند) */
export function storedReservationRows<T = Record<string, unknown>>(inventoryControl: unknown): T[] {
  const rows = asObject(inventoryControl)?.reservedItems;
  return Array.isArray(rows) ? rows.filter((r): r is T => !!asObject(r)) : [];
}

/** ردیف‌هایی که موجودی را رزرو می‌کنند: رزرو ذخیره‌شده پروژه ثبت نهایی‌شده، وگرنه هیچ */
export function reservingProjectRows<T = Record<string, unknown>>(inventoryControl: unknown): T[] {
  return isProjectFinalized(inventoryControl) ? storedReservationRows<T>(inventoryControl) : [];
}

/**
 * v9.0.373 (TD-819، تصمیم ت۳): کمبود رزرو پروژه که سرور هنگام ثبت نهایی نوشته است (`inventory_control.reservationShortages`):
 * کالاهایی که موجودی آزادشان (کل − رزرو دیگران) کمتر از نیاز پروژه بود
 */
export function storedReservationShortages(inventoryControl: unknown): ReservationShortage[] {
  const rows = asObject(inventoryControl)?.reservationShortages;
  return Array.isArray(rows) ? rows.filter((r): r is ReservationShortage => !!asObject(r)) : [];
}
