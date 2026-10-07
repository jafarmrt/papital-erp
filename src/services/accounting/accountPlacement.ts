import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { accountLevelLabel, parentLevelOf } from '../../lib/accounting/accountLevels.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.200 (TD-553، B03-11): جای حساب در درخت سرفصل. بالادست باید حساب حذف‌نشده، خود حساب یا زیرشاخه آن نباشد (درخت
 * بی حلقه) و دقیقاً یک سطح بالاتر باشد؛ با تغییر سطح، زیرحساب‌ها باید همچنان یک سطح پایین‌تر بمانند. پیش‌تر والد ۷۰۹۳ به
 * زیرحساب خودش ۷۰۹۳۰۱ عوض شد و درخت حساب‌ها با خطای ۵۰۰ «Converting circular structure to JSON» از کار افتاد.
 * حساب بی بالادست مانند پیش پذیرفته است (بستن سال ۴۲۰۱ و ۴۳۰۱ را اگر نباشند بی بالادست می‌سازد).
 */
export async function assertAccountPlacement(tx: DbExecutor, account: { id?: number; level: string; parentId: number | null }): Promise<void> {
  const invalid = (message: string, code = 'ACCOUNT_PARENT_INVALID') => new ValidationError(message, { level: account.level, parentId: account.parentId }, code);
  if (account.parentId) {
    const [parent] = await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name, level: accounts.level, parentId: accounts.parentId, isDeleted: accounts.isDeleted })
      .from(accounts).where(eq(accounts.id, account.parentId)).for('share');
    if (!parent || parent.isDeleted === 1) throw invalid('حساب بالادست یافت نشد یا حذف شده است.');
    if (account.id && parent.id === account.id) throw invalid('حساب نمی‌تواند بالادست خودش باشد.');
    const expected = parentLevelOf(account.level);
    if (!expected) throw invalid('حساب گروه بالادست ندارد.');
    if (parent.level !== expected) {
      throw invalid(`بالادست حساب ${accountLevelLabel(account.level)} باید حساب ${accountLevelLabel(expected)} باشد؛ «${parent.name}» (کد ${toPersianDigits(parent.code)}) حساب ${accountLevelLabel(parent.level)} است.`);
    }
    if (account.id) {
      // بالا رفتن از بالادست تازه؛ رسیدن به خود حساب یعنی حلقه
      const seen = new Set<number>([parent.id]);
      let next = parent.parentId;
      while (next) {
        if (next === account.id) throw invalid(`«${parent.name}» زیرشاخه همین حساب است؛ با این بالادست درخت حساب‌ها حلقه می‌شود.`);
        if (seen.has(next)) break;
        seen.add(next);
        const [row] = await tx.select({ parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, next));
        next = row?.parentId ?? null;
      }
    }
  }
  if (account.id) {
    const children = await tx.select({ code: accounts.code, level: accounts.level }).from(accounts)
      .where(and(eq(accounts.parentId, account.id), eq(accounts.isDeleted, 0)));
    const misplaced = children.filter(c => parentLevelOf(c.level) !== account.level);
    if (misplaced.length > 0) {
      throw invalid(
        `زیرحساب‌های ${misplaced.map(c => toPersianDigits(c.code)).join('، ')} با سطح ${accountLevelLabel(account.level)} جور نیستند؛ سطح حسابی که زیرحساب دارد عوض نمی‌شود.`,
        'ACCOUNT_LEVEL_INVALID',
      );
    }
  }
}

