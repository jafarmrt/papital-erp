import React, { useId } from 'react';
import { formatCurrencyLabel } from '../../../utils';
import { DecimalInput } from '../../common/DecimalInput';
import { RialEquivalent } from '../../common/RialEquivalent';
import { isRialCurrency } from '../../../lib/rialDisplay';

interface InvoiceServiceChargeFieldProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  currency: string;
}

/**
 * v10.0.260 (TD-1136): کادر «هزینه ارسال و خدمات» فاکتور دستی؛ همان `serviceChargeAmount` که سفارش ووکامرس دارد.
 * v10.1.72 (TD-1288): کادر عدد مشترک (ارقام فارسی و «٬» هنگام تایپ)، نه کادر متنی ساده.
 */
export const InvoiceServiceChargeField: React.FC<InvoiceServiceChargeFieldProps> = ({ value, onChange, error, currency }) => {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 bg-white p-2.5 rounded-lg border shadow-xs">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
        <label htmlFor={id}>هزینه ارسال و خدمات</label>
        <div className="flex flex-col">
          <DecimalInput
            id={id}
            min="0"
            value={value}
            onValueChange={onChange}
            placeholder="۰"
            className="w-32 border rounded px-2 py-1 text-center text-xs font-bold tabular-nums bg-slate-50 focus:bg-white"
          />
          {isRialCurrency(currency) && <RialEquivalent value={value} className="mt-0.5 font-normal" />}
        </div>
        <span className="text-xs text-slate-500">{formatCurrencyLabel(currency)}</span>
      </div>
      {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
    </div>
  );
};
