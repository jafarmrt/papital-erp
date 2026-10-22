/**
 * v8.0.79 (TD-329): کلید تکرار درخواست (Idempotency-Key) مرورگر از محتوای ارسال ساخته می‌شود: همان روش، مسیر و بدنه
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

/** A file's fingerprint: its name, size, type and last change, never its content */
function fileFingerprint(file: Blob): string {
  const named = file as Blob & { name?: string; lastModified?: number };
  return `file:${named.name ?? ''}:${file.size}:${file.type}:${named.lastModified ?? ''}`;
}

/**
 * v10.2.33 (TD-1328): the text standing for a body, so a form sent with files (`FormData`), a single file or URL
 * parameters keeps one key until a definitive answer like a JSON form (before, each send took a new key and a resend
 * after a lost answer was recorded twice); null for a body that cannot be read without its content (`ArrayBuffer` …).
 */
function bodyFingerprint(body: unknown): string | null {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return `params:${body.toString()}`;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return fileFingerprint(body);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, name) => {
      parts.push(`${JSON.stringify(name)}=${typeof value === 'string' ? JSON.stringify(value) : fileFingerprint(value)}`);
    });
    return `form:${parts.join('&')}`;
  }
  return null;
}

/** کلید این ارسال: برای همان روش، مسیر و بدنه همان کلید باز؛ بدنه‌ای که بی محتوایش خوانده نمی‌شود کلید تازه می‌گیرد */
export function submissionKeyFor(method: string, endpoint: string, body: unknown): string {
  const text = bodyFingerprint(body);
  if (text === null) return newKey();
  const fingerprint = `${method.toUpperCase()} ${endpoint}\n${text}`;
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
