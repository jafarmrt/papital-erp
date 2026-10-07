import { and, eq, ne, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { ACCOUNT_CODE_FORMAT_MESSAGE, isValidAccountCode, normalizeAccountCode } from '../../lib/accounting/accountCode.js';

/**
 * v9.0.201 (TD-558، B03-16): کد سرفصل در سرور. رقم فارسی لاتین می‌شود و جز رقم پذیرفته نمی‌شود (۴۲۲)؛ کد تکراری،
 * حتی با رقم فارسی در ردیف قدیمی، ۴۰۹ `ACCOUNT_CODE_TAKEN` است. پیش‌تر «۷۰۹۶» و «7096» دو حساب جدا شدند و کد تکراری
 * همزمان ۵۰۰ می‌داد.
 */
export const ACCOUNT_CODE_UNIQUE_INDEX = 'uq_accounts_code_active';

/** کد ستون با رقم لاتین (ردیف‌های قدیمی رقم فارسی یا عربی دارند) */
export function accountCodeKeySql(column: SQLWrapper = accounts.code): SQL {
  return sql`btrim(translate(${column}, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'))`;
}

export function requireAccountCode(raw: unknown): string {
  const code = normalizeAccountCode(raw);
  if (!isValidAccountCode(code)) {
    throw new ValidationError(ACCOUNT_CODE_FORMAT_MESSAGE, { code: raw }, 'ACCOUNT_CODE_INVALID');
  }
  return code;
}

function accountCodeTaken(code: string, name?: string): ConflictError {
  return new ConflictError(
    name
      ? `کد ${toPersianDigits(code)} را حساب «${name}» دارد؛ کد دیگری انتخاب کنید.`
      : `کد ${toPersianDigits(code)} را حساب دیگری دارد؛ کد دیگری انتخاب کنید.`,
    { code },
    'ACCOUNT_CODE_TAKEN',
  );
}

export async function assertAccountCodeAvailable(db: DbExecutor, code: string, excludeId?: number): Promise<void> {
  const conditions = [sql`${accountCodeKeySql()} = ${code}::text`, eq(accounts.isDeleted, 0)];
  if (excludeId !== undefined) conditions.push(ne(accounts.id, excludeId));
  const [other] = await db.select({ name: accounts.name }).from(accounts).where(and(...conditions)).limit(1);
  if (other) throw accountCodeTaken(code, other.name);
}

/** خطای 23505 روی uq_accounts_code_active (Drizzle خطای pg را در `cause` می‌پیچد) */
export function isAccountCodeUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === ACCOUNT_CODE_UNIQUE_INDEX) return true;
  }
  return false;
}

/** پنجره رقابتی میان بررسی و نوشتن: نقض ایندکس همان ۴۰۹ کد تکراری می‌شود */
export async function guardAccountCode<T>(code: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    throw isAccountCodeUniqueViolation(err) ? accountCodeTaken(code) : err;
  }
}
