/**
 * TD-1342 (بستهٔ ۱۲ بند ۴، گزینهٔ ب کارت ت۴۲): هر زبانهٔ پروژه فقط بخش خودش را ذخیره می‌کند و پیام «کاربر دیگری تغییر داده»
 * فقط وقتی می‌آید که همان بخش از زمان باز شدن زبانه عوض شده باشد. داده همان‌جا می‌ماند (رکورد پروژه)؛ کارساز برای هر بخش یک
 * نشانه از مقدار ذخیره‌شدهٔ آن می‌سازد و زبانه نشانهٔ بخشی را که از آن ساخته شده با ذخیره پس می‌فرستد. آنچه کارساز خودش در
 * پروژه می‌نویسد (رزرو و کسر آن با حواله و تخصیص مواد، پیوند کارکرد ردیف برنامه با تأیید گزارش کارگاه) در نشانهٔ هیچ بخشی
 * نیست، پس جلوی ذخیرهٔ زبانه را نمی‌گیرد. مشترک میان کارساز و مرورگر.
 */

export const PROJECT_PARTS = ['specs', 'status', 'attachments', 'inventory', 'schedule'] as const;
export type ProjectPart = typeof PROJECT_PARTS[number];
export type ProjectPartTokens = Partial<Record<ProjectPart, string>>;

/** نسخه و نشانه‌هایی که بدنهٔ ذخیرهٔ یک زبانه می‌فرستد */
export interface ProjectWriteBase {
  version: number | undefined;
  partTokens?: ProjectPartTokens;
}

/** زبانه از نسخهٔ کهنهٔ همان بخش ساخته شده؟ با نشانهٔ بخش، وگرنه (پاسخ قدیمی بی نشانه) با نسخه */
export function isPartBehind(base: ProjectWriteBase, part: ProjectPart, current: { version?: number; token?: string }): boolean {
  const mine = base.partTokens?.[part];
  if (mine && current.token) return mine !== current.token;
  return current.version !== base.version;
}

export const PROJECT_PART_LABELS: Record<ProjectPart, string> = {
  specs: 'مشخصات',
  status: 'وضعیت',
  attachments: 'پیوست‌ها',
  inventory: 'کنترل موجودی',
  schedule: 'برنامهٔ کارگاه',
};

/** نشانهٔ هر بخش: ۳۲ رقم شانزده‌شانزدهی (نیمهٔ نخست SHA-256 مقدار ذخیره‌شدهٔ بخش) */
export const PROJECT_PART_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** نشانه‌های معتبر یک پاسخ یا رکورد پروژه (`partTokens`)؛ هر چیز دیگر کنار می‌رود */
export function projectPartTokensOf(value: unknown): ProjectPartTokens | undefined {
  const raw = value && typeof value === 'object' ? (value as { partTokens?: unknown }).partTokens : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: ProjectPartTokens = {};
  for (const part of PROJECT_PARTS) {
    const token = (raw as Record<string, unknown>)[part];
    if (typeof token === 'string' && PROJECT_PART_TOKEN_PATTERN.test(token)) out[part] = token;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** پیام ۴۰۹ وقتی همان بخشی که زبانه ذخیره می‌کند در این میان عوض شده است */
export function projectPartConflictMessage(parts: readonly ProjectPart[]): string {
  const names = parts.map(p => `«${PROJECT_PART_LABELS[p]}»`).join(' و ');
  return `${names} پروژه را کاربر دیگری تغییر داده؛ دوباره باز کنید.`;
}
