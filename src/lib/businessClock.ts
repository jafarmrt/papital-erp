import { orm } from '../db/drizzle.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * V10 Phase 1.1 — Business Clock (ساعت توافقی واحد)
 * ===================================================
 * تنها منبع حقیقت زمان برای سرور. تنظیم `display_timezone` در appSettings
 * (پیش‌فرض: Asia/Tehran، طبق توافق کاربر قابل تغییر در آینده) مشخص می‌کند
 * «اکنون» و «تاریخ امروز» سیستم از کدام منطقه زمانی خوانده شود.
 *
 * قواعد:
 *  - ذخیره‌سازی در DB یکدست ISO است (migration فاز ۱.۲ رشته‌های ترکیبی قدیمی
 *    را هم‌راستا می‌کند). تقویم جلالی صرفاً لایه نمایش کلاینت است.
 *  - هیچ ماژولی نباید مستقیماً `new Date().toISOString()` برای تاریخ سند/
 *    تراکنش بسازد؛ به‌جای آن از همین helper استفاده کند.
 */

export const FALLBACK_TIMEZONE = 'Asia/Tehran';

let cachedTz: { value: string; expiresAt: number } | null = null;
const TZ_TTL_MS = 60 * 1000;

/** مناطق زمانی مجاز برای انتخاب مدیر (در GeneralSettingsTab هم استفاده می‌شود) */
export const ALLOWED_TIMEZONES = [
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Istanbul',
  'Europe/Berlin',
  'Europe/London',
  'UTC',
  'America/New_York',
] as const;

/**
 * منطقه زمانی توافقی را برمی‌گرداند (کش ۶۰ ثانیه‌ای برای پرهیز از هر بار DB query).
 * هر مقدار غیرمعتبر/خالی به پیش‌فرض تهران می‌افتد.
 */
export async function getDisplayTimezone(): Promise<string> {
  if (cachedTz && Date.now() < cachedTz.expiresAt) return cachedTz.value;
  try {
    const [row] = await orm
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'display_timezone'))
      .limit(1);
    const raw = String(row?.value || '').trim();
    const valid = (ALLOWED_TIMEZONES as readonly string[]).includes(raw) ? raw : '';
    cachedTz = { value: valid || FALLBACK_TIMEZONE, expiresAt: Date.now() + TZ_TTL_MS };
    return cachedTz.value;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/** باطل کردن کش TZ پس از تغییر تنظیمات توسط مدیر */
export function invalidateTimezoneCache(): void {
  cachedTz = null;
}

/**
 * لحظه دقیق سیستم به‌صورت UTC ISO با پسوند Z — مخصوص ستون‌های timestamp لاگ‌ها
 * (Audit Trail و ...). UTC ذخیره می‌شود تا نمایش در هر مرورگری با
 * `display_timezone` سامانه بدون خطای شیفت انجام شود (قاعده V10-1.x Business Clock).
 */
export function systemNowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * نقطه "اکنون" در منطقه توافقی، به شکل ISO-like `YYYY-MM-DDTHH:mm:ss`
 * (بدون Z و بدون تبدیل UTC) تا با مقایسه‌های لغوی ستون‌های date سازگار بماند.
 */
export async function businessNowIsoDateTime(): Promise<string> {
  const tz = await getDisplayTimezone();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(',', '');
}

/** تاریخ امروز در منطقه توافقی: `YYYY-MM-DD` */
export async function businessTodayIsoDate(): Promise<string> {
  const tz = await getDisplayTimezone();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** تاریخ امروز در منطقه توافقی به فرمت جلالی خط‌تیره: `1405-06-06` (ارقام انگلیسی) */
export async function businessTodayJalaliDash(): Promise<string> {
  const tz = await getDisplayTimezone();
  return new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '-');
}

/**
 * استخراج سال مالی از تاریخ ورودی — جایگزین منطق دوگانهٔ قبلی که گاهی ۱۴۰۵
 * (جلالی) و گاهی 2026 (میلادی) برمی‌گرداند. اکنون قاعده صریح دارد:
 *   - اگر چهار رقم اول بازه جلالی معقول باشد (۱۳۰۰..۱۵۰۰) همان برگشت داده می‌شود
 *     (اسناد دارای تاریخ جلالی همیشه به سال جلالی خود پارتیشن می‌شوند)
 *   - در غیر این صورت اگر تاریخ قابلیت parseGregorian داشته باشد سال میلادی
 *     ترجمه‌شده به جلالیِ تقریبی (+۶۲۱) استفاده می‌شود تا شمارنده‌های ref-number
 *     هرگز بین دو تقویم نمی‌پرند.
 * به عبارت دیگر partition key همیشه «سال جلالی» است.
 */
export function resolveJalaliFiscalYear(dateLike?: string | number | null): number {
  const now = new Date();
  const fallback = now.getUTCFullYear() - 621;

  if (typeof dateLike === 'number' && dateLike > 1300 && dateLike < 1600) {
    return dateLike;
  }
  const s = String(dateLike ?? '').trim();
  if (!s) return fallback;

  // الگوهای جلالی: 1405/05/16 یا 1405-05-16 یا شروع با 14xx/13xx
  const jalaliMatch = s.match(/^(1[345]\d{2})[-/]/);
  if (jalaliMatch) return parseInt(jalaliMatch[1], 10);

  // ISO میلادی → جدول تبدیل تقریبی (روز قبل از فروردین/بعد از اسفند خطای حداکثر ±۱ سال نیست؛
  // دقت روزانه نیازی نیست چون فقط partition key است)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, gy, gm, gd] = isoMatch;
    const gY = parseInt(gy, 10), gM = parseInt(gm, 10), gD = parseInt(gd, 10);
    let jy = gY - 622;
    // Nowruz حدود 21 مارس؛ قبل از آن هنوز سال مالی جلالی قبل است
    const beforeNowruz = gM < 3 || (gM === 3 && gD < 21);
    if (beforeNowruz) jy -= 1;
    return jy;
  }

  const fallback4 = s.match(/^(\d{4})/);
  if (fallback4) {
    const y = parseInt(fallback4[1], 10);
    if (y >= 1300 && y <= 1500) return y;
    return y - 621 > 0 ? y - 621 : fallback;
  }
  return fallback;
}
