import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatPersianPrice } from '../../../utils';
import type { TreasuryTransaction } from '../../../types';

interface TreasuryVoidModalProps {
  target: TreasuryTransaction | null;
  onClose: () => void;
  onConfirm: (id: number, reason: string) => Promise<void>;
}

export const TreasuryVoidModal: React.FC<TreasuryVoidModalProps> = ({
  target,
  onClose,
  onConfirm,
}) => {
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  if (!target) return null;

  const handleConfirm = async () => {
    if (!voidReason.trim()) {
      alert('لطفاً دلیل ابطال تراکنش را وارد کنید.');
      return;
    }
    setIsVoiding(true);
    try {
      await onConfirm(target.id, voidReason.trim());
      setVoidReason('');
      onClose();
    } catch {
      // Handled in parent
    } finally {
      setIsVoiding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
        <h3 className="font-bold text-rose-700 dark:text-rose-300 text-base mb-1 flex items-center gap-2">
          <AlertTriangle size={18} />
          ابطال تراکنش خزانه
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-6">
          تراکنش «<span className="font-mono font-bold">{target.transactionNumber}</span>» به مبلغ{' '}
          <span className="font-bold">{formatPersianPrice(target.amount)}</span> ابطال می‌شود؛ یک تراکنش معکوس
          با شماره سری جدید و سند معکوس حسابداری ثبت و مانده «{target.bankAccountTitle || '—'}» اصلاح خواهد شد.
          رکورد اصلی حذف نمی‌شود و با وضعیت «ابطال‌شده» در تاریخچه می‌ماند.
        </p>
        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
          دلیل ابطال <span className="text-rose-500">*</span>
        </label>
        <textarea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          rows={3}
          placeholder="مثال: اشتباه در مبلغ — ثبت مجدد با مبلغ صحیح"
          className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-xs bg-slate-50 dark:bg-slate-700 focus:outline-none focus:border-rose-400 resize-none"
          disabled={isVoiding}
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => { setVoidReason(''); onClose(); }}
            disabled={isVoiding}
            className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            onClick={handleConfirm}
            disabled={isVoiding}
            className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            {isVoiding ? 'در حال ابطال...' : 'ابطال با سند معکوس'}
          </button>
        </div>
      </div>
    </div>
  );
};
