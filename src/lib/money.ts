import Decimal from 'decimal.js';
import { FinancialDecimal, type DecimalValue } from './financialDecimal.js';

/**
 * v7.0.67 (P2-6 / TD-210): مقدار ستون‌های مبلغ numeric(18,4) داخل سرور.
 * ===================================================================
 * درایور PostgreSQL مقدار numeric را رشته برمی‌گرداند؛ ستون مبلغ آن را بدون عبور از double در یک
 * Decimal نگه می‌دارد تا جمع و مقایسه در سرور دقیق بماند (دقت ۳۰ رقم، financialDecimal.ts).
 * قرارداد API (تصمیم مالک محصول): در JSON همچنان عدد است — toJSON عدد برمی‌گرداند و فرانت تغییری نمی‌بیند.
 * valueOf هم عدد برمی‌گرداند تا کد قدیمی بدون نوع (any) که با + یا > روی مبلغ کار می‌کند مثل قبل رفتار کند؛
 * کد TypeScript باید از متدهای Decimal (add، greaterThan، ...) یا fin() استفاده کند و کامپایلر عملگر را رد می‌کند.
 */
export class Money extends FinancialDecimal {
  constructor(input: DecimalValue) {
    super(input);
  }

  public toJSON(): number {
    return this.toNumber();
  }

  public valueOf(): number {
    return this.toNumber();
  }

  /** سازگاری با کد قدیمی بدون نوع که مبلغ را number فرض می‌کرد. */
  public toFixed(fractionDigits?: number): string {
    return this.toNumber().toFixed(fractionDigits);
  }

  /** سازگاری با کد قدیمی بدون نوع که مبلغ را number فرض می‌کرد. */
  public toLocaleString(locales?: string | string[], options?: Intl.NumberFormatOptions): string {
    return this.toNumber().toLocaleString(locales, options);
  }
}

/** مقدار ورودی (عدد، رشته، Decimal یا Money) را برای ستون مبلغ می‌سازد. */
export const money = (val: DecimalValue): Money => (val instanceof Money ? val : new Money(val));

/** مقدار رشته‌ای numeric(18,4) برای ذخیره؛ مقدار نامعتبر رد می‌شود (نه صفر بی‌صدا). */
export function moneyToDriver(val: unknown): string {
  if (val instanceof FinancialDecimal) return val.toDbString();
  let parsed: Decimal | null = null;
  if (typeof val === 'number' && Number.isFinite(val)) parsed = new Decimal(val);
  if (typeof val === 'string') {
    try {
      parsed = new Decimal(val.replace(/,/g, '').trim());
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !parsed.isFinite()) throw new Error(`مبلغ نامعتبر برای ذخیره: ${String(val)}`);
  return new FinancialDecimal(parsed).toDbString();
}

/** معادل دقیق `Number(val) || fallback` برای ستون مبلغ: مقدار نامعتبر یا صفر جای خود را به fallback می‌دهد. */
export const moneyOr = (val: DecimalValue, fallback: DecimalValue): Money => {
  const m = money(val);
  return m.isZero() ? money(fallback) : m;
};
