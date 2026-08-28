import { useEffect, useState } from 'react';
import { fetchJson } from '../api';
import { Wallet, FileText, Printer, BadgeCheck, Clock, Info } from 'lucide-react';
import { PieceworkPayroll } from '../types';
import { formatPersianPrice, formatPersianDate, formatPersianNumber, formatPersianCode, formatCurrencyLabel } from '../utils';
import { useAppCurrency } from '../hooks/useAppCurrency';
import { PieceworkPayslipModal } from '../components/piecework/PieceworkPayslipModal';

const statusMeta: Record<string, { label: string; cls: string; icon: typeof BadgeCheck }> = {
  draft: { label: 'پیش‌نویس', cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: Clock },
  approved: { label: 'صادر شده - در انتظار پرداخت', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  paid: { label: 'پرداخت شده', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: BadgeCheck }
};

export default function MyPayslipsPage() {
  const [payslips, setPayslips] = useState<PieceworkPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLinked, setIsLinked] = useState(true);
  const [viewingPayroll, setViewingPayroll] = useState<PieceworkPayroll | null>(null);
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);

  const loadPayslips = (signal?: AbortSignal) => {
    setLoading(true);
    fetchJson('/piecework/payrolls/mine', { signal })
      .then(res => {
        const data = Array.isArray(res) ? res : [];
        setPayslips(data);
        setLoading(false);
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        console.error('Error loading my payslips:', err);
        setPayslips([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    loadPayslips(controller.signal);
    // تشخیص لینک نبودن کاربر به پرسنل (پاسخ خالی = یا لینک نیست یا فیش ندارد)
    return () => controller.abort();
  }, []);

  const paidCount = payslips.filter(p => p.status === 'paid').length;
  const pendingCount = payslips.filter(p => p.status === 'approved').length;

  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-12 font-farsi text-right">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-12 h-12 bg-emerald-600/30 border border-emerald-400/30 rounded-2xl flex items-center justify-center text-emerald-400 shadow-inner shrink-0">
            <Wallet size={26} />
          </div>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              فیش‌های حقوقی من
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              مشاهده و چاپ فیش‌های حقوقی صادرشده برای شما (حقوق ثابت، کارمزدی یا ترکیبی)
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {payslips.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
            <p className="text-[10px] text-slate-400 font-bold">کل فیش‌ها</p>
            <p className="text-lg font-black text-slate-900">{formatPersianNumber(payslips.length)}</p>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4 shadow-2xs">
            <p className="text-[10px] text-amber-500 font-bold">در انتظار پرداخت</p>
            <p className="text-lg font-black text-amber-700">{formatPersianNumber(pendingCount)}</p>
          </div>
          <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-2xs">
            <p className="text-[10px] text-emerald-500 font-bold">پرداخت شده</p>
            <p className="text-lg font-black text-emerald-700">{formatPersianNumber(paidCount)}</p>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-[300px]">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileText size={18} className="text-emerald-600" />
            فیش‌های صادرشده
          </h3>
        </div>

        <div className="flex-1 overflow-auto relative min-h-[240px]">
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            </div>
          )}
          {!loading && payslips.length === 0 && (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-3">
              <Info size={36} className="text-slate-300" />
              <div className="text-sm font-bold">هنوز فیش حقوقی برای شما صادر نشده است.</div>
              <div className="text-xs text-slate-400 max-w-md leading-6">
                فیش حقوقی شما توسط واحد مدیریت پس از ثبت کارکرد یا حقوق ماهانه صادر و در همین بخش نمایش داده می‌شود.
                اگر فکر می‌کنید باید فیشی برای شما صادر شده باشد، با مدیر سیستم تماس بگیرید.
              </div>
            </div>
          )}
          {!loading && payslips.length > 0 && (
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0 z-0 text-xs font-bold">
                <tr>
                  <th className="p-3">شماره فیش</th>
                  <th className="p-3">عنوان / بازه</th>
                  <th className="p-3">خالص پرداختی</th>
                  <th className="p-3">وضعیت</th>
                  <th className="p-3 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {payslips.map(p => {
                  const meta = statusMeta[p.status] || statusMeta.draft;
                  const StatusIcon = meta.icon;
                  return (
                    <tr key={p.id} className="hover:bg-emerald-50/40 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-800">{formatPersianCode(p.payrollNumber)}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{p.title || 'فیش حقوقی'}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {formatPersianDate(p.startDate)} تا {formatPersianDate(p.endDate)}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="font-black text-slate-900">{formatPersianPrice(p.netPayable, appCurrency)}</span>
                        <div className="text-[10px] text-slate-400">{curLbl}</div>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs border ${meta.cls}`}>
                          <StatusIcon size={13} />
                          {meta.label}
                        </span>
                        {p.status === 'paid' && p.paymentDate && (
                          <div className="text-[10px] text-slate-400 mt-1">پرداخت: {formatPersianDate(p.paymentDate)}</div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setViewingPayroll(p)}
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-colors cursor-pointer inline-flex items-center gap-1"
                          title="مشاهده و چاپ فیش حقوقی"
                        >
                          <Printer size={13} />
                          <span>مشاهده / چاپ فیش</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Payslip Viewer (read-only) */}
      {viewingPayroll && (
        <PieceworkPayslipModal
          viewingPayroll={viewingPayroll}
          onClose={() => setViewingPayroll(null)}
          onUpdateStatus={() => { /* مشاهده‌ای: بدون تغییر وضعیت */ }}
          onDeletePayroll={() => { /* مشاهده‌ای: بدون ابطال */ }}
          readOnly
        />
      )}
    </div>
  );
}
