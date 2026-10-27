import { useShownRial } from '../contexts/RialDisplayContext';

export interface MoneyProps {
  amount: number | string | null | undefined;
  currency?: string;
  className?: string;
}

/**
 * V9 Phase 3: کامپوننت مرکزی نمایش مبلغ با ارز داینامیک.
 * هیچ ارز ثابتی در UI نوشته نمی‌شود؛ برچسب ارز از فیلد currency رکورد می‌آید.
 * مبلغ ریالی بی ارز با `useRialDisplay()` در واحد نمایش ریال یا تومان نشان داده می‌شود (v9.0.275، TD-667).
 * v11 phase 6.3 (U3): a rial amount (or one without a currency) in the app's display unit, a foreign one in its currency.
 */
export function Money({ amount, currency, className }: MoneyProps) {
  const rial = useShownRial();
  return <span className={className} suppressHydrationWarning>{rial.money(amount, currency)}</span>;
}
