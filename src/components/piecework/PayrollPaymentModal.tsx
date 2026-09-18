import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Landmark, BanknoteArrowUp, History, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchJson } from '../../api';
import { getTodayJalaliDate, extractDateString, formatPersianPrice, formatPersianNumber } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

// V4.0.33: مودال واحد «پرداخت حقوق (کامل یا چندمرحله‌ای)»
// ثبت فقط با انتخاب حساب خزانه/بانک تا تراکنش مالی + سند تسویه اتمیک صادر شود.
interface PayrollPaymentModalProps {
  payroll: {
    id: number;
    payrollNumber: string;
    netPayable: number | string;
    paidAmount?: number | string;
    paid_amount?: number | string;
    status?: string;
  } | null;
  onClose: () => void;
  onPaid?: () => void;
}

const METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'انتقال بانکی' },
  { value: 'cash', label: 'نقدی / صندوق' },
  { value: 'pos', label: 'کارتخوان' },
  { value: 'cheque', label: 'چک' }
] as const;

export function PayrollPaymentModal({ payroll, onClose, onPaid }: PayrollPaymentModalProps) {
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [previousPayments, setPreviousPayments] = useState<any[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [method, setMethod] = useState<string>('bank_transfer');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [paymentDate, setPaymentDate] = useState<string>(getTodayJalaliDate());
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // محاسبات مانده و پرداخت‌های قبلی
  const netPayable = useMemo(() => Number(payroll?.netPayable || 0), [payroll]);
  const initialPaid = useMemo(() => Number(payroll?.paidAmount ?? payroll?.paid_amount ?? 0), [payroll]);
  
  // مانده قابل پرداخت فیش
  const remainingPayable = useMemo(() => Math.max(0, netPayable - initialPaid), [netPayable, initialPaid]);

  useEffect(() => {
    if (!payroll) return;
    let controller = new AbortController();
    setLoadingBanks(true);
    fetchJson('/accounting/bank-accounts', { signal: controller.signal })
      .then((res: any) => {
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        setBankAccounts(list.filter((b: any) => !b.isDeleted));
      })
      .catch(() => toast.error('خطا در دریافت فهرست حساب‌های خزانه'))
      .finally(() => setLoadingBanks(false));

    // دریافت سوابق پرداخت‌های این فیش
    setLoadingPayments(true);
    fetchJson(`/piecework/payrolls/${payroll.id}/payments`, { signal: controller.signal })
      .then((data: any) => {
        const list = Array.isArray(data) ? data : [];
        setPreviousPayments(list);
      })
      .catch(() => {
        // نادیده گرفتن خطا اگر هنوز پرداختی ثبت نشده
      })
      .finally(() => setLoadingPayments(false));

    // پیش‌فرض مبلغ پرداختی برابر با کل مانده
    const rem = Math.max(0, Number(payroll.netPayable || 0) - Number(payroll.paidAmount ?? payroll.paid_amount ?? 0));
    setPayAmount(rem);

    return () => controller.abort();
  }, [payroll]);

  const selectedBank = useMemo(
    () => bankAccounts.find((b: any) => String(b.id) === bankAccountId),
    [bankAccounts, bankAccountId]
  );

  if (!payroll) return null;

  const isFullSettlement = payAmount >= remainingPayable;
  const remainingAfterThis = Math.max(0, remainingPayable - payAmount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!bankAccountId) {
      toast.error('لطفاً حساب بانکی / صندوق را انتخاب کنید');
      return;
    }

    if (!payAmount || payAmount <= 0) {
      toast.error('مبلغ پرداختی باید بیشتر از صفر باشد');
      return;
    }

    if (payAmount > remainingPayable) {
      toast.error(`مبلغ پرداختی نمی‌تواند بیشتر از مانده فیش (${remainingPayable.toLocaleString('fa-IR')} ریال) باشد`);
      return;
    }

    const confirmMsg = isFullSettlement
      ? `مبلغ ${payAmount.toLocaleString('fa-IR')} ریال بابت تسویه کامل فیش ${payroll.payrollNumber} از حساب «${selectedBank?.title || ''}» پرداخت می‌شود و وضعیت فیش به «پرداخت‌شده» تغییر می‌کند. ادامه می‌دهید؟`
      : `مبلغ ${payAmount.toLocaleString('fa-IR')} ریال بابت پرداخت مرحله‌ای فیش ${payroll.payrollNumber} از حساب «${selectedBank?.title || ''}» پرداخت می‌شود (مانده پس از پرداخت: ${remainingAfterThis.toLocaleString('fa-IR')} ریال). ادامه می‌دهید؟`;

    const ok = await confirmAction({
      title: isFullSettlement ? 'تایید تسویه کامل حقوق' : 'تایید پرداخت مرحله‌ای حقوق',
      message: confirmMsg,
      confirmText: 'بله، ثبت پرداخت'
    });
    if (!ok) return;

    setIsSaving(true);
    try {
      const res: any = await fetchJson(`/piecework/payrolls/${payroll.id}/register-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: Number(bankAccountId),
          method,
          amount: payAmount,
          paymentDate,
          paymentReference,
          notes
        })
      });
      toast.success(res.message || `پرداخت فیش ${payroll.payrollNumber} ثبت شد`);
      onPaid?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'خطا در ثبت پرداخت');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <BanknoteArrowUp size={16} className="text-emerald-600" />
            پرداخت فیش حقوقی {payroll.payrollNumber}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-600 font-bold flex items-center justify-center rounded-lg hover:bg-slate-200 cursor-pointer"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="p-4 space-y-3.5 overflow-y-auto">
            {/* کارت خلاصه وضعیت مالی فیش */}
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 border border-blue-100/80 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-bold">خالص کل فیش:</span>
                <span className="font-mono font-black text-slate-900">{formatPersianPrice(netPayable)}</span>
              </div>
              {initialPaid > 0 && (
                <div className="flex items-center justify-between text-emerald-700">
                  <span className="font-bold flex items-center gap-1">
                    <CheckCircle2 size={13} />
                    پرداخت‌شده تاکنون:
                  </span>
                  <span className="font-mono font-black">{formatPersianPrice(initialPaid)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1.5 border-t border-blue-200/60">
                <span className="text-blue-900 font-black">مانده قابل پرداخت:</span>
                <span className="font-mono font-black text-blue-800 text-sm">{formatPersianPrice(remainingPayable)}</span>
              </div>
            </div>

            {/* سابقه پرداخت‌های قبلی در صورت وجود */}
            {previousPayments.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="w-full p-2.5 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <History size={13} className="text-indigo-600" />
                    سابقه واریزهای قبلی ({loadingPayments ? 'در حال استعلام...' : `${formatPersianNumber(previousPayments.length)} پرداخت`})
                  </span>
                  {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showHistory && (
                  <div className="p-2.5 pt-0 space-y-1.5 text-[11px]">
                    {previousPayments.map((p: any, idx: number) => (
                      <div key={p.id || idx} className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-800">
                            {p.bankAccountTitle || 'حساب نامشخص'}
                            {p.trackingNumber ? ` — کد: ${p.trackingNumber}` : ''}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {p.date} • سند #{p.transactionNumber || p.id}
                          </div>
                        </div>
                        <div className="font-mono font-black text-emerald-700">
                          {formatPersianPrice(p.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* فیلد مبلغ پرداختی این نوبت */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  مبلغ پرداختی این نوبت (ریال) <span className="text-red-500">*</span>
                </label>
                {payAmount !== remainingPayable && (
                  <button
                    type="button"
                    onClick={() => setPayAmount(remainingPayable)}
                    className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                  >
                    تسویه کل مانده
                  </button>
                )}
              </div>
              <input
                type="number"
                min="1"
                max={remainingPayable}
                value={payAmount || ''}
                onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                placeholder="مبلغ پرداختی..."
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono font-bold text-slate-900 bg-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              {/* پیش‌بینی وضعیت پس از پرداخت */}
              <div className="mt-1.5 text-[11px] font-bold">
                {payAmount > remainingPayable ? (
                  <p className="text-rose-600 flex items-center gap-1">
                    <AlertCircle size={12} />
                    مبلغ پرداختی از مانده فیش بیشتر است!
                  </p>
                ) : isFullSettlement ? (
                  <p className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    وضعیت پس از ثبت: تسویه کامل فیش (پرداخت‌شده)
                  </p>
                ) : (
                  <p className="text-amber-700 flex items-center gap-1">
                    <AlertCircle size={12} />
                    وضعیت پس از ثبت: پرداخت جزئی — مانده فیش: {formatPersianPrice(remainingAfterThis)}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                حساب بانکی / صندوق مبدا <span className="text-red-500">*</span>
              </label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{loadingBanks ? 'در حال بارگذاری...' : '-- انتخاب حساب --'}</option>
                {bankAccounts.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.title}{b.currentBalance != null ? ` — مانده: ${Number(b.currentBalance).toLocaleString('fa-IR')}` : ''}
                  </option>
                ))}
              </select>
              {!loadingBanks && bankAccounts.length === 0 && (
                <p className="text-[10px] text-rose-500 mt-1">هیچ حساب خزانه‌ای یافت نشد؛ ابتدا در بخش حسابداری ← خزانه یک حساب تعریف کنید.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">روش پرداخت</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-2 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {METHOD_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ پرداخت</label>
                <DatePicker
                  value={paymentDate}
                  onChange={(d: any) => setPaymentDate(extractDateString(d))}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  inputClass="w-full border border-slate-300 rounded-xl px-2 py-2 text-xs text-center bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  containerClassName="w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">شماره مرجع / پیگیری واریز</label>
              <input
                type="text"
                placeholder="شماره سند انتقال، چک یا رسید"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-left bg-white outline-none focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات و بابت</label>
              <textarea
                rows={2}
                placeholder="توضیحات تکمیلی نوبت پرداخت..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <p className="text-[10px] leading-relaxed text-slate-400 flex items-start gap-1.5">
              <Landmark size={12} className="shrink-0 mt-0.5" />
              با ثبت پرداخت، تراکنش خزانه و سند حسابداری تسویه به‌صورت اتمیک صادر شده و موجودی بانک و مانده قابل پرداخت فیش به‌روزرسانی می‌گردند.
            </p>
          </div>

          <div className="p-4 border-t border-slate-200 flex justify-end gap-2.5 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-xl hover:bg-slate-100 bg-white text-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving || !bankAccountId || payAmount <= 0 || payAmount > remainingPayable}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : isFullSettlement ? 'ثبت تسویه کامل' : 'ثبت پرداخت مرحله‌ای'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PayrollPaymentModal;
