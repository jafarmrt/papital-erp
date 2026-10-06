import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { cheques, treasuryTransactions } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { TREASURY_CURRENCIES, isTreasuryCurrency, normalizeTreasuryCurrency, type TreasuryCurrency } from '../../../lib/treasury/treasuryCurrency.js';
import { formatCurrencyLabel } from '../../../utils/formatters.js';

const CURRENCY_LIST_TEXT = TREASURY_CURRENCIES.map(formatCurrencyLabel).join('، ');

/** ارز حساب خزانه: خالی ← ریال؛ ارز بیرون از فهرست ← 422 `BANK_ACCOUNT_CURRENCY_INVALID` */
export function requireTreasuryCurrency(value: unknown): TreasuryCurrency {
  const code = normalizeTreasuryCurrency(value ?? '');
  if (!isTreasuryCurrency(code)) {
    throw new ValidationError(`ارز «${String(value)}» برای حساب خزانه پشتیبانی نمی‌شود؛ یکی از ${CURRENCY_LIST_TEXT} را انتخاب کنید.`, { value }, 'BANK_ACCOUNT_CURRENCY_INVALID');
  }
  return code;
}

/**
 * v9.0.90 (TD-508، B04-12، تصمیم مالک محصول ت۵ الف): ارز حساب خزانه پس از نخستین گردش ثابت است — تراکنش خزانه (حتی
 * باطل‌شده)، چک ثبت‌شده روی حساب، یا مانده اول دوره (سند افتتاحیه به همان ارز صادر شده است). تغییر ارز چنین حسابی 422
 * `BANK_ACCOUNT_CURRENCY_LOCKED` می‌گیرد؛ پیش‌تر ویرایش ارز ۲۰۰ می‌گرفت و بی‌صدا نادیده گرفته می‌شد. زیر قفل ردیف بانک
 * صدا زده می‌شود، همان قفلی که ثبت تراکنش خزانه می‌گیرد.
 */
export async function assertBankCurrencyChangeAllowed(
  tx: DbExecutor,
  bank: { id: number; currency: string | null; initialBalance: DecimalValue },
  nextCurrency: TreasuryCurrency,
): Promise<void> {
  const current = (bank.currency || 'IRR').toUpperCase();
  if (current === nextCurrency) return;
  const reasons: string[] = [];
  const [txCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(treasuryTransactions)
    .where(eq(treasuryTransactions.bankAccountId, bank.id));
  if (Number(txCount?.n) > 0) reasons.push(`${Number(txCount.n)} تراکنش خزانه`);
  const [chequeCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(cheques)
    .where(and(eq(cheques.bankAccountId, bank.id), eq(cheques.isDeleted, 0)));
  if (Number(chequeCount?.n) > 0) reasons.push(`${Number(chequeCount.n)} چک`);
  if (!fin(bank.initialBalance).isZero()) reasons.push('مانده اول دوره');
  if (reasons.length > 0) {
    throw new ValidationError(
      `ارز این حساب (${formatCurrencyLabel(current)}) پس از نخستین گردش ثابت است و به ${formatCurrencyLabel(nextCurrency)} تغییر نمی‌کند؛ حساب ${reasons.join('، ')} دارد. برای ارز دیگر حساب تازه بسازید.`,
      { current, requested: nextCurrency },
      'BANK_ACCOUNT_CURRENCY_LOCKED',
    );
  }
}
