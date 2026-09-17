import { orm } from '../db/drizzle.js';
import { roles } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rolePermissionsCache } from './memoryCache.js';

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
 * Check if the given authenticated user has permissions to view sensitive financial/PII data.
 * Permissions granting access:
 * - Admin role (`role === 'admin'`)
 * - Explicit permissions: `*`, `payroll.view_sensitive`, `personnel.manage`, `personnel.view_sensitive`
 * - Record owner (if `recordOwnerUserId` matches `user.id`)
 */
export async function canAccessSensitivePersonnelData(
  user: { id?: number; role?: string } | undefined,
  recordOwnerUserId?: number | null
): Promise<boolean> {
  if (!user || !user.role) return false;

  // 1. Super admin always has access
  if (user.role === 'admin') return true;

  // 2. Record owner accessing their own profile/payslip
  if (recordOwnerUserId && user.id && Number(user.id) === Number(recordOwnerUserId)) {
    return true;
  }

  // 3. Check role permissions cache
  try {
    const roleData = await rolePermissionsCache.getOrSet(user.role, async () => {
      const [roleRecord] = await orm.select().from(roles).where(eq(roles.code, user.role!));
      if (!roleRecord) return null;
      return {
        permissions: Array.isArray(roleRecord.permissions) ? (roleRecord.permissions as string[]) : [],
        isSystem: roleRecord.isSystem ?? 0
      };
    }, 60_000);

    if (roleData) {
      const perms = roleData.permissions;
      if (
        perms.includes('*') ||
        perms.includes('payroll.view_sensitive') ||
        perms.includes('personnel.manage') ||
        perms.includes('personnel.view_sensitive') ||
        user.role === 'manager'
      ) {
        return true;
      }
    }
  } catch (err) {
    // If DB check fails, default to safe false
    return false;
  }

  return false;
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
