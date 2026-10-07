import { formatPersianPrice } from '../utils';

export interface MoneyProps {
  amount: number | string | null | undefined;
  currency?: string;
  className?: string;
}

/**
 * V9 Phase 3: کامپوننت مرکزی نمایش مبلغ با ارز داینامیک.
 * هیچ ارز ثابتی در UI نوشته نمی‌شود؛ برچسب ارز از فیلد currency رکورد می‌آید.
 * مبلغ ریالی بی ارز با `useRialDisplay()` در واحد نمایش ریال یا تومان نشان داده می‌شود (v9.0.275، TD-667).
 */
export function Money({ amount, currency, className }: MoneyProps) {
  return <span className={className} suppressHydrationWarning>{formatPersianPrice(amount, currency)}</span>;
}
