import React from 'react';
import { Printer, X, FileText, CheckCircle } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, formatPersianDate } from '../../utils';
import type { JournalVoucher } from '../../types';

interface VoucherPrintModalProps {
  voucher: JournalVoucher | null;
  isOpen: boolean;
  onClose: () => void;
  companyName?: string;
  companyLogo?: string;
}

export function VoucherPrintModal({
  voucher,
  isOpen,
  onClose,
  companyName = 'کارگاه تولیدی و انبار پاپیتال',
  companyLogo,
}: VoucherPrintModalProps) {
  if (!isOpen || !voucher) return null;

  const handlePrint = () => {
    window.print();
  };

  const voucherTypeMap: Record<string, string> = {
    general: 'عمومی',
    sales: 'فروش و درآمد',
    purchase: 'خرید و موجودی',
    treasury: 'دریافت و پرداخت',
    payroll: 'حقوق و دستمزد',
    closing: 'بستن حساب‌ها',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] flex flex-col border border-slate-200 dark:border-slate-800">
        {/* Header Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800 dark:text-white text-base">
              پیش‌نمایش چاپی سند حسابداری #{formatPersianNumber(voucher.voucherNumber)}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm transition"
            >
              <Printer className="w-4 h-4" />
              <span>چاپ سند (Print)</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Area */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-slate-100 dark:bg-slate-950 flex justify-center">
          <div className="bg-white text-slate-900 w-full max-w-3xl p-8 rounded-lg shadow-sm border border-slate-300 print:shadow-none print:border-none print:p-0 print:m-0 print:w-full">
            {/* Document Header */}
            <div className="border-b-2 border-slate-900 pb-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="w-1/4">
                  {companyLogo ? (
                    <img src={companyLogo} alt="Logo" className="max-h-12 object-contain" />
                  ) : (
                    <div className="text-xs font-bold text-slate-500">{companyName}</div>
                  )}
                </div>

                <div className="w-2/4 text-center">
                  <h1 className="text-lg font-black tracking-tight">{companyName}</h1>
                  <h2 className="text-base font-bold mt-1 text-slate-700">سند حسابداری (دوبل)</h2>
                  <div className="text-[11px] text-slate-500 mt-0.5">نوع سند: {voucherTypeMap[voucher.voucherType] || 'عمومی'}</div>
                </div>

                <div className="w-1/4 text-left font-mono text-xs space-y-1 text-slate-700">
                  <div>شماره سند: <strong className="font-black text-sm">{formatPersianNumber(voucher.voucherNumber)}</strong></div>
                  <div>تاریخ سند: <span>{formatPersianDate(voucher.date)}</span></div>
                  {voucher.manualVoucherNumber && (
                    <div>عطف دستی: <span>{voucher.manualVoucherNumber}</span></div>
                  )}
                </div>
              </div>
            </div>

            {/* Voucher Description */}
            <div className="bg-slate-50 border border-slate-300 rounded p-2.5 mb-4 text-xs font-medium leading-relaxed">
              <span className="font-bold ml-1">شرح کلی سند:</span>
              {voucher.description}
            </div>

            {/* Articles Table */}
            <div className="border border-slate-300 rounded overflow-hidden mb-6">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-800">
                    <th className="py-2 px-2.5 w-8 text-center border-l border-slate-300">ردیف</th>
                    <th className="py-2 px-2.5 w-24 text-center border-l border-slate-300">کد حساب</th>
                    <th className="py-2 px-2.5 w-44 border-l border-slate-300">شرح حساب / تفصیلی</th>
                    <th className="py-2 px-2.5 border-l border-slate-300">شرح آرتیکل</th>
                    <th className="py-2 px-2.5 w-32 text-left border-l border-slate-300">بدهکار ({voucher.currency})</th>
                    <th className="py-2 px-2.5 w-32 text-left">بستانکار ({voucher.currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(Array.isArray(voucher.items) ? voucher.items : []).map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td className="py-2 px-2 text-center font-bold text-slate-500 border-l border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2 text-center font-mono font-bold border-l border-slate-200">
                        {it.accountCode || '-'}
                      </td>
                      <td className="py-2 px-2.5 font-semibold border-l border-slate-200">
                        <div>{it.accountName || '-'}</div>
                        {it.detailedName && (
                          <div className="text-[10px] text-slate-500 mt-0.5">تفصیلی: {it.detailedName}</div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 border-l border-slate-200 text-slate-700">
                        {it.description || '-'}
                      </td>
                      <td className="py-2 px-2.5 text-left font-mono font-bold border-l border-slate-200">
                        {it.debit > 0 ? formatPersianPrice(it.debit) : '-'}
                      </td>
                      <td className="py-2 px-2.5 text-left font-mono font-bold">
                        {it.credit > 0 ? formatPersianPrice(it.credit) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-400 text-xs">
                    <td colSpan={4} className="py-2.5 px-3 text-left border-l border-slate-300">
                      جمع کل سند (تراز):
                    </td>
                    <td className="py-2.5 px-2.5 text-left font-mono font-black text-slate-900 border-l border-slate-300">
                      {formatPersianPrice(voucher.totalDebit)}
                    </td>
                    <td className="py-2.5 px-2.5 text-left font-mono font-black text-slate-900">
                      {formatPersianPrice(voucher.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Signature Blocks */}
            <div className="grid grid-cols-4 gap-3 pt-8 border-t border-slate-300 text-center text-xs">
              <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
                <span className="font-bold text-slate-600">تنظیم‌کننده</span>
                <span className="text-[10px] text-slate-400">{voucher.createdByUsername || 'کاربر'}</span>
              </div>
              <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
                <span className="font-bold text-slate-600">حسابدار</span>
                <span className="text-[10px] text-slate-400">امضاء و تأیید</span>
              </div>
              <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
                <span className="font-bold text-slate-600">مدیر مالی</span>
                <span className="text-[10px] text-slate-400">امضاء و تأیید</span>
              </div>
              <div className="border border-slate-200 rounded p-3 h-24 flex flex-col justify-between">
                <span className="font-bold text-slate-600">مدیریت عامل</span>
                <span className="text-[10px] text-slate-400">تصویب نهایی</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
