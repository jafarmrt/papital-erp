import { FinancialDecimal } from '../financialDecimal.js';
import { toEnglishDigits } from '../../utils/persianNumber.js';

/**
 * پاک‌کننده تصویر سجل (v9.0.213، TD-530، یافته B02-15، تصمیم ت۷ الف). کلید رمز و توکن با «شامل‌بودن» و بی‌توجه به نگارش
 * شناخته می‌شود (`nobitexPassword`، `consumer_secret`، `csrfToken`، `x-api-key`، `Set-Cookie`…) و مقدار متنی آن
 * `[PROTECTED]` می‌شود؛ پرچم بولی یا عددی (`nobitexPasswordChanged: true`، `tokenVersion`) راز نیست و می‌ماند. شماره کارت،
 * حساب و شبا تا ۴ رقم آخر پوشیده می‌شود («****5678»)، پس تغییر شبا در سجل دیده می‌شود ولی شماره کامل نه.
 */

const SECRET_KEY_PARTS = ['password', 'passwd', 'secret', 'token', 'apikey', 'cookie', 'jwt', 'authorization', 'privatekey'];
const SECRET_KEYS = new Set(['pass', 'pwd', 'cvv', 'cvv2', 'ssn']);
const BANK_NUMBER_KEY_PARTS = ['cardnumber', 'cardno', 'creditcard', 'bankcard', 'sheba', 'shaba', 'iban', 'accountnumber', 'accountno'];
const BANK_NUMBER_KEYS = new Set(['card', 'cards']);

const normalizedKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

export function isSecretAuditKey(key: string): boolean {
  const k = normalizedKey(key);
  return SECRET_KEYS.has(k) || SECRET_KEY_PARTS.some(part => k.includes(part));
}

export function isBankNumberAuditKey(key: string): boolean {
  const k = normalizedKey(key);
  return BANK_NUMBER_KEYS.has(k) || BANK_NUMBER_KEY_PARTS.some(part => k.includes(part));
}

/**
 * «****» و چهار رقم آخر؛ متنی بی رقم (نام بانک، خالی) و مقدار پوشیده‌شده («****5678»، چون جزئیات سجل پس از تفاوت فیلد به
 * فیلد دوباره پاک می‌شود) همان می‌ماند
 */
export function maskBankNumber(value: string | number): string {
  const text = String(value);
  if (/^\*+\d{0,4}$/.test(text)) return text;
  const digits = toEnglishDigits(text).replace(/\D/g, '');
  if (digits.length === 0) return text;
  return digits.length <= 4 ? '****' : `****${digits.slice(-4)}`;
}

function maskBankNumbersDeep(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string' || typeof value === 'number') return maskBankNumber(value);
  if (Array.isArray(value)) return value.map(item => maskBankNumbersDeep(item, depth + 1, seen));
  return sanitizeSensitiveData(value, depth + 1, seen);
}

/** مقدار یک کلید در تصویر سجل، با همان قاعده‌ای که کلید را در شیء می‌پوشاند (برای تفاوت فیلد به فیلد هم) */
export function sanitizeAuditValue(key: string, value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (isSecretAuditKey(key)) {
    return typeof value === 'string' || (typeof value === 'object' && value !== null) ? '[PROTECTED]' : value;
  }
  if (isBankNumberAuditKey(key)) return maskBankNumbersDeep(value, depth, seen);
  return sanitizeSensitiveData(value, depth + 1, seen);
}

/**
 * Recursively sanitizes credentials (passwords, tokens, secrets) and bank numbers (card, account, Sheba) in audit details.
 */
export function sanitizeSensitiveData<T = unknown>(obj: T, depth = 0, seen = new WeakSet<object>()): T {
  if (obj === null || obj === undefined) return obj;
  if (depth > 6) return '[MAX_DEPTH_REACHED]' as unknown as T;

  if (typeof obj === 'string') {
    // If string contains JWT-like token (eyJh...) mask it
    if (/^Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/i.test(obj.trim())) {
      return 'Bearer [PROTECTED_JWT]' as unknown as T;
    }
    if (/^eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/i.test(obj.trim())) {
      return '[PROTECTED_JWT]' as unknown as T;
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // v7.0.67 (P2-6): مبلغ Decimal/Money در اسنپ‌شات ممیزی عدد است (نه ساختار داخلی Decimal)
  if (obj instanceof FinancialDecimal) {
    return obj.toNumber() as unknown as T;
  }

  // Prevent circular references
  if (seen.has(obj as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeSensitiveData(item, depth + 1, seen)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    sanitized[key] = sanitizeAuditValue(key, value, depth, seen);
  }

  return sanitized as T;
}
