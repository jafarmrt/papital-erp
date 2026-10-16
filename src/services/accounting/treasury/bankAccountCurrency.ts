import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { cheques, treasuryTransactions } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue } from '../../../lib/financialDecimal.js';
import { TREASURY_CURRENCIES, isTreasuryCurrency, normalizeTreasuryCurrency, type TreasuryCurrency } from '../../../lib/treasury/treasuryCurrency.js';
import { formatCurrencyLabel } from '../../../utils/formatters.js';
import { pettyCashCurrencyRefusal } from '../../../lib/treasury/pettyCash.js';

const CURRENCY_LIST_TEXT = TREASURY_CURRENCIES.map(formatCurrencyLabel).join('، ');

/** ارز حساب خزانه: خالی ← ریال؛ ارز بیرون از فهرست ← 422 `BANK_ACCOUNT_CURRENCY_INVALID` */
export function requireTreasuryCurrency(value: unknown): TreasuryCurrency {
  const code = normalizeTreasuryCurrency(value ?? '');
  if (!isTreasuryCurrency(code)) {
    throw new ValidationError(`ارز «${String(value)}» برای حساب خزانه پشتیبانی نمی‌شود؛ یکی از ${CURRENCY_LIST_TEXT} را انتخاب کنید.`, { value }, 'BANK_ACCOUNT_CURRENCY_INVALID');
  }
  return code;
}

/** v10.1.32 (D-16): تنخواه‌گردان فقط ریالی است (422 `PETTY_CASH_RIAL_ONLY`) */
export function assertPettyCashCurrency(type: unknown, currency: unknown): void {
  const refusal = pettyCashCurrencyRefusal(type, currency ?? 'IRR');
  if (refusal) throw new ValidationError(refusal, { currency }, 'PETTY_CASH_RIAL_ONLY');
}

/**
 * v9.0.99 (TD-508، B04-12، تصمیم مالک محصول ت۵ الف): ارز حساب خزانه پس از نخستین گردش ثابت است — تراکنش خزانه (حتی
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
  const reasons = await bankMovementReasons(tx, bank);
  if (reasons.length > 0) {
    throw new ValidationError(
      `ارز این حساب (${formatCurrencyLabel(current)}) پس از نخستین گردش ثابت است و به ${formatCurrencyLabel(nextCurrency)} تغییر نمی‌کند؛ حساب ${reasons.join('، ')} دارد. برای ارز دیگر حساب تازه بسازید.`,
      { current, requested: nextCurrency },
      'BANK_ACCOUNT_CURRENCY_LOCKED',
    );
  }
}

/** گردش‌هایی که حساب خزانه را پس از خود ثابت می‌کنند: تراکنش خزانه (حتی باطل‌شده)، چک ثبت‌شده و مانده اول دوره */
async function bankMovementReasons(tx: DbExecutor, bank: { id: number; initialBalance: DecimalValue }): Promise<string[]> {
  const reasons: string[] = [];
  const [txCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(treasuryTransactions)
    .where(eq(treasuryTransactions.bankAccountId, bank.id));
  if (Number(txCount?.n) > 0) reasons.push(`${Number(txCount.n)} تراکنش خزانه`);
  const [chequeCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(cheques)
    .where(and(eq(cheques.bankAccountId, bank.id), eq(cheques.isDeleted, 0)));
  if (Number(chequeCount?.n) > 0) reasons.push(`${Number(chequeCount.n)} چک`);
  if (!fin(bank.initialBalance).isZero()) reasons.push('مانده اول دوره');
  return reasons;
}

/**
 * v10.0.254 (TD-969، OBS-R1-58، تصمیم مالک محصول ۱۷ مهر): سرفصل معین حساب خزانه پس از نخستین گردش ثابت است، مانند ارز
 * آن. پیش‌تر تغییر سرفصل حسابی که تراکنش داشت پذیرفته می‌شد و مانده دفتر روی سرفصل پیشین می‌ماند، پس تراز و تطبیق بانک
 * از هم جدا می‌شدند. حسابی که هنوز سرفصل ندارد سرفصل می‌گیرد. زیر قفل ردیف بانک صدا زده می‌شود.
 */
export async function assertBankLedgerChangeAllowed(
  tx: DbExecutor,
  bank: { id: number; accountId: number | null; initialBalance: DecimalValue },
  nextAccountId: number | null,
): Promise<void> {
  if (!bank.accountId || bank.accountId === nextAccountId) return;
  const reasons = await bankMovementReasons(tx, bank);
  if (reasons.length > 0) {
    throw new ValidationError(
      `سرفصل معین این حساب پس از نخستین گردش ثابت است؛ حساب ${reasons.join('، ')} دارد و مانده دفتر آن روی سرفصل کنونی است. برای سرفصل دیگر حساب تازه بسازید.`,
      { current: bank.accountId, requested: nextAccountId },
      'BANK_ACCOUNT_LEDGER_LOCKED',
    );
  }
}
