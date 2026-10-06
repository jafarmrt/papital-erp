import { can } from '../middleware/authorize.js';

/**
 * Mask payment card number to protect PII.
 * Example: '6037991234567890' -> '6037-****-****-7890'
 */
export function maskCardNumber(cardNumber?: string | null): string {
  if (!cardNumber || typeof cardNumber !== 'string') return '';
  const clean = cardNumber.replace(/[\s\-]/g, '').trim();
  if (!clean) return '';
  if (clean.length < 8) return '****';

  const prefix = clean.substring(0, 4);
  const suffix = clean.substring(clean.length - 4);
  const middleLength = clean.length - 8;
  const maskedMiddle = '*'.repeat(Math.max(middleLength, 4));

  if (clean.length === 16) {
    return `${prefix}-****-****-${suffix}`;
  }
  return `${prefix}${maskedMiddle}${suffix}`;
}

/**
 * Mask Iranian Sheba (IBAN) number to protect PII.
 * Example: 'IR120120000000001234567890' -> 'IR12******************7890'
 */
export function maskShebaNumber(shebaNumber?: string | null): string {
  if (!shebaNumber || typeof shebaNumber !== 'string') return '';
  const clean = shebaNumber.replace(/[\s\-]/g, '').trim();
  if (!clean) return '';
  if (clean.length < 8) return 'IR****';

  const prefix = clean.substring(0, 4);
  const suffix = clean.substring(clean.length - 4);
  const maskCount = Math.max(clean.length - 8, 4);
  return `${prefix}${'*'.repeat(maskCount)}${suffix}`;
}

/**
 * Mask bank account number.
 * Example: '0123456789' -> '******6789'
 */
export function maskAccountNumber(accountNumber?: string | null): string {
  if (!accountNumber || typeof accountNumber !== 'string') return '';
  const clean = accountNumber.trim();
  if (!clean) return '';
  if (clean.length <= 4) return '****';
  const suffix = clean.substring(clean.length - 4);
  return `${'*'.repeat(clean.length - 4)}${suffix}`;
}

/**
 * Mask crypto/exchange username.
 * Example: 'nobitex_user' -> 'no****er'
 */
export function maskNobitexUsername(username?: string | null): string {
  if (!username || typeof username !== 'string') return '';
  const clean = username.trim();
  if (!clean) return '';
  if (clean.length <= 3) return '***';
  const prefix = clean.substring(0, 2);
  const suffix = clean.substring(clean.length - 1);
  return `${prefix}***${suffix}`;
}

/**
 * v9.0.109 (TD-882، مدل مجوز §۴.۲ و §۴.۴): اطلاعات بانکی بی پوشش فقط با مجوز، از راه `can` (مدیر سیستم همیشه). پیش‌تر
 * کد نقش `manager` و «*» هم همه را باز می‌کردند و دو کلید این‌جا بیرون از کاتالوگ بودند، پس هیچ نقشی نمی‌توانست آن‌ها
 * را بگیرد. پرونده پرسنل و فیش حقوق هر کدام کلید خود را دارند؛ «مدیریت کامل پرسنل» هر دو را باز می‌کند.
 */
export const SENSITIVE_PERSONNEL_PERMISSIONS = ['personnel.view_sensitive', 'personnel.manage'] as const;
export const SENSITIVE_PAYROLL_PERMISSIONS = ['payroll.view_sensitive', 'personnel.manage'] as const;

type SensitiveReader = { id?: number; role?: string } | undefined;

async function canSeeUnmasked(user: SensitiveReader, recordOwnerUserId: number | null | undefined, keys: readonly string[]): Promise<boolean> {
  if (!user || !user.role) return false;
  // صاحب پرونده یا فیش، داده خودش را می‌بیند
  if (recordOwnerUserId && user.id && Number(user.id) === Number(recordOwnerUserId)) return true;
  try {
    return await can(user, ...keys);
  } catch {
    // خطای خواندن نقش: پوشش می‌ماند
    return false;
  }
}

/** شماره کارت، شبا، حساب و نام کاربری نوبیتکس پرونده پرسنل بی پوشش */
export function canAccessSensitivePersonnelData(user: SensitiveReader, recordOwnerUserId?: number | null): Promise<boolean> {
  return canSeeUnmasked(user, recordOwnerUserId, SENSITIVE_PERSONNEL_PERMISSIONS);
}

/** شماره کارت، شبا و نام کاربری نوبیتکس فیش حقوق بی پوشش */
export function canAccessSensitivePayrollData(user: SensitiveReader, recordOwnerUserId?: number | null): Promise<boolean> {
  return canSeeUnmasked(user, recordOwnerUserId, SENSITIVE_PAYROLL_PERMISSIONS);
}

/**
 * Sanitize personnel record by masking sensitive financial & PII fields when unauthorized.
 */
export function sanitizePersonnelRecord<T extends Record<string, any>>(record: T, canViewSensitive: boolean): T {
  if (canViewSensitive) {
    return record;
  }

  return {
    ...record,
    cardNumber: record.cardNumber ? maskCardNumber(record.cardNumber) : record.cardNumber,
    accountNumber: record.accountNumber ? maskAccountNumber(record.accountNumber) : record.accountNumber,
    shebaNumber: record.shebaNumber ? maskShebaNumber(record.shebaNumber) : record.shebaNumber,
    nobitexUsername: record.nobitexUsername ? maskNobitexUsername(record.nobitexUsername) : record.nobitexUsername,
    nobitexPassword: '' // Always strip sensitive credentials for unauthorized users
  };
}

/**
 * Sanitize payroll / payslip record by masking sensitive financial fields when unauthorized.
 */
export function sanitizePayrollRecord<T extends Record<string, any>>(record: T, canViewSensitive: boolean): T {
  if (canViewSensitive) {
    return record;
  }

  return {
    ...record,
    cardNumber: record.cardNumber ? maskCardNumber(record.cardNumber) : record.cardNumber,
    shebaNumber: record.shebaNumber ? maskShebaNumber(record.shebaNumber) : record.shebaNumber,
    nobitexUsername: record.nobitexUsername ? maskNobitexUsername(record.nobitexUsername) : record.nobitexUsername
  };
}
