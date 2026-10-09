/**
 * v10.0.27 (OBS-R1-71 / OBS-R1-72): فهرست‌های قیمت (`pricing_strategies`) یک آرایه JSON از عنوان‌هاست، مشترک سرور،
 * فرم تنظیمات و صفحه قیمت‌گذاری. پیش‌تر فرم عنوان‌ها را با کاما به هم می‌چسباند، پس عنوانی که خودش کاما داشت دو فهرست
 * می‌شد؛ و سرور هر خطای خواندن را می‌بلعید و فهرست پیش‌فرض را برمی‌گرداند. مقدار کهنه جداشده با کاما هنوز خوانده می‌شود.
 */
export const DEFAULT_PRICING_STRATEGIES = ['فروشگاه', 'مصرف‌کننده', 'عمده'] as const;
export const PRICING_STRATEGY_MAX_COUNT = 50;
export const PRICING_STRATEGY_MAX_LENGTH = 100;

export type PricingStrategiesRead = { titles: string[] } | { error: string };

function cleanTitles(values: unknown[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const value of values) {
    const title = String(value ?? '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

/** مقدار ذخیره‌شده: آرایه JSON، یا مقدار کهنه جداشده با کاما؛ خالی یعنی فهرست پیش‌فرض */
export function readPricingStrategies(stored: string | null | undefined): PricingStrategiesRead {
  const text = (stored ?? '').trim();
  if (!text) return { titles: [...DEFAULT_PRICING_STRATEGIES] };
  if (text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'تنظیم فهرست‌های قیمت خوانا نیست؛ فهرست‌ها را در تنظیمات دوباره ذخیره کنید.' };
    }
    if (!Array.isArray(parsed)) return { error: 'تنظیم فهرست‌های قیمت باید فهرستی از عنوان‌ها باشد.' };
    const titles = cleanTitles(parsed);
    return { titles: titles.length > 0 ? titles : [...DEFAULT_PRICING_STRATEGIES] };
  }
  const titles = cleanTitles(text.split(','));
  return { titles: titles.length > 0 ? titles : [...DEFAULT_PRICING_STRATEGIES] };
}

/** مقداری که فرم تنظیمات ذخیره می‌کند */
export function serializePricingStrategies(titles: string[]): string {
  return JSON.stringify(cleanTitles(titles));
}

/** سنجش ذخیره: آرایه JSON از عنوان‌های غیرتکراری، دست‌کم یکی، با سقف شمار و طول */
export function pricingStrategiesSettingError(value: unknown): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? ''));
  } catch {
    return 'فهرست‌های قیمت باید فهرستی از عنوان‌ها باشد.';
  }
  if (!Array.isArray(parsed) || parsed.some(v => typeof v !== 'string')) {
    return 'فهرست‌های قیمت باید فهرستی از عنوان‌ها باشد.';
  }
  const titles = cleanTitles(parsed);
  if (titles.length === 0) return 'دست‌کم یک فهرست قیمت لازم است.';
  if (titles.length !== parsed.length) return 'عنوان فهرست قیمت خالی یا تکراری است.';
  if (titles.length > PRICING_STRATEGY_MAX_COUNT) return `حداکثر ${PRICING_STRATEGY_MAX_COUNT.toLocaleString('fa-IR')} فهرست قیمت پذیرفته است.`;
  if (titles.some(t => t.length > PRICING_STRATEGY_MAX_LENGTH)) {
    return `عنوان فهرست قیمت حداکثر ${PRICING_STRATEGY_MAX_LENGTH.toLocaleString('fa-IR')} نویسه است.`;
  }
  return null;
}
