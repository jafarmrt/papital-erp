import { fin, type FinancialDecimal } from '../financialDecimal';
import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput';

/**
 * v10.1.32 (D-16، تصمیم مالک محصول ت۳۰ «متغیر»): تنخواه‌گردان متغیر، مشترک سرور و فرم‌های خزانه.
 *
 * تنخواه حساب خزانه‌ای از نوع `petty_cash` و ریالی است که سرفصلش معمولاً ۱۰۰۶ «تنخواه‌گردان» است. هر مبلغی از بانک یا
 * صندوق با «انتقال وجه» به آن شارژ می‌شود و مانده‌اش بالا و پایین می‌رود (تنخواه ثابت نیست). خرج‌ها با «صورت‌هزینه
 * تنخواه» ثبت می‌شوند: یک پرداخت از تنخواه که سند آن هر ردیف را به حساب هزینه همان ردیف بدهکار و تنخواه را بستانکار
 * می‌کند. مالیات بر ارزش افزوده، فروشنده و شماره فاکتور هیچ‌کدام لازم نیستند؛ مالیات خرید جدا ثبت نمی‌شود (ت۱۳) و در
 * مبلغ همان هزینه است. وجه مانده با «انتقال وجه» از تنخواه به بانک برمی‌گردد.
 */
export const PETTY_CASH_TYPE = 'petty_cash';
export const PETTY_CASH_CURRENCY = 'IRR';
export const PETTY_CASH_MAX_LINES = 100;
export const PETTY_CASH_TEXT_MAX = 300;

export const PETTY_CASH_RIAL_ONLY_MESSAGE = 'تنخواه‌گردان فقط ریالی است؛ برای ارز دیگر حساب بانکی یا صندوق بسازید.';

/** نوع و ارز حساب خزانه: تنخواه غیرریالی پیام خطا می‌گیرد، هر چیز دیگر رشته خالی */
export function pettyCashCurrencyRefusal(type: unknown, currency: unknown): string {
  if (type !== PETTY_CASH_TYPE) return '';
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return code === '' || code === PETTY_CASH_CURRENCY || code === 'ریال' ? '' : PETTY_CASH_RIAL_ONLY_MESSAGE;
}

export interface PettyCashLineInput {
  accountId: number | null;
  amount: string | number;
  description?: string;
  sellerName?: string;
  invoiceNumber?: string;
}

/** مبلغ ردیف: متن با ارقام فارسی یا عدد؛ نامعتبر یا تهی null است، هرگز صفر */
export function pettyCashLineAmount(value: string | number): FinancialDecimal | null {
  if (typeof value === 'number') return Number.isFinite(value) ? fin(value) : null;
  const text = normalizeDecimalString(value);
  return DECIMAL_PATTERN.test(text) ? fin(text) : null;
}

/** خطای یک ردیف صورت‌هزینه (شماره ردیف از یک)، یا رشته خالی */
export function pettyCashLineError(line: PettyCashLineInput, lineNo: number): string {
  const label = `ردیف ${lineNo.toLocaleString('fa-IR')}`;
  if (!line.accountId || !Number.isInteger(line.accountId) || line.accountId <= 0) return `${label}: حساب هزینه را انتخاب کنید.`;
  const amount = pettyCashLineAmount(line.amount);
  if (!amount || !amount.isPositive()) return `${label}: مبلغ باید عددی بزرگ‌تر از صفر باشد.`;
  for (const text of [line.description, line.sellerName, line.invoiceNumber]) {
    if ((text ?? '').length > PETTY_CASH_TEXT_MAX) return `${label}: هر متن ردیف حداکثر ${PETTY_CASH_TEXT_MAX.toLocaleString('fa-IR')} نویسه است.`;
  }
  return '';
}

/** جمع مبلغ ردیف‌های معتبر */
export function pettyCashLinesTotal(lines: readonly PettyCashLineInput[]): FinancialDecimal {
  return lines.reduce((sum, line) => {
    const amount = pettyCashLineAmount(line.amount);
    return amount && amount.isPositive() ? sum.add(amount) : sum;
  }, fin(0)).round(4);
}

/** خطای کل صورت‌هزینه: نخستین خطای ردیف، تعداد ردیف‌ها و بیشتر شدن از مانده تنخواه (اگر مانده داده شود) */
export function pettyCashStatementError(lines: readonly PettyCashLineInput[], balance?: number | string | null): string {
  if (lines.length === 0) return 'دست‌کم یک ردیف هزینه وارد کنید.';
  if (lines.length > PETTY_CASH_MAX_LINES) return `صورت‌هزینه حداکثر ${PETTY_CASH_MAX_LINES.toLocaleString('fa-IR')} ردیف دارد.`;
  for (let i = 0; i < lines.length; i += 1) {
    const error = pettyCashLineError(lines[i], i + 1);
    if (error) return error;
  }
  if (balance !== undefined && balance !== null && pettyCashLinesTotal(lines).greaterThan(fin(balance))) {
    return 'جمع صورت‌هزینه از مانده تنخواه بیشتر است؛ نخست تنخواه را شارژ کنید.';
  }
  return '';
}

/** شرح ردیف سند: شرح ردیف، فروشنده و شماره فاکتور اگر نوشته شده باشند */
export function pettyCashLineVoucherDescription(fundTitle: string, line: Pick<PettyCashLineInput, 'description' | 'sellerName' | 'invoiceNumber'>): string {
  const parts = [`هزینه تنخواه ${fundTitle}`];
  if (line.description?.trim()) parts.push(line.description.trim());
  if (line.sellerName?.trim()) parts.push(`فروشنده: ${line.sellerName.trim()}`);
  if (line.invoiceNumber?.trim()) parts.push(`فاکتور: ${line.invoiceNumber.trim()}`);
  return parts.join(' — ');
}

export interface PettyCashLineDraft {
  key: number;
  accountId: number | null;
  amount: string;
  description: string;
  sellerName: string;
  invoiceNumber: string;
}

export const emptyPettyCashLine = (key: number): PettyCashLineDraft => ({
  key, accountId: null, amount: '', description: '', sellerName: '', invoiceNumber: '',
});

/** بدنه `POST /accounting/treasury/petty-cash/:id/expenses`: متن‌های خالی فرستاده نمی‌شوند */
export function pettyCashExpensePayload(form: { date: string; description: string; lines: readonly PettyCashLineDraft[]; attachments: unknown[] }) {
  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    date: form.date || undefined,
    description: text(form.description),
    lines: form.lines.map(line => ({
      accountId: Number(line.accountId),
      amount: line.amount.trim(),
      description: text(line.description),
      sellerName: text(line.sellerName),
      invoiceNumber: text(line.invoiceNumber),
    })),
    attachments: form.attachments.length > 0 ? form.attachments : undefined,
  };
}
