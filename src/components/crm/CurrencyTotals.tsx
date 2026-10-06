import { formatPersianPrice, formatCurrencyLabel } from '../../utils';
import { currencyScale } from '../../lib/currencyScale';
import type { CurrencyTotal } from '../../lib/crm/leadCurrencyTotals';

interface CurrencyTotalsLinesProps {
  totals: CurrencyTotal[];
  className?: string;
  labelClassName?: string;
}

/** v9.0.11 (TD-422): هر ارز در سطر خودش؛ مبلغ ارزی هرگز با ریال جمع نمی‌شود. بی پرونده، ۰ */
export function CurrencyTotalsLines({ totals, className = '', labelClassName = '' }: CurrencyTotalsLinesProps) {
  if (totals.length === 0) return <span className={`block ${className}`}>{formatPersianPrice(0)}</span>;
  return (
    <>
      {totals.map((t) => (
        <span key={t.currency} className={`block ${className}`} data-currency={t.currency}>
          {formatPersianPrice(t.value, undefined, currencyScale(t.currency))} <span className={labelClassName}>{formatCurrencyLabel(t.currency)}</span>
        </span>
      ))}
    </>
  );
}
