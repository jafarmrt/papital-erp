import { FileOutput, ShoppingCart, CreditCard, FileText } from 'lucide-react';
import { formatPersianNumber } from '../../../utils';
import { Money } from '../../Money';
import type { InvoiceListSummary } from '../../../lib/invoices/invoiceListDocuments';

/** TD-080 (بخش ۳): کارت‌های خلاصه بالای لیست اسناد (مبالغ به تفکیک ارز) */
export function InvoiceListKpiCards({ summaryMetrics }: { summaryMetrics: InvoiceListSummary }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* Sales Invoices Card */}
      <div className="bg-white border border-blue-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-[11px] text-slate-500 font-bold block mb-1">کل فاکتورهای فروش (این صفحه)</span>
          <div className="text-base font-black text-blue-900 font-mono">
            {Object.entries(summaryMetrics.salesTotals).map(([cur, val]: [string, number]) => (
              <div key={cur}>
                <Money amount={val} currency={cur} />
              </div>
            ))}
          </div>
          <span className="text-[10px] text-blue-600 font-medium mt-0.5 block">
            {formatPersianNumber(summaryMetrics.salesCount)} فاکتور فروش نهایی
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0">
          <CreditCard size={20} />
        </div>
      </div>

      {/* Purchase Receipts Card */}
      <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-[11px] text-emerald-800 font-bold block mb-1">ورودی انبار / خرید کالا و مواد</span>
          <div className="text-base font-black text-emerald-950 font-mono">
            {Object.entries(summaryMetrics.purchaseTotals).map(([cur, val]: [string, number]) => (
              <div key={cur}>
                <Money amount={val} currency={cur} />
              </div>
            ))}
          </div>
          <span className="text-[10px] text-emerald-700 font-medium mt-0.5 block">
            {formatPersianNumber(summaryMetrics.purchaseCount)} رسید خرید ثبت‌شده
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center shrink-0">
          <ShoppingCart size={20} />
        </div>
      </div>

      {/* Proformas Card */}
      <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-[11px] text-amber-800 font-bold block mb-1">ارزش پیش‌فاکتورها</span>
          <div className="text-base font-black text-amber-950 font-mono">
            {Object.entries(summaryMetrics.proformaTotals).map(([cur, val]: [string, number]) => (
              <div key={cur}>
                <Money amount={val} currency={cur} />
              </div>
            ))}
          </div>
          <span className="text-[10px] text-amber-700 font-medium mt-0.5 block">
            {formatPersianNumber(summaryMetrics.proformaCount)} پیش‌فاکتور در جریان
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center shrink-0">
          <FileText size={20} />
        </div>
      </div>

      {/* Remittances / Other Card */}
      <div className="bg-white border border-purple-100 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
        <div>
          <span className="text-[11px] text-purple-800 font-bold block mb-1">حواله خروج و سایر اسناد</span>
          <div className="text-base font-black text-purple-950 font-mono">
            {formatPersianNumber(summaryMetrics.otherCount)} <span className="text-xs font-normal text-slate-500">سند</span>
          </div>
          <span className="text-[10px] text-purple-600 font-medium mt-0.5 block">
            مصرف در پروژه، مرجوعی و ضایعات
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center shrink-0">
          <FileOutput size={20} />
        </div>
      </div>
    </div>
  );
}
