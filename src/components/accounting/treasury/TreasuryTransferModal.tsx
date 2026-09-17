import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { formatPersianPrice, extractDateString } from '../../../utils';
import { fetchJson } from '../../../api';
import type { BankAccount } from '../../../types';

interface TreasuryTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: BankAccount[];
  appCurrency: string;
  onSave: (data: any) => Promise<void>;
}

export const TreasuryTransferModal: React.FC<TreasuryTransferModalProps> = ({
  isOpen,
  onClose,
  bankAccounts,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    fromBankAccountId: null as number | null,
    toBankAccountId: null as number | null,
    amount: 0,
    date: '',
    trackingNumber: '',
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);

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
        // fallback: تاریخ مرورگر فقط در خطای شبکه (رفتار قدیمی)
        if (!cancelled) {
          setFormData(p => (p.date ? p : { ...p, date: new Date().toISOString().slice(0, 10) }));
        }
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setFormData({
        fromBankAccountId: null,
        toBankAccountId: null,
        amount: 0,
        date: '',
        trackingNumber: '',
        description: '',
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fromBankAccountId || !formData.toBankAccountId) {
      alert('لطفاً حساب‌های مبدأ و مقصد را انتخاب کنید.');
      return;
    }
    if (formData.fromBankAccountId === formData.toBankAccountId) {
      alert('حساب مبدأ و مقصد نمی‌توانند یکسان باشند.');
      return;
    }
    if (formData.amount <= 0) {
      alert('مبلغ انتقال باید بزرگ‌تر از صفر باشد.');
      return;
    }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-amber-600" />
            انتقال وجه بین حساب‌ها و صندوق‌ها
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              از حساب / صندوق (مبدأ) *
            </label>
            <select
              required
              value={formData.fromBankAccountId || ''}
              onChange={e => setFormData(p => ({ ...p, fromBankAccountId: Number(e.target.value) || null }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
            >
              <option value="">انتخاب مبدأ...</option>
              {safeBankAccounts.map(b => (
                <option key={b.id} value={b.id}>
                  {b.title} — مانده: {formatPersianPrice(b.currentBalance)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              به حساب / صندوق (مقصد) *
            </label>
            <select
              required
              value={formData.toBankAccountId || ''}
              onChange={e => setFormData(p => ({ ...p, toBankAccountId: Number(e.target.value) || null }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
            >
              <option value="">انتخاب مقصد...</option>
              {safeBankAccounts
                .filter(b => b.id !== formData.fromBankAccountId)
                .map(b => (
                  <option key={b.id} value={b.id}>
                    {b.title} — مانده: {formatPersianPrice(b.currentBalance)}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">مبلغ *</label>
              <input
                type="number"
                min="1"
                required
                value={formData.amount || ''}
                onChange={e => setFormData(p => ({ ...p, amount: Number(e.target.value) || 0 }))}
                className="w-full px-3 py-2 text-xs font-mono text-left bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تاریخ *</label>
              <DatePicker
                value={formData.date}
                onChange={(d: any) => setFormData(p => ({ ...p, date: extractDateString(d) }))}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-2 text-xs text-center bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                containerClassName="w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">شماره پیگیری</label>
            <input
              type="text"
              value={formData.trackingNumber}
              onChange={e => setFormData(p => ({ ...p, trackingNumber: e.target.value }))}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              placeholder="اختیاری"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">توضیحات</label>
            <input
              type="text"
              value={formData.description}
              onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              placeholder="پیش‌فرض: انتقال وجه از ... به ..."
            />
          </div>

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
              {isSaving ? 'در حال ثبت...' : 'ثبت انتقال با سند دوبل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
