import { useId, type ReactNode } from 'react';
import { Calculator } from 'lucide-react';
import { formatCurrencyLabel, formatPersianNumber, formatPersianPrice } from '../../../utils';
import { DecimalInput } from '../../common/DecimalInput';
import { InvoiceFormSection } from './InvoiceFormSection';
import { INVOICE_LABEL } from './invoiceFormStyles';

interface InvoiceTotalsPanelProps {
  applyVat: boolean;
  onApplyVatChange: (apply: boolean) => void;
  vatRate: number;
  onVatRateChange: (rate: number) => void;
  /** کادر هزینه ارسال و خدمات (`InvoiceServiceChargeField`) */
  serviceChargeField: ReactNode;
  gross: number;
  discount: number;
  vatAmount: number;
  serviceCharge: number;
  payable: number;
  currency: string;
  amountDecimals: number;
}

/**
 * v10.2.2 (گزینه «ج»): بخش «جمع و مالیات». مالیات بر ارزش افزوده برای هر فاکتور اختیاری است و تیک آن به‌طور پیش‌فرض
 * خاموش است (قاعده مالک محصول: مالیات پشتیبانی می‌شود، هرگز الزامی نیست).
 */
export function InvoiceTotalsPanel(props: InvoiceTotalsPanelProps) {
  const id = useId();
  const { applyVat, onApplyVatChange, vatRate, onVatRateChange, serviceChargeField, gross, discount, vatAmount, serviceCharge, payable, currency, amountDecimals } = props;
  const price = (n: number) => formatPersianPrice(n, undefined, amountDecimals);
  const rows: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'مبلغ ناخالص', value: price(gross) },
    { label: 'تخفیف‌ها', value: price(discount), tone: 'text-rose-600' },
    ...(applyVat ? [{ label: `ارزش افزوده (${formatPersianNumber(vatRate)}٪)`, value: price(vatAmount), tone: 'text-amber-700' }] : []),
    ...(serviceCharge > 0 ? [{ label: 'ارسال و خدمات', value: price(serviceCharge) }] : []),
  ];
  return (
    <InvoiceFormSection icon={Calculator} title="جمع و مالیات">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-slate-200">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700 min-h-[32px]">
              <input type="checkbox" checked={applyVat} onChange={e => onApplyVatChange(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer" />
              <span>مالیات بر ارزش افزوده دارد</span>
            </label>
            {applyVat && (
              <div className="flex items-center gap-1.5">
                <label htmlFor={`${id}-vat-rate`} className="text-xs text-slate-500">نرخ</label>
                <div className="flex flex-col">
                  <DecimalInput id={`${id}-vat-rate`} min="0" max="100" value={vatRate} onValueChange={v => onVatRateChange(Number(v) || 0)}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-center text-xs font-bold tabular-nums bg-slate-50 focus:bg-white" />
                </div>
                <span className="text-xs text-slate-500">٪</span>
              </div>
            )}
          </div>
          {serviceChargeField}
        </div>
        <dl className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 text-sm">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between gap-3">
              <dt className={`${INVOICE_LABEL} mb-0 font-medium text-slate-500`}>{r.label}</dt>
              <dd className={`font-bold tabular-nums ${r.tone ?? 'text-slate-800'}`}>{r.value}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2 mt-2">
            <dt className="text-xs font-bold text-blue-900">قابل پرداخت</dt>
            <dd className="font-bold tabular-nums text-base text-blue-900">{price(payable)} {formatCurrencyLabel(currency)}</dd>
          </div>
        </dl>
      </div>
    </InvoiceFormSection>
  );
}
