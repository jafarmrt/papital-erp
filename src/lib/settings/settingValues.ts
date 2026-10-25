/**
 * v9.0.276 (TD-672، تصمیم ت۴ بسته ۱۶): مقدار مجاز تنظیمات کسب‌وکاری، مشترک میان کارساز، فرم تنظیمات و پیشخوان.
 * روزهای گردش عدد صحیح ۱ تا ۳۶۵۰ با ترتیب تند < کند < راکد؛ `currency` فقط واحد نمایش ریال یا تومان (ت۱).
 * پیشخوان با مقدار نامعتبرِ ذخیره‌شده از پیش به پیش‌فرض برمی‌گردد، نه خطای ۵۰۰.
 */
import { RIAL_DISPLAY_UNITS, isRialDisplayUnit } from '../rialDisplay.js';
import { normalizeGroupedDecimalString } from '../numericInput.js';

export const MOVEMENT_DAY_KEYS = ['fast_moving_days', 'slow_moving_days', 'dead_stock_days'] as const;
export type MovementDayKey = typeof MOVEMENT_DAY_KEYS[number];

export const MOVEMENT_DAY_DEFAULTS: Record<MovementDayKey, number> = {
  fast_moving_days: 30,
  slow_moving_days: 90,
  dead_stock_days: 180
};

export const MOVEMENT_DAY_MIN = 1;
export const MOVEMENT_DAY_MAX = 3650;

export const MOVEMENT_DAY_LABELS: Record<MovementDayKey, string> = {
  fast_moving_days: 'تند گردش',
  slow_moving_days: 'کند گردش',
  dead_stock_days: 'کالای راکد'
};

const persianDigits = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export function isMovementDayKey(key: string): key is MovementDayKey {
  return (MOVEMENT_DAY_KEYS as readonly string[]).includes(key);
}

/** روزهای گردش: عدد صحیح ۱ تا ۳۶۵۰ (ارقام فارسی پذیرفته می‌شوند)، وگرنه null */
export function readMovementDays(raw: unknown): number | null {
  const text = normalizeGroupedDecimalString(String(raw ?? '')).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= MOVEMENT_DAY_MIN && n <= MOVEMENT_DAY_MAX ? n : null;
}

/** خطای سه مقدار روزهای گردش با هم (قالب هر کدام، سپس ترتیب)، یا null */
export function movementDaysError(values: Record<MovementDayKey, unknown>): string | null {
  const read = {} as Record<MovementDayKey, number>;
  for (const key of MOVEMENT_DAY_KEYS) {
    const n = readMovementDays(values[key]);
    if (n === null) {
      return `«${MOVEMENT_DAY_LABELS[key]}» باید عدد صحیحی از ${persianDigits(MOVEMENT_DAY_MIN)} تا ${persianDigits(MOVEMENT_DAY_MAX)} روز باشد.`;
    }
    read[key] = n;
  }
  if (!(read.fast_moving_days < read.slow_moving_days && read.slow_moving_days < read.dead_stock_days)) {
    return 'روزهای گردش باید به ترتیب «تند گردش» کمتر از «کند گردش» و «کند گردش» کمتر از «کالای راکد» باشند.';
  }
  return null;
}

/** روزهای گردش برای پیشخوان: مقدار ذخیره‌شده اگر هر سه درست باشند، وگرنه هر سه پیش‌فرض */
export function resolveMovementDays(stored: Partial<Record<string, string | null | undefined>>): {
  fastDays: number; slowDays: number; deadDays: number; usedDefaults: boolean;
} {
  const values = {
    fast_moving_days: stored.fast_moving_days ?? MOVEMENT_DAY_DEFAULTS.fast_moving_days,
    slow_moving_days: stored.slow_moving_days ?? MOVEMENT_DAY_DEFAULTS.slow_moving_days,
    dead_stock_days: stored.dead_stock_days ?? MOVEMENT_DAY_DEFAULTS.dead_stock_days
  };
  if (movementDaysError(values) !== null) {
    return {
      fastDays: MOVEMENT_DAY_DEFAULTS.fast_moving_days,
      slowDays: MOVEMENT_DAY_DEFAULTS.slow_moving_days,
      deadDays: MOVEMENT_DAY_DEFAULTS.dead_stock_days,
      usedDefaults: true
    };
  }
  return {
    fastDays: readMovementDays(values.fast_moving_days) as number,
    slowDays: readMovementDays(values.slow_moving_days) as number,
    deadDays: readMovementDays(values.dead_stock_days) as number,
    usedDefaults: false
  };
}

/** واحد نمایش مبالغ ریالی فقط از فهرست ت۱ */
export function currencySettingError(value: unknown): string | null {
  return isRialDisplayUnit(value)
    ? null
    : `واحد نمایش مبالغ فقط «ریال» یا «تومان» است (${RIAL_DISPLAY_UNITS.join(' یا ')}).`;
}

/**
 * v10.0.95 (TD-1192): price list names (`pricing_strategies`, stored joined with «,») are checked before they are saved,
 * by the settings form on each name and by the server on the stored list. A name with a Latin comma would be split into two
 * lists, and two names that differ only in spaces or letter case would be two lists of one price; both are refused with a
 * message that names them. Empty names are dropped. Before, «قیمت خرده‌فروشی, ویژه» was saved as two lists and a second
 * «قیمت خرده‌فروشی» was saved as well. Since price lists are stored as a JSON array (OBS-R1-71) a Latin comma no longer
 * splits a name, so the stored JSON list is checked with `allowLatinComma`.
 */
export function priceListNamesError(names: readonly string[], options: { allowLatinComma?: boolean } = {}): string | null {
  const seen = new Set<string>();
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (!options.allowLatinComma && name.includes(',')) return `نام فهرست قیمت «${name}» ویرگول لاتین «,» دارد؛ آن را بردارید یا از «،» استفاده کنید.`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `فهرست قیمت «${name}» دو بار آمده است؛ نام هر فهرست قیمت یکتاست.`;
    seen.add(key);
  }
  return null;
}

/**
 * 10.2 package 8 (TD-1297, review M-3): «آستانه تراکنش کلان خزانه» in rials. The treasury event carries no amount, only
 * `isHighValue` (its rial value at or above this threshold), so a rule such as the seeded «ثبت ممیزی تراکنش‌های کلان
 * خزانه‌داری» still finds large transactions. A whole number of rials above zero (Persian digits read), default
 * 500,000,000, the amount the seeded rule compared before.
 */
export const TREASURY_HIGH_VALUE_THRESHOLD_KEY = 'treasury_high_value_threshold';
export const TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT = 500_000_000;
export const TREASURY_HIGH_VALUE_THRESHOLD_MAX = 1_000_000_000_000_000;

/** the threshold as a whole number of rials above zero, else null */
export function readTreasuryHighValueThreshold(raw: unknown): number | null {
  const text = normalizeGroupedDecimalString(String(raw ?? ''));
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n > 0 && n <= TREASURY_HIGH_VALUE_THRESHOLD_MAX ? n : null;
}

export function treasuryHighValueThresholdError(raw: unknown): string | null {
  return readTreasuryHighValueThreshold(raw) === null
    ? '«آستانه تراکنش کلان خزانه» باید مبلغ صحیحی به ریال و بزرگ‌تر از صفر باشد.'
    : null;
}

/** the stored threshold, or the default when it is missing or not valid */
export function resolveTreasuryHighValueThreshold(stored: unknown): number {
  return readTreasuryHighValueThreshold(stored) ?? TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT;
}
