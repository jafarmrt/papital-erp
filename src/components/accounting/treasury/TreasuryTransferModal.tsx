import React, { useState, useEffect, useMemo, useId } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { getTodayIsoDate } from '../../../utils';
import { rialDisplayOf } from '../../../lib/rialDisplay';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { FinancialAmountInput } from '../../common/FinancialAmountInput';
import { HelpBadge } from '../../common/HelpBadge';
import { fetchJson } from '../../../api';
import type { BankAccount } from '../../../types';
import { DialogLayer } from '../../common/DialogLayer';

/** خطای فرم انتقال وجه، که زیر فرم نشان داده می‌شود (نه پنجره alert مرورگر) */
export function transferFormError(form: { fromBankAccountId: number | null; toBankAccountId: number | null; amount: number }): string {
  if (!form.fromBankAccountId || !form.toBankAccountId) return 'لطفاً حساب‌های مبدأ و مقصد را انتخاب کنید.';
  if (form.fromBankAccountId === form.toBankAccountId) return 'حساب مبدأ و مقصد نمی‌توانند یکسان باشند.';
  if (!(form.amount > 0)) return 'مبلغ انتقال باید بزرگ‌تر از صفر باشد.';
  return '';
}

interface TreasuryTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: BankAccount[];
  appCurrency: string;
  onSave: (data: any) => Promise<void>;
  /** v10.1.32 (D-16): مبدأ یا مقصد از پیش انتخاب‌شده، برای شارژ تنخواه و برگشت وجه آن */
  preset?: { fromBankAccountId?: number | null; toBankAccountId?: number | null } | null;
}

export const TreasuryTransferModal: React.FC<TreasuryTransferModalProps> = ({
  isOpen,
  onClose,
  bankAccounts,
  appCurrency,
  onSave,
  preset,
}) => {
  const fieldId = useId();
  const rial = useMemo(() => rialDisplayOf(appCurrency), [appCurrency]);
  const [formData, setFormData] = useState({
    fromBankAccountId: null as number | null,
    toBankAccountId: null as number | null,
    amount: 0,
    date: '',
    trackingNumber: '',
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // TD-105: تاریخ پیش‌فرض از سرور (ساعت توافقی) — نه ساعت مرورگر کلاینت
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchJson<{ success: boolean; data: { today: string } }>('/api/system/business-date')
      .then(res => {
        const today = res?.data?.today;
        if (!cancelled && today) {
          setFormData(p => ({ ...p, date: today }));
        }
      })
      .catch(() => {
        // fallback در خطای شبکه: امروزِ منطقه زمانی توافقی (v8.0.49، TD-312؛ پیش‌تر روز UTC)
        if (!cancelled) {
          setFormData(p => (p.date ? p : { ...p, date: getTodayIsoDate() }));
        }
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  const presetFrom = preset?.fromBankAccountId ?? null;
  const presetTo = preset?.toBankAccountId ?? null;
  useEffect(() => {
    if (isOpen) {
      setFormData({
        fromBankAccountId: presetFrom,
        toBankAccountId: presetTo,
        amount: 0,
        date: '',
        trackingNumber: '',
        description: '',
      });
      setFormError('');
    }
  }, [isOpen, presetFrom, presetTo]);

  if (!isOpen) return null;

  const updateForm = (change: (prev: typeof formData) => typeof formData) => {
    setFormData(change);
    setFormError('');
  };

  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const selectedFrom = safeBankAccounts.find(b => b.id === formData.fromBankAccountId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = transferFormError(formData);
    setFormError(error);
    if (error) return;

    setIsSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch {
      // Handled in parent
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <DialogLayer onClose={onClose} disabled={isSaving} />
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-amber-600" />
            انتقال وجه بین حساب‌ها و صندوق‌ها
          </h3>
          <button aria-label="بستن"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor={`${fieldId}-from-bank-account-id`} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              <span>از حساب / صندوق (مبدأ) *</span>
              <HelpBadge text="حساب یا صندوقی که وجه از آن کسر می‌گردد (بستانکار می‌شود)." />
            </label>
            <select
              id={`${fieldId}-from-bank-account-id`}
              required
              value={formData.fromBankAccountId || ''}
              onChange={e => updateForm(p => ({ ...p, fromBankAccountId: Number(e.target.value) || null }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
            >
              <option value="">انتخاب مبدأ...</option>
              {safeBankAccounts.map(b => (
                <option key={b.id} value={b.id}>
                  {b.title} — مانده: {rial.money(b.currentBalance, b.currency)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${fieldId}-to-bank-account-id`} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              <span>به حساب / صندوق (مقصد) *</span>
              <HelpBadge text="حساب یا صندوقی که وجه به آن اضافه می‌گردد (بدهکار می‌شود)." />
            </label>
            <select
              id={`${fieldId}-to-bank-account-id`}
              required
              value={formData.toBankAccountId || ''}
              onChange={e => updateForm(p => ({ ...p, toBankAccountId: Number(e.target.value) || null }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
            >
              <option value="">انتخاب مقصد...</option>
              {safeBankAccounts
                .filter(b => b.id !== formData.fromBankAccountId)
                .map(b => (
                  <option key={b.id} value={b.id}>
                    {b.title} — مانده: {rial.money(b.currentBalance, b.currency)}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 items-start">
            <div>
              <FinancialAmountInput
                label="مبلغ انتقال"
                required
                min={1}
                value={formData.amount}
                currency={selectedFrom?.currency || 'IRR'}
                onChange={val => updateForm(p => ({ ...p, amount: val }))}
                placeholder="۱٬۰۰۰٬۰۰۰"
                showWordsBadge={true}
                showTomanEquivalent={true}
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-date`} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تاریخ *</label>
              <JalaliDateInput
                id={`${fieldId}-date`}
                value={formData.date}
                onChange={iso => updateForm(p => ({ ...p, date: iso }))}
                calendarPosition="bottom-right"
                className="w-full px-3 py-2 text-xs text-center bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                containerClassName="w-full"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-tracking-number`} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">شماره پیگیری</label>
            <input
              id={`${fieldId}-tracking-number`}
              type="text"
              value={formData.trackingNumber}
              onChange={e => updateForm(p => ({ ...p, trackingNumber: e.target.value }))}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              placeholder="اختیاری"
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-description`} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">توضیحات</label>
            <input
              id={`${fieldId}-description`}
              type="text"
              value={formData.description}
              onChange={e => updateForm(p => ({ ...p, description: e.target.value }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              placeholder="پیش‌فرض: انتقال وجه از ... به ..."
            />
          </div>

          {formError && (
            <p role="alert" className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{formError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت انتقال با سند حسابداری'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
