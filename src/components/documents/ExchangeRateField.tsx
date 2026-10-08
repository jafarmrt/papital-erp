import { FinancialAmountInput } from '../common/FinancialAmountInput';
import { formatCurrencyLabel } from '../../utils';

interface ExchangeRateFieldProps {
  currency: string;
  value: number;
  onChange: (rate: number) => void;
  /** v9.0.273 (TD-788): نرخ برگشتِ دارای فاکتور مرجع همان نرخ فاکتور است و ویرایش نمی‌شود */
  disabled?: boolean;
}

/**
 * v7.0.63 (TD-198): نرخ تسعیر سند غیرریالی (ریال به ازای یک واحد ارز سند).
 * برای سند ریالی نمایش داده نمی‌شود؛ برای سند ارزی الزامی است و سند حسابداری با همین نرخ صادر می‌شود.
 */
export function ExchangeRateField({ currency, value, onChange, disabled = false }: ExchangeRateFieldProps) {
  if (!currency || currency === 'IRR') return null;
  return (
    <FinancialAmountInput
      variant="compact"
      currency="IRR"
      label={`نرخ تسعیر (ریال به ازای هر ۱ ${formatCurrencyLabel(currency)})`}
      required
      min={0}
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      containerClassName="mt-2"
    />
  );
}

/** پیام خطای فرم وقتی سند ارزی نرخ تسعیر ندارد؛ برای سند ریالی یا نرخ معتبر null. */
export function exchangeRateError(currency: string, rate: number): string | null {
  if (!currency || currency === 'IRR') return null;
  return rate > 0 ? null : `برای سند با ارز ${formatCurrencyLabel(currency)} نرخ تسعیر الزامی است.`;
}
