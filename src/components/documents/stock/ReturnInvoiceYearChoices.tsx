import { formatPersianDate } from '../../../utils';
import { toPersianDigits } from '../../../utils/persianNumber';
import type { ReturnInvoiceCandidate } from '../../../lib/documents/returnInvoiceLookup';

interface ReturnInvoiceYearChoicesProps {
  candidates: ReturnInvoiceCandidate[];
  onChoose: (fiscalYear: number) => void;
}

/**
 * v9.0.284 (TD-782): شماره فاکتور مرجعی که در چند سال مالی فاکتور قطعی دارد؛ کاربر سال (با تاریخ و خریدار) را انتخاب
 * می‌کند و فرم همان فاکتور را بار می‌کند. پیش‌تر فاکتور سال جاری همیشه برنده بود و فاکتور سال قبل دست‌نیافتنی.
 */
export function ReturnInvoiceYearChoices({ candidates, onChoose }: ReturnInvoiceYearChoicesProps) {
  const choices = candidates.filter(c => c.refFiscalYear !== null);
  if (choices.length === 0) return null;
  return (
    <div className="mt-2 space-y-1" role="group" aria-label="سال مالی فاکتور مرجع">
      <p className="text-[11px] font-bold text-amber-700">این شماره در چند سال مالی فاکتور قطعی دارد؛ سال را انتخاب کنید:</p>
      {choices.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChoose(Number(c.refFiscalYear))}
          className="block w-full text-right bg-amber-50 hover:bg-amber-100 border border-amber-200 text-slate-700 px-3 py-1.5 rounded-lg text-[11px] transition-colors"
        >
          سال مالی {toPersianDigits(String(c.refFiscalYear))} — {formatPersianDate(c.date)}{c.buyerName ? ` — ${c.buyerName}` : ''}
        </button>
      ))}
    </div>
  );
}
