import React from 'react';
import { formatCurrencyLabel } from '../../../utils';

interface InvoiceServiceChargeFieldProps {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  currency: string;
}

/** v10.0.251 (TD-1136): کادر «هزینه ارسال و خدمات» فاکتور دستی؛ همان `serviceChargeAmount` که سفارش ووکامرس دارد */
export const InvoiceServiceChargeField: React.FC<InvoiceServiceChargeFieldProps> = ({ value, onChange, error, currency }) => (
  <div className="flex flex-col gap-1 bg-white p-2.5 rounded-lg border shadow-xs">
    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
      <span>هزینه ارسال و خدمات</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="۰"
        aria-invalid={error ? true : undefined}
        className="w-32 border rounded px-2 py-1 text-center text-xs font-bold bg-slate-50 focus:bg-white"
        dir="ltr"
      />
      <span className="text-xs text-slate-500">{formatCurrencyLabel(currency)}</span>
    </label>
    {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
  </div>
);
