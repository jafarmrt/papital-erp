/**
 * v8.0.53 (TD-315): زمان‌های سرور (ستون‌های timestamp بی‌منطقه مانند `activity_logs.timestamp`) ساعت UTC‌اند
 * (`systemNowUtcIso` و از v8.0.52 جلسه پایگاه‌داده، TD-314). مرورگر رشته بی‌نشانه منطقه را ساعت منطقه توافقی
 * می‌خواند، پس API آن را با Z برمی‌گرداند؛ و فیلتر «روز» کاربر (روز منطقه توافقی) به بازه UTC همان روز تبدیل می‌شود.
 */

const SERVER_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** زمان سرور بی‌نشانه منطقه به ISO با Z؛ مقدار دارای منطقه یا ناشناخته همان‌طور برمی‌گردد */
export function serverTimestampToUtcIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const match = SERVER_TIMESTAMP.exec(String(value).trim());
  return match ? `${match[1]}T${match[2]}Z` : String(value);
}

/**
 * v9.0.391 (TD-725، B15-23): مقدار کلیدهای `keys` در هر عمق پاسخ، اگر زمان سرور بی‌منطقه باشد، به ISO با Z تبدیل می‌شود
 * (همان قاعده TD-468 گردش کار)؛ کلید دیگر، تاریخ کسب‌وکار (YYYY-MM-DD) و زمانی که منطقه دارد دست نمی‌خورد. داده
 * کلیدهای `opaqueKeys` (مانند payload رویداد که کاربر ویرایش و بازپخش می‌کند) همان‌طور که ذخیره شده می‌رود.
 */
export function withUtcTimestampKeys<T>(value: T, keys: ReadonlySet<string>, opaqueKeys?: ReadonlySet<string>): T {
  if (Array.isArray(value)) return value.map((v) => withUtcTimestampKeys(v, keys, opaqueKeys)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (opaqueKeys?.has(key)) out[key] = v;
    else if (typeof v === 'string' && keys.has(key) && SERVER_TIMESTAMP.test(v.trim())) out[key] = serverTimestampToUtcIso(v);
    else out[key] = withUtcTimestampKeys(v, keys, opaqueKeys);
  }
  return out as T;
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** آغاز روز `isoDate` (YYYY-MM-DD) در منطقه زمانی `timeZone`، به شکل زمان سرور UTC (`YYYY-MM-DD HH:MM:SS`) */
export function zonedDayStartUtc(isoDate: string, timeZone: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const wallMs = Date.UTC(y, m - 1, d);
  let utcMs = wallMs;
  for (let i = 0; i < 2; i++) utcMs = wallMs - zoneOffsetMs(utcMs, timeZone);
  return new Date(utcMs).toISOString().slice(0, 19).replace('T', ' ');
}

/** بازه UTC روزهای `startDate` تا `endDate` (هر دو شامل) در منطقه زمانی توافقی: `from` شامل، `before` ناشامل */
export function zonedDayRangeUtc(
  startDate: string | undefined, endDate: string | undefined, timeZone: string
): { from?: string; before?: string } {
  const range: { from?: string; before?: string } = {};
  if (startDate) range.from = zonedDayStartUtc(startDate, timeZone);
  if (endDate) {
    const [y, m, d] = endDate.split('-').map(Number);
    range.before = zonedDayStartUtc(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10), timeZone);
  }
  return range;
}
