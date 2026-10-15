import { useMemo } from 'react';
import { useRialDisplay } from '../useAppCurrency';
import { formatCurrencyLabel, formatPersianPrice } from '../../utils';

/**
 * v10.1.8 (D-03، تصمیم ت۴): نمایش مبلغ گزارش‌های مدیریتی. نمای «همه ارزها» و نمای ریال در واحد نمایش مبالغ ریالی
 * (ریال یا تومان، TD-667) است و نمای یک ارز خارجی با همان ارز و دو رقم اعشار.
 */
export interface ReportMoney {
  /** برچسب واحد برای سرستون */
  label: string;
  /** عدد فارسی بی برچسب؛ مقدار خالی «—» */
  format: (value: string | number | null | undefined) => string;
}

export function useReportMoney(currency: string): ReportMoney {
  const rial = useRialDisplay();
  return useMemo(() => {
    const isRial = currency === 'all' || currency === 'IRR';
    const label = isRial ? rial.label : formatCurrencyLabel(currency);
    const format = (value: string | number | null | undefined) => {
      if (value === null || value === undefined || value === '') return '—';
      return isRial ? rial.number(value) : formatPersianPrice(value, undefined, 2);
    };
    return { label, format };
  }, [currency, rial]);
}
