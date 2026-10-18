/**
 * v10.2.3 (گزینه «ج» بازبینی فرم فاکتور): کلاس‌های کادر و برچسب فرم فاکتور و پیش‌فاکتور، همان ظاهر فرم سند انبار
 * (`StockDocumentDetailsFields`) تا فرم‌های فروش و انبار یک‌شکل باشند.
 */
export const INVOICE_LABEL = 'block text-xs font-bold mb-1.5 text-slate-700';
export const INVOICE_FIELD =
  'w-full border border-slate-200 bg-white rounded-xl text-sm px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:bg-slate-100 disabled:text-slate-400';
export const INVOICE_READONLY_FIELD =
  'w-full border border-slate-200 bg-slate-50 rounded-xl text-sm px-3 py-2 text-slate-700 cursor-default focus:outline-none';
export const INVOICE_NUMBER_FIELD = `${INVOICE_FIELD} text-center tabular-nums font-bold`;
