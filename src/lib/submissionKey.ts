/**
 * v8.0.59 (TD-329): کلید تکرار درخواست (Idempotency-Key) مرورگر از محتوای ارسال ساخته می‌شود: همان روش، مسیر و بدنه
 * تا وقتی پاسخ قطعی نگرفته همان کلید را می‌گیرد. پیش‌تر هر ارسال کلید تازه داشت، پس دوبار کلیک یا ارسال دوباره فرمی که
 * پاسخش در شبکه گم شده بود دو بار ثبت می‌شد. پاسخ قطعی (موفق یا خطای سرور برنامه) کلید را آزاد می‌کند تا ثبت عمدی
 * بعدی با همان محتوا کار تازه‌ای باشد؛ خطای شبکه، لغو و خطای دروازه (۵۰۲/۵۰۳/۵۰۴) آن را نگه می‌دارند، چون شاید
 * درخواست به سرور رسیده و ثبت شده باشد.
 */

/** وضعیت‌هایی که شاید پاسخ برنامه نباشند (دروازه یا پراکسی): کلید برای ارسال دوباره همان محتوا نگه داشته می‌شود */
const UNSETTLED_STATUSES = new Set([502, 503, 504]);
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

const pending = new Map<string, { key: string; at: number }>();

function newKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fe_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function prune(now: number): void {
  for (const [fingerprint, entry] of pending) {
    if (now - entry.at > KEEP_MS) pending.delete(fingerprint);
  }
  while (pending.size >= MAX_ENTRIES) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** کلید این ارسال: برای همان روش، مسیر و بدنه متنی همان کلید باز؛ بدنه غیرمتنی (FormData و ...) کلید تازه می‌گیرد */
export function submissionKeyFor(method: string, endpoint: string, body: unknown): string {
  if (body !== undefined && body !== null && typeof body !== 'string') return newKey();
  const fingerprint = `${method.toUpperCase()} ${endpoint}\n${body ?? ''}`;
  const now = Date.now();
  const existing = pending.get(fingerprint);
  if (existing && now - existing.at <= KEEP_MS) return existing.key;
  prune(now);
  const key = newKey();
  pending.set(fingerprint, { key, at: now });
  return key;
}

/** آیا پاسخی با این وضعیت کلید را آزاد می‌کند (پاسخ قطعی برنامه) */
export function settlesSubmissionKey(status: number): boolean {
  return !UNSETTLED_STATUSES.has(status);
}

/** کلید را آزاد می‌کند تا ارسال بعدی همان محتوا ثبت تازه‌ای باشد */
export function releaseSubmissionKey(key: string): void {
  for (const [fingerprint, entry] of pending) {
    if (entry.key === key) pending.delete(fingerprint);
  }
}

/** پاسخ ۴۰۹ «درخواست تکراری در حال پردازش است»: همان کلید پس از مکث دوباره فرستاده می‌شود تا نتیجه درخواست اول برسد */
export function isInFlightResponse(status: number, code: unknown): boolean {
  return status === 409 && code === 'IDEMPOTENCY_IN_FLIGHT';
}

/** مکث پیش از ارسال دوباره درخواست در جریان، از سرآیند Retry-After (ثانیه)، میان ۰٫۵ تا ۵ ثانیه */
export function inFlightRetryDelayMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(5000, Math.max(500, seconds * 1000)) : 2000;
}

/** فقط برای آزمون‌ها */
export function resetSubmissionKeys(): void {
  pending.clear();
}
