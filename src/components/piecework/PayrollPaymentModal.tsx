import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Landmark, BanknoteArrowUp } from 'lucide-react';
import { fetchJson } from '../../api';
import { getTodayJalaliDate } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

// V10-4.4: مودال واحد «ثبت پرداخت حقوق» — جایگزین toggle مستقیم paid
// ثبت فقط با انتخاب حساب خزانه/بانک تا تراکنش مالی + سند تسویه اتمیک صادر شود.
interface PayrollPaymentModalProps {
  payroll: {
    id: number;
    payrollNumber: string;
    netPayable: number | string;
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
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [method, setMethod] = useState<string>('bank_transfer');
  const [paymentDate, setPaymentDate] = useState<string>(getTodayJalaliDate());
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

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
    return () => controller.abort();
  }, [payroll]);

  const selectedBank = useMemo(
    () => bankAccounts.find((b: any) => String(b.id) === bankAccountId),
    [bankAccounts, bankAccountId]
  );

  if (!payroll) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!bankAccountId) {
      toast.error('لطفاً حساب بانکی / صندوق را انتخاب کنید');
      return;
    }

    const ok = await confirmAction({
      title: 'تایید پرداخت حقوق',
      message: `مبلغ ${Number(payroll.netPayable || 0).toLocaleString('fa-IR')} بابت فیش ${payroll.payrollNumber} از حساب «${selectedBank?.title || ''}» برداشت و سند تسویه صادر خواهد شد. ادامه می‌دهید؟`,
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
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden max-h-[88vh] flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <BanknoteArrowUp size={16} className="text-emerald-600" />
            ثبت پرداخت فیش {payroll.payrollNumber}
          </h3>
          <button type="button" onClick={onClose} className="w-7 h-7 text-slate-400 hover:text-slate-600 font-bold flex items-center justify-center rounded-lg hover:bg-slate-200 cursor-pointer">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="p-4 space-y-3.5 overflow-y-auto">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between text-xs">
              <span className="text-slate-600 font-bold">خالص قابل پرداخت:</span>
              <span className="font-mono font-black text-blue-700">{Number(payroll.netPayable || 0).toLocaleString('fa-IR')} ریال</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">حساب بانکی / صندوق <span className="text-red-500">*</span></label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full border border-slate-300/80 rounded-xl px-2 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {METHOD_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">تاریخ پرداخت</label>
                <input
                  type="text"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  dir="ltr"
                  className="w-full border border-slate-300/80 rounded-xl px-2 py-2 text-xs font-mono text-left bg-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">شماره مرجع / پیگیری</label>
              <input
                type="text"
                placeholder="شماره سند انتقال، چک یا رسید"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-xs font-mono text-left bg-white outline-none focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-300/80 rounded-xl px-3 py-2 text-xs bg-white outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <p className="text-[10px] leading-relaxed text-slate-400 flex items-start gap-1.5">
              <Landmark size={12} className="shrink-0 mt-0.5" />
              با ثبت پرداخت، تراکنش خزانه و سند تسویه (بدهکار: حقوق پرداختنی / بستانکار: حساب منتخب) به‌صورت اتمیک صادر و وضعیت فیش به «پرداخت‌شده» تغییر می‌کند.
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
              disabled={isSaving || !bankAccountId}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت پرداخت'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PayrollPaymentModal;
