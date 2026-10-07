import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { postingRefusal, postingRefusalText, type PostingRefusal } from '../../lib/accounting/postingAccount.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

export interface PostingRefusalEntry {
  accountId: number;
  code: string;
  name: string;
  reason: PostingRefusal;
}

/**
 * v9.0.198 (TD-549، B03-07): ردیف سند دستی و سند اصلاحی فقط روی حساب قابل ثبت (`postingAccount.ts`)، وگرنه ۴۲۲
 * `VOUCHER_ACCOUNT_NOT_POSTABLE` با نام همه حساب‌های ناپذیرفته. حساب‌ها `FOR SHARE` خوانده می‌شوند تا ویرایش یا حذف
 * هم‌زمان حساب (که آن را `FOR UPDATE` قفل می‌کند) پس از این سند بنشیند.
 */
export async function assertPostingAccounts(tx: DbExecutor, accountIds: readonly unknown[]): Promise<void> {
  const ids = [...new Set(accountIds.map(Number))].filter(id => Number.isInteger(id) && id > 0);
  const refusals: PostingRefusalEntry[] = [];
  if (accountIds.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
    refusals.push({ accountId: 0, code: '', name: '', reason: 'missing' });
  }
  if (ids.length > 0) {
    const rows = await tx.select({
      id: accounts.id, code: accounts.code, name: accounts.name, level: accounts.level, isActive: accounts.isActive, isDeleted: accounts.isDeleted,
    }).from(accounts).where(inArray(accounts.id, ids)).orderBy(asc(accounts.id)).for('share');
    const withChildren = new Set((await tx.select({ parentId: accounts.parentId }).from(accounts)
      .where(and(inArray(accounts.parentId, ids), eq(accounts.isDeleted, 0), eq(accounts.isActive, 1)))
      .groupBy(accounts.parentId)).map(r => Number(r.parentId)));
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const id of ids) {
      const row = byId.get(id);
      const reason = postingRefusal(row, withChildren.has(id));
      if (reason) refusals.push({ accountId: id, code: row?.code ?? '', name: row?.name ?? '', reason });
    }
  }
  if (refusals.length === 0) return;
  const lines = refusals.map(r => (r.code
    ? `حساب «${r.name}» (کد ${toPersianDigits(r.code)}) ${postingRefusalText(r.reason)}`
    : `حساب ${r.accountId ? `شناسه ${toPersianDigits(String(r.accountId))}` : 'ردیف'} ${postingRefusalText(r.reason)}`));
  throw new ValidationError(`ردیف سند روی این حساب‌ها ثبت نمی‌شود: ${lines.join('؛ ')}.`, { accounts: refusals }, 'VOUCHER_ACCOUNT_NOT_POSTABLE');
}

/** v9.0.198 (TD-549): شرط SQL «حساب زیرحساب فعال دارد»، برای بررسی سلامت */
export const accountHasActiveChildSql = (accountIdColumn: unknown) =>
  sql`EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = ${accountIdColumn} AND c.is_deleted = 0 AND c.is_active = 1)`;
