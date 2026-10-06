import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { accounts, bankAccounts } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';

/** کل «موجودی نقد و بانک» در کدینگ استاندارد */
const CASH_AND_BANK_GENERAL_CODE = '10';
const MAX_ACCOUNT_DEPTH = 8;

/**
 * v9.0.91 (TD-510، B04-14): سرفصل حساب خزانه باید معین، فعال، حذف‌نشده و زیر کل ۱۰ «موجودی نقد و بانک» باشد؛ وگرنه
 * 422 `BANK_LEDGER_ACCOUNT_INVALID`. خالی (حساب بی سرفصل) پذیرفته است. پیش‌تر شناسه ناموجود (۹۹۹۹۹۹) ساخته می‌شد و هر
 * دریافت روی آن ۴۰۹ «ارجاع به رکورد ناموجود» می‌گرفت، و سرفصل ۱۲۰۱ (حساب‌های دریافتنی تجاری) هم پذیرفته می‌شد.
 */
export async function requireBankLedgerAccount(tx: DbExecutor, accountId: number | null | undefined): Promise<number | null> {
  if (accountId === null || accountId === undefined || Number(accountId) === 0) return null;
  const [acc] = await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name, level: accounts.level, isActive: accounts.isActive, parentId: accounts.parentId })
    .from(accounts).where(and(eq(accounts.id, Number(accountId)), eq(accounts.isDeleted, 0)));
  const refuse = (why: string): never => {
    throw new ValidationError(`سرفصل حساب خزانه ${why}؛ یک حساب معین فعال زیر «موجودی نقد و بانک» (کل ۱۰) انتخاب کنید.`, { accountId }, 'BANK_LEDGER_ACCOUNT_INVALID');
  };
  if (!acc) return refuse('یافت نشد');
  if (acc.level !== 'subsidiary') return refuse(`«${acc.code} ${acc.name}» معین نیست`);
  if ((acc.isActive ?? 1) !== 1) return refuse(`«${acc.code} ${acc.name}» غیرفعال است`);
  let parentId = acc.parentId;
  for (let depth = 0; parentId && depth < MAX_ACCOUNT_DEPTH; depth++) {
    const [parent] = await tx.select({ code: accounts.code, parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, parentId));
    if (!parent) break;
    if (parent.code === CASH_AND_BANK_GENERAL_CODE) return acc.id;
    parentId = parent.parentId;
  }
  return refuse(`«${acc.code} ${acc.name}» زیر «موجودی نقد و بانک» نیست`);
}

/**
 * v9.0.91 (TD-510، B04-14): حساب بانکی چک باید حساب خزانه فعال و حذف‌نشده باشد (قفل اشتراکی، تا حذف هم‌زمان حساب منتظر
 * بماند)؛ وگرنه 422 `CHEQUE_BANK_ACCOUNT_INVALID`. پیش‌تر چک با `bankAccountId 999999` ۲۰۱ می‌گرفت.
 */
export async function requireChequeBankAccount(tx: DbExecutor, bankAccountId: number | null | undefined): Promise<number | null> {
  if (bankAccountId === null || bankAccountId === undefined || Number(bankAccountId) === 0) return null;
  const [bank] = await tx.select({ id: bankAccounts.id, isActive: bankAccounts.isActive }).from(bankAccounts)
    .where(and(eq(bankAccounts.id, Number(bankAccountId)), eq(bankAccounts.isDeleted, 0))).for('share');
  if (!bank || (bank.isActive ?? 1) !== 1) {
    throw new ValidationError('حساب بانکی چک یافت نشد یا غیرفعال است؛ یک حساب بانکی فعال انتخاب کنید.', { bankAccountId }, 'CHEQUE_BANK_ACCOUNT_INVALID');
  }
  return bank.id;
}
