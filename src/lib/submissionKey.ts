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

/**
 * 10.3 (ARCH review finding 1): the keys still waiting for a definitive answer also live in the tab's `sessionStorage`
 * until the tab closes, so a resend after the page is reloaded (the answer was lost and the user refreshed) carries the
 * same key and gets the first answer or the «already registered» notice instead of recording twice. Before, they lived in
 * the page's memory only. Each is stored under a hash of the method, path and body (`fingerprintHash`) with its time, never
 * the body itself (amounts, names); without storage (private mode, full quota) the keys live in memory as before.
 */
export const SUBMISSION_KEYS_STORAGE_KEY = 'papital.pendingSubmissionKeys';

interface PendingKey { key: string; at: number }

let pending: Map<string, PendingKey> | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The keys of this tab: read from its storage on first use */
function pendingKeys(): Map<string, PendingKey> {
  if (pending) return pending;
  pending = new Map();
  try {
    const stored: unknown = JSON.parse(storage()?.getItem(SUBMISSION_KEYS_STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) {
      for (const entry of stored as Array<{ h?: unknown; key?: unknown; at?: unknown }>) {
        if (typeof entry?.h === 'string' && typeof entry.key === 'string' && typeof entry.at === 'number') {
          pending.set(entry.h, { key: entry.key, at: entry.at });
        }
      }
    }
  } catch {
    // damaged or unreadable: start empty
  }
  return pending;
}

function persist(): void {
  try {
    const keys = pendingKeys();
    const target = storage();
    if (!target) return;
    if (keys.size === 0) target.removeItem(SUBMISSION_KEYS_STORAGE_KEY);
    else target.setItem(SUBMISSION_KEYS_STORAGE_KEY, JSON.stringify([...keys].map(([h, { key, at }]) => ({ h, key, at }))));
  } catch {
    // quota or storage off: the keys stay in memory
  }
}

/** 53 bits of a string (cyrb53) */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The stored stand-in of a submission's method, path and body: two 53-bit hashes, so two submissions do not share a key */
function fingerprintHash(fingerprint: string): string {
  return `${hash53(fingerprint, 0)}.${hash53(fingerprint, 0x9e3779b9)}`;
}

function newKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fe_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function prune(keys: Map<string, PendingKey>, now: number): void {
  for (const [fingerprint, entry] of keys) {
    if (now - entry.at > KEEP_MS) keys.delete(fingerprint);
  }
  while (keys.size >= MAX_ENTRIES) {
    const oldest = keys.keys().next().value;
    if (oldest === undefined) break;
    keys.delete(oldest);
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
  const fingerprint = fingerprintHash(`${method.toUpperCase()} ${endpoint}\n${text}`);
  const keys = pendingKeys();
  const now = Date.now();
  const existing = keys.get(fingerprint);
  if (existing && now - existing.at <= KEEP_MS) return existing.key;
  prune(keys, now);
  const key = newKey();
  keys.set(fingerprint, { key, at: now });
  persist();
  return key;
}

/** آیا پاسخی با این وضعیت کلید را آزاد می‌کند (پاسخ قطعی برنامه) */
export function settlesSubmissionKey(status: number): boolean {
  return !UNSETTLED_STATUSES.has(status);
}

/** کلید را آزاد می‌کند تا ارسال بعدی همان محتوا ثبت تازه‌ای باشد */
export function releaseSubmissionKey(key: string): void {
  const keys = pendingKeys();
  let released = false;
  for (const [fingerprint, entry] of keys) {
    if (entry.key === key) released = keys.delete(fingerprint);
  }
  if (released) persist();
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

/** فقط برای آزمون‌ها؛ `forgetMemoryOnly` یک بارگذاری دوبارهٔ صفحه را شبیه‌سازی می‌کند (حافظه پاک، sessionStorage می‌ماند) */
export function resetSubmissionKeys(forgetMemoryOnly = false): void {
  pending = null;
  if (forgetMemoryOnly) return;
  try {
    storage()?.removeItem(SUBMISSION_KEYS_STORAGE_KEY);
  } catch {
    // storage off
  }
}
