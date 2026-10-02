import { formatPersianNumber, formatPersianPrice } from '../../../utils';
import { addLineQuantity, type InvoiceListDocument } from '../../../lib/invoices/invoiceListDocuments';

/** TD-080 (بخش ۳): جدول ریز اقلام سند در مودال جزئیات */
export function InvoiceDetailsItemsTable({ selectedDocDetails }: { selectedDocDetails: InvoiceListDocument }) {
  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
      <div className="bg-slate-100 px-4 py-2 font-bold text-slate-700 text-xs border-b border-slate-200 flex justify-between items-center">
        <span>ریز اقلام و ردیف‌های سند ({formatPersianNumber((selectedDocDetails.items || []).length)} قلم)</span>
        <span className="text-[11px] font-mono text-slate-500">
          مجموع تعداد: {formatPersianNumber((selectedDocDetails.items || []).reduce(addLineQuantity, 0))} واحد
        </span>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px] sticky top-0">
            <tr>
              <th className="p-2.5 w-12 text-center">ردیف</th>
              <th className="p-2.5 w-24">کد کالا</th>
              <th className="p-2.5">شرح کالا و مشخصات</th>
              <th className="p-2.5 text-center">تعداد</th>
              <th className="p-2.5 text-center">واحد</th>
              <th className="p-2.5 text-left">قیمت واحد</th>
              <th className="p-2.5 text-left">تخفیف</th>
              <th className="p-2.5 text-left">مبلغ کل</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(selectedDocDetails.items || []).map((it, idx) => {
              const qty = Number(it.quantity || 0);
              const price = Number(it.unit_price || 0);
              const disc = Number(it.discount || 0);
              const total = (qty * price) - disc;

              return (
                <tr key={it.id || idx} className="hover:bg-slate-50">
                  <td className="p-2.5 text-center font-mono text-slate-400">{formatPersianNumber(idx + 1)}</td>
                  <td className="p-2.5 font-mono text-[11px] text-slate-700" dir="ltr">{formatPersianNumber(it.code || '-')}</td>
                  <td className="p-2.5 font-bold text-slate-800">{it.name || `کالای کد ${it.item_id}`}</td>
                  <td className="p-2.5 text-center font-mono font-bold text-slate-800">{formatPersianNumber(qty)}</td>
                  <td className="p-2.5 text-center text-slate-600">{it.unit || 'عدد'}</td>
                  <td className="p-2.5 text-left font-mono font-medium">{formatPersianPrice(price)}</td>
                  <td className="p-2.5 text-left font-mono text-rose-600">{disc > 0 ? formatPersianPrice(disc) : '-'}</td>
                  <td className="p-2.5 text-left font-mono font-black text-slate-900 bg-slate-50/50">
                    {formatPersianPrice(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
