import { fin } from '../financialDecimal';
import { currencyScale } from '../currencyScale';
/**
 * v9.0.345 (TD-802، یافته B08-33): حساب تسویه فاکتور به ارز همان فاکتور. سرور تراکنش خزانه‌ای را که ارزش با ارز حساب
 * فرق کند رد می‌کند (`createTreasuryTransaction`)، پس فرم تسویه فقط حساب‌های هم‌ارز را نشان می‌دهد و از میان آن‌ها
 * نخست بانک یا کارت‌خوان را از پیش برمی‌گزیند؛ پیش‌تر نخستین حساب بی توجه به ارز انتخاب می‌شد. حساب بی ارز ریالی است
 * (همان قاعده `/accounting/bank-accounts/options`).
 */
export interface SettlementAccountChoice {
  id: number;
  type?: string;
  currency?: string | null;
}

export const accountCurrencyOf = (account: SettlementAccountChoice): string => account.currency || 'IRR';

export function settlementAccountsFor<T extends SettlementAccountChoice>(accounts: readonly T[], currency: string): T[] {
  return accounts.filter(account => accountCurrencyOf(account) === currency);
}

export function defaultSettlementAccountId(accounts: readonly SettlementAccountChoice[], currency: string): number | '' {
  const usable = settlementAccountsFor(accounts, currency);
  const preferred = usable.find(account => account.type === 'pos' || account.type === 'bank') ?? usable[0];
  return preferred ? preferred.id : '';
}

/**
 * v10.0.27 (OBS-R1-100): «نصف مانده» با مقیاس ارز سند گرد می‌شود (ریال بی‌اعشار، ارز خارجی دو رقم)؛ پیش‌تر
 * `Math.round` سنت‌های ارز خارجی را می‌انداخت (۱۰٫۰۵ دلار → ۵).
 */
export function halfRemainingAmount(remaining: number, currency: string | null | undefined): string {
  return fin(remaining).divide(2, currencyScale(currency)).toString();
}
