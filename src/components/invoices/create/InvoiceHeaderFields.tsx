import { useId } from 'react';
import { FileText } from 'lucide-react';
import { formatCurrencyLabel } from '../../../utils';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { TREASURY_CURRENCIES } from '../../../lib/treasury/treasuryCurrency';
import { ExchangeRateField } from '../../documents/ExchangeRateField';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import { InvoiceFormSection } from './InvoiceFormSection';
import { INVOICE_FIELD, INVOICE_LABEL, INVOICE_READONLY_FIELD } from './invoiceFormStyles';

/** متن گزینه‌های وضعیت سند؛ آزمون‌ها همین را می‌خوانند */
export const INVOICE_STATUS_LABELS = {
  proforma: 'پیش‌فاکتور (رزرو موقت)',
  final: 'فاکتور نهایی (کسر از انبار)',
} as const;

interface InvoiceHeaderFieldsProps {
  status: string;
  onStatusChange: (status: string) => void;
  /** گزینه «فاکتور نهایی» بسته است (بی مجوز یا در ویرایش) */
  finalDisabled: boolean;
  finalOptionNote: string;
  currency: string;
  onCurrencyChange: (currency: string) => void;
  exchangeRate: number;
  onExchangeRateChange: (rate: number) => void;
  warehouses: WarehouseItem[];
  location: string;
  onLocationChange: (code: string) => void;
  multiWarehouseEdit: boolean;
  refNumber: string;
  date: string;
  onDateChange: (iso: string) => void;
}

/**
 * v10.2.3 (گزینه «ج»): بخش «مشخصات سند» فرم فاکتور و پیش‌فاکتور: وضعیت، ارز و نرخ، انبار خروج، شماره و تاریخ.
 * روی گوشی یک ستون، روی رایانه سه ستون.
 */
export function InvoiceHeaderFields(props: InvoiceHeaderFieldsProps) {
  const id = useId();
  const { status, onStatusChange, finalDisabled, finalOptionNote, currency, onCurrencyChange, exchangeRate, onExchangeRateChange,
    warehouses, location, onLocationChange, multiWarehouseEdit, refNumber, date, onDateChange } = props;
  return (
    <InvoiceFormSection icon={FileText} title="مشخصات سند">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label htmlFor={`${id}-status`} className={INVOICE_LABEL}>وضعیت سند</label>
          <select id={`${id}-status`} className={`${INVOICE_FIELD} font-bold`} value={status} onChange={e => onStatusChange(e.target.value)}>
            <option value="proforma">{INVOICE_STATUS_LABELS.proforma}</option>
            <option value="final" disabled={finalDisabled}>{INVOICE_STATUS_LABELS.final}{finalOptionNote}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-currency`} className={INVOICE_LABEL}>ارز</label>
          <select id={`${id}-currency`} className={`${INVOICE_FIELD} font-bold`} value={currency} onChange={e => onCurrencyChange(e.target.value)}>
            {TREASURY_CURRENCIES.map(code => <option key={code} value={code}>{formatCurrencyLabel(code)}</option>)}
          </select>
          <ExchangeRateField currency={currency} value={exchangeRate} onChange={onExchangeRateChange} />
        </div>
        <div>
          <label htmlFor={`${id}-warehouse`} className={INVOICE_LABEL}>انبار خروج</label>
          {warehouses.length > 0 ? (
            <select id={`${id}-warehouse`} className={`${INVOICE_FIELD} font-bold`} value={location} onChange={e => onLocationChange(e.target.value)}>
              {warehouses.map(w => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
          ) : (
            <p id={`${id}-warehouse`} role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
              هنوز انباری تعریف نشده است (تنظیمات، انبارها).
            </p>
          )}
          {multiWarehouseEdit && (
            <p className="mt-1 text-[11px] text-amber-800">
              ردیف‌های این پیش‌فاکتور از چند انبار است و هر ردیف از انبار خودش ذخیره می‌شود. تغییر این انبار همه ردیف‌ها را به آن می‌برد.
            </p>
          )}
        </div>
        <div>
          {/* v9.0.327 (TD-783، تصمیم ت۹ الف): شماره فقط از سری سرور؛ سند تازه شماره را هنگام ثبت می‌گیرد */}
          <label htmlFor={`${id}-ref-number`} className={INVOICE_LABEL}>شماره سند</label>
          <input id={`${id}-ref-number`} type="text" value={refNumber} readOnly dir="ltr"
            title="شماره هنگام ثبت از سری فاکتورهای سامانه داده می‌شود"
            className={`${INVOICE_READONLY_FIELD} text-left font-mono`} />
          <p className="mt-1 text-[11px] text-slate-500">هنگام ثبت از سری سامانه داده می‌شود.</p>
        </div>
        <div>
          <label htmlFor={`${id}-date`} className={INVOICE_LABEL}>تاریخ</label>
          <JalaliDateInput id={`${id}-date`} value={date} onChange={onDateChange} className={INVOICE_FIELD} />
        </div>
      </div>
    </InvoiceFormSection>
  );
}
