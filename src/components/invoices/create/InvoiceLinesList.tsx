import { Trash2 } from 'lucide-react';
import { formatCurrencyLabel, formatPersianCode, formatPersianNumber, formatPersianPrice } from '../../../utils';
import { printLineAmounts } from '../../../lib/invoices/invoicePrintTotals';
import type { InvoiceDocItem } from '../../../lib/invoices/invoiceForm';
import type { WarehouseItem } from '../../../hooks/queries/useSettingsQueries';
import { usePhoneWidth } from '../../../lib/pwa/usePhoneWidth';

interface InvoiceLinesListProps {
  lines: InvoiceDocItem[];
  currency: string;
  amountDecimals: number;
  warehouses: WarehouseItem[];
  onRemove: (index: number) => void;
}

/** متن‌هایی که آزمون‌ها می‌خوانند */
export const INVOICE_LINES_TEXT = {
  empty: 'هنوز کالایی به فاکتور افزوده نشده است.',
  remove: 'حذف ردیف',
} as const;

function lineWarehouseName(line: InvoiceDocItem, warehouses: WarehouseItem[]): string | null {
  if (!line.location) return null;
  return warehouses.find(w => w.code === line.location)?.name || line.location;
}

/**
 * v10.2.3 (گزینه «ج»): ردیف‌های فاکتور. روی رایانه جدول (با پیمایش افقی در پهنای کم)، روی گوشی یک کارت برای هر ردیف
 * (`usePhoneWidth`: فقط یکی از دو چیدمان ساخته می‌شود).
 */
export function InvoiceLinesList({ lines, currency, amountDecimals, warehouses, onRemove }: InvoiceLinesListProps) {
  const isPhone = usePhoneWidth();
  const cur = formatCurrencyLabel(currency);
  const price = (n: number) => formatPersianPrice(n, undefined, amountDecimals);
  if (lines.length === 0) {
    return <p className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-3 py-4 text-center">{INVOICE_LINES_TEXT.empty}</p>;
  }
  if (isPhone) {
    return (
      <ul className="space-y-2">
        {lines.map((d, i) => {
          const { total, net } = printLineAmounts({ quantity: d.quantity, unit_price: d.unitPrice, discount: d.discount });
          const wh = lineWarehouseName(d, warehouses);
          return (
            <li key={i} className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-slate-800 break-words">{d.item.name}</p>
                  <p className="text-[11px] text-slate-500 font-mono" dir="ltr">{formatPersianCode(d.item.code)}</p>
                  {wh && <p className="text-[11px] text-slate-500">انبار: {wh}</p>}
                </div>
                <button aria-label={INVOICE_LINES_TEXT.remove} type="button" onClick={() => onRemove(i)}
                  className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-600 bg-rose-50 rounded-xl">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">تعداد</dt>
                <dd className="font-bold text-left">{formatPersianNumber(d.quantity)} {d.item.unit}</dd>
                <dt className="text-slate-500">مبلغ واحد</dt>
                <dd className="text-left">{price(d.unitPrice)} {cur}</dd>
                <dt className="text-slate-500">مبلغ کل</dt>
                <dd className="text-left">{price(total)}</dd>
                {d.discount > 0 && (<><dt className="text-slate-500">تخفیف</dt><dd className="text-left text-rose-600">{price(d.discount)}</dd></>)}
                <dt className="text-slate-500">مبلغ نهایی</dt>
                <dd className="text-left font-bold text-blue-700">{price(net)} {cur}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="border border-slate-200 rounded-xl overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm text-right">
        <thead className="bg-slate-50 text-slate-600 text-xs border-b border-slate-200">
          <tr>
            <th scope="col" className="p-3 font-bold">کد</th>
            <th scope="col" className="p-3 font-bold">شرح کالا</th>
            <th scope="col" className="p-3 font-bold text-center">تعداد / مقدار</th>
            <th scope="col" className="p-3 font-bold text-center">مبلغ واحد ({cur})</th>
            <th scope="col" className="p-3 font-bold text-center">مبلغ کل</th>
            <th scope="col" className="p-3 font-bold text-center">تخفیف</th>
            <th scope="col" className="p-3 font-bold text-center">مبلغ نهایی ({cur})</th>
            <th scope="col" className="p-3 font-bold text-center"><span className="sr-only">{INVOICE_LINES_TEXT.remove}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((d, i) => {
            const { total, net } = printLineAmounts({ quantity: d.quantity, unit_price: d.unitPrice, discount: d.discount });
            const wh = lineWarehouseName(d, warehouses);
            return (
              <tr key={i} className="hover:bg-slate-50">
                <td className="p-3 font-mono text-slate-500" dir="ltr">{formatPersianCode(d.item.code)}</td>
                <td className="p-3 font-bold text-slate-800">
                  {d.item.name}
                  {wh && <span className="block text-[11px] font-normal text-slate-500">انبار: {wh}</span>}
                </td>
                <td className="p-3 text-center">
                  <span className="font-bold">{formatPersianNumber(d.quantity)}</span> <span className="text-slate-500 text-xs">{d.item.unit}</span>
                </td>
                <td className="p-3 text-center text-slate-700">{price(d.unitPrice)}</td>
                <td className="p-3 text-center text-slate-700">{price(total)}</td>
                <td className="p-3 text-center text-rose-600">{d.discount > 0 ? price(d.discount) : '-'}</td>
                <td className="p-3 text-center font-bold text-blue-700">{price(net)}</td>
                <td className="p-3 text-center">
                  <button aria-label={INVOICE_LINES_TEXT.remove} type="button" onClick={() => onRemove(i)}
                    className="text-rose-600 hover:text-rose-700 bg-rose-50 p-1.5 rounded-lg transition-colors inline-flex">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
