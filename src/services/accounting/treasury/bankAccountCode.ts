import { and, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, documentRefCounters } from '../../../db/schema.js';
import { AppError } from '../../../errors/customErrors.js';

/**
 * v8.0.78 (TD-325): کد حساب خزانه (BANK-01، CASH-01، POS-01) از شمارنده اتمی هر پیشوند در `document_ref_counters`
 * (ردیف `treasury:<پیشوند>`، سال ۰) ساخته می‌شود (AGENTS.md §1.6). پیش‌تر بیشینه + ۱ بی‌قفل بود: پنج حساب کارت‌خوان
 * هم‌زمان چهار بار POS-01 گرفتند. کد دستی هم زیر قفل همان شمارنده با کدهای حساب‌های فعال سنجیده می‌شود، پس دو ثبت
 * هم‌زمان یک کد هرگز هر دو پذیرفته نمی‌شوند.
 */

export type TreasuryAccountType = 'bank' | 'cash' | 'pos' | 'petty_cash';

const CODED = /^([A-Za-z]+)-(\d+)$/;
const COUNTER_YEAR = 0;

export function treasuryCodePrefix(type: TreasuryAccountType): string {
  return type === 'cash' || type === 'petty_cash' ? 'CASH' : type === 'pos' ? 'POS' : 'BANK';
}

function formatCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

function counterKey(prefix: string): string {
  return `treasury:${prefix.toUpperCase()}`.slice(0, 20);
}

/** بزرگ‌ترین شماره کد «پیشوند-عدد» در همه حساب‌ها (حذف‌شده هم، تا کد خودکار دوباره به کار نرود) */
async function maxCodedNumber(db: DbExecutor, prefix: string): Promise<number> {
  const rows = await db.select({ code: bankAccounts.code }).from(bankAccounts);
  let max = 0;
  for (const row of rows) {
    const match = String(row.code || '').trim().match(CODED);
    if (match && match[1].toUpperCase() === prefix.toUpperCase()) max = Math.max(max, Number(match[2]));
  }
  return max;
}

/** ردیف شمارنده پیشوند را FOR UPDATE قفل می‌کند (در اولین استفاده با بیشینه کدهای موجود ساخته می‌شود) و مقدارش را می‌دهد */
async function lockCounter(tx: DbExecutor, prefix: string): Promise<number> {
  const key = counterKey(prefix);
  const where = and(eq(documentRefCounters.docType, key), eq(documentRefCounters.fiscalYear, COUNTER_YEAR));
  let [row] = await tx.select({ last: documentRefCounters.lastRefNumber }).from(documentRefCounters).where(where).for('update');
  if (!row) {
    const seed = await maxCodedNumber(tx, prefix);
    await tx.insert(documentRefCounters).values({ docType: key, fiscalYear: COUNTER_YEAR, lastRefNumber: seed }).onConflictDoNothing();
    [row] = await tx.select({ last: documentRefCounters.lastRefNumber }).from(documentRefCounters).where(where).for('update');
  }
  return row?.last ?? 0;
}

async function setCounter(tx: DbExecutor, prefix: string, value: number): Promise<void> {
  await tx.update(documentRefCounters).set({ lastRefNumber: value })
    .where(and(eq(documentRefCounters.docType, counterKey(prefix)), eq(documentRefCounters.fiscalYear, COUNTER_YEAR)));
}

async function codeUsed(db: DbExecutor, code: string, options: { activeOnly: boolean; exceptId?: number }): Promise<boolean> {
  const conditions = [sql`lower(trim(${bankAccounts.code})) = ${code.trim().toLowerCase()}`];
  if (options.activeOnly) conditions.push(eq(bankAccounts.isDeleted, 0));
  if (options.exceptId) conditions.push(ne(bankAccounts.id, options.exceptId));
  const rows = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(...conditions)).limit(1);
  return rows.length > 0;
}

/**
 * کد حساب خزانه را در تراکنش فراخواننده می‌گیرد: بی کد درخواستی، شماره بعدی شمارنده پیشوند نوع حساب (کد به‌کاررفته‌ای که
 * دستی ثبت شده رد می‌شود)؛ با کد درخواستی، زیر قفل شمارنده پیشوند همان کد (یا «OTHER») یکتا بودن میان حساب‌های فعال
 * سنجیده و شمارنده به شماره آن کد جلو برده می‌شود.
 */
export async function assignTreasuryAccountCode(tx: DbExecutor, type: TreasuryAccountType, requested?: string, exceptId?: number): Promise<string> {
  const custom = requested?.trim();
  if (custom) {
    const match = custom.match(CODED);
    const prefix = match ? match[1].toUpperCase() : 'OTHER';
    const last = await lockCounter(tx, prefix);
    if (await codeUsed(tx, custom, { activeOnly: true, exceptId })) {
      throw new AppError(`کد حساب «${custom}» برای حساب خزانه دیگری ثبت شده است؛ کد دیگری انتخاب کنید.`, 409, 'TREASURY_ACCOUNT_CODE_TAKEN');
    }
    if (match && Number(match[2]) > last) await setCounter(tx, prefix, Number(match[2]));
    return custom;
  }
  const prefix = treasuryCodePrefix(type);
  let next = (await lockCounter(tx, prefix)) + 1;
  while (await codeUsed(tx, formatCode(prefix, next), { activeOnly: false })) next++;
  await setCounter(tx, prefix, next);
  return formatCode(prefix, next);
}

/** پیش‌نمایش کد بعدی برای فرم (بی قفل و بی مصرف شمارنده؛ کد نهایی هنگام ثبت گرفته می‌شود) */
export async function peekNextTreasuryAccountCode(type: TreasuryAccountType): Promise<string> {
  const prefix = treasuryCodePrefix(type);
  const [row] = await orm.select({ last: documentRefCounters.lastRefNumber }).from(documentRefCounters)
    .where(and(eq(documentRefCounters.docType, counterKey(prefix)), eq(documentRefCounters.fiscalYear, COUNTER_YEAR)));
  let next = (row ? row.last : await maxCodedNumber(orm, prefix)) + 1;
  while (await codeUsed(orm, formatCode(prefix, next), { activeOnly: false })) next++;
  return formatCode(prefix, next);
}
