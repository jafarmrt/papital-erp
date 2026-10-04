import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchJson } from '../../api';
import { formatPersianPrice, formatPersianNumber, formatPersianDate, errorMessageOf } from '../../utils';
import type { TreasuryTransaction } from '../../types';
import { TreasuryVoidModal } from '../accounting/treasury/TreasuryVoidModal';

export interface PayrollPaymentRow {
  id: number;
  transactionNumber?: string;
  amount: number;
  status?: string;
  bankAccountTitle?: string | null;
  trackingNumber?: string | null;
  date?: string;
}

interface PayrollPaymentHistoryProps {
  payrollId: number;
  payments: PayrollPaymentRow[];
  loading: boolean;
  /** فیش تسویه‌شده: سابقه باز نمایش داده می‌شود */
  initiallyOpen: boolean;
  onVoided: () => void;
}

/**
 * سابقه پرداخت‌های یک فیش در پنجره پرداخت. v8.0.31 (TD-283، تصمیم مالک محصول — گزینه الف): هر پرداخت ابطال‌نشده با ذکر
 * دلیل ابطال می‌شود (POST /piecework/payrolls/:id/payments/:transactionId/void)؛ پرداخت ابطال‌شده با برچسب می‌ماند.
 */
export function PayrollPaymentHistory({ payrollId, payments, loading, initiallyOpen, onVoided }: PayrollPaymentHistoryProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [voidTarget, setVoidTarget] = useState<TreasuryTransaction | null>(null);

  useEffect(() => { setOpen(initiallyOpen); }, [initiallyOpen]);

  if (payments.length === 0) return null;

  const handleVoid = async (transactionId: number, reason: string) => {
    try {
      const res = await fetchJson<{ message?: string }>(`/piecework/payrolls/${payrollId}/payments/${transactionId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      toast.success(res?.message || 'پرداخت ابطال شد');
      onVoided();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ابطال پرداخت');
      throw err;
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full p-2.5 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <History size={13} className="text-indigo-600" />
          سابقه واریزهای قبلی ({loading ? 'در حال استعلام...' : `${formatPersianNumber(payments.length)} پرداخت`})
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="p-2.5 pt-0 space-y-1.5 text-[11px]">
          {payments.map((p, idx) => (
            <div key={p.id || idx} className={`bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between ${p.status === 'voided' ? 'opacity-60' : ''}`}>
              <div>
                <div className="font-bold text-slate-800">
                  {p.bankAccountTitle || 'حساب نامشخص'}
                  {p.trackingNumber ? ` — کد: ${p.trackingNumber}` : ''}
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  {formatPersianDate(p.date)} • سند #{p.transactionNumber || p.id}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-mono font-black ${p.status === 'voided' ? 'text-slate-400 line-through' : 'text-emerald-700'}`}>
                  {formatPersianPrice(p.amount)}
                </span>
                {p.status === 'voided' ? (
                  <span className="text-[10px] font-bold text-rose-600">ابطال‌شده</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVoidTarget(p as TreasuryTransaction)}
                    className="px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200 rounded-md hover:bg-rose-50 cursor-pointer"
                  >
                    ابطال پرداخت
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <TreasuryVoidModal target={voidTarget} onClose={() => setVoidTarget(null)} onConfirm={handleVoid} zIndexClassName="z-[95]" />
    </div>
  );
}
