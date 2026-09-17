import React, { useState, useEffect } from 'react';
import { AccountSearchSelect } from '../AccountSearchSelect';
import { formatCurrencyLabel } from '../../../utils';
import type { BankAccount, Account } from '../../../types';

interface BankAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBank: BankAccount | null;
  accounts: Account[];
  appCurrency: string;
  onSave: (data: any, editingId?: number) => Promise<void>;
}

export const BankAccountModal: React.FC<BankAccountModalProps> = ({
  isOpen,
  onClose,
  editingBank,
  accounts,
  appCurrency,
  onSave,
}) => {
  const [formData, setFormData] = useState({
    code: '',
    title: '',
    type: 'bank' as 'bank' | 'cash' | 'pos',
    bankName: '',
    branch: '',
    accountNumber: '',
    cardNumber: '',
    shebaNumber: '',
    initialBalance: 0,
    accountId: null as number | null,
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (editingBank) {
      setFormData({
        code: editingBank.code || '',
        title: editingBank.title || '',
        type: (editingBank.type as any) || 'bank',
        bankName: editingBank.bankName || '',
        branch: editingBank.branch || '',
        accountNumber: editingBank.accountNumber || '',
        cardNumber: editingBank.cardNumber || '',
        shebaNumber: editingBank.shebaNumber || '',
        initialBalance: editingBank.initialBalance || 0,
        accountId: editingBank.accountId || null,
      });
    } else {
      setFormData({
        code: '',
        title: '',
        type: 'bank',
        bankName: '',
        branch: '',
        accountNumber: '',
        cardNumber: '',
        shebaNumber: '',
        initialBalance: 0,
        accountId: null,
      });
    }
  }, [editingBank, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(formData, editingBank?.id);
      onClose();
    } catch {
      // Error handled in parent
    } finally {
      setIsSaving(false);
    }
  };

  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const curLbl = formatCurrencyLabel(appCurrency);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4">
          {editingBank ? `ویرایش ${editingBank.title}` : 'تعریف حساب بانکی یا صندوق جدید'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                کد حساب *
              </label>
              <input
                type="text"
                required
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                نوع حساب
              </label>
              <select
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
              >
                <option value="bank">حساب بانکی</option>
                <option value="cash">صندوق نقد کارگاه</option>
                <option value="pos">دستگاه کارتخوان (POS)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              عنوان حساب / صندوق *
            </label>
            <input
              type="text"
              required
              placeholder="مثال: حساب جاری ملت - کارگاه"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              اتصال به سرفصل کدینگ حسابداری (معین)
            </label>
            <AccountSearchSelect
              accounts={safeAccounts}
              value={formData.accountId || ''}
              onChange={(val) => setFormData({ ...formData, accountId: val ? Number(val) : null })}
              placeholder="جستجو و انتخاب سرفصل معین حسابداری..."
            />
            <p className="text-[10px] text-slate-400 mt-1">
              با اتصال حساب به کد معین، تمامی گردش‌های اسناد دوبل به صورت لحظه‌ای با این حساب تراز می‌شوند.
            </p>
          </div>

          {formData.type !== 'cash' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    نام بانک
                  </label>
                  <input
                    type="text"
                    placeholder="ملت، ملی، سامان..."
                    value={formData.bankName}
                    onChange={e => setFormData({ ...formData, bankName: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    شعبه
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: شعبه مرکزی"
                    value={formData.branch}
                    onChange={e => setFormData({ ...formData, branch: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  شماره کارت ۱۶ رقمی
                </label>
                <input
                  type="text"
                  placeholder="6037-xxxx-xxxx-xxxx"
                  value={formData.cardNumber}
                  onChange={e => setFormData({ ...formData, cardNumber: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono text-left"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  شماره شبا (IR)
                </label>
                <input
                  type="text"
                  placeholder="IR000000000000000000000000"
                  value={formData.shebaNumber}
                  onChange={e => setFormData({ ...formData, shebaNumber: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono text-left"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              {`موجودی اولیه (${curLbl})`}
            </label>
            <input
              type="number"
              value={formData.initialBalance}
              onChange={e => setFormData({ ...formData, initialBalance: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'در حال ثبت...' : 'ذخیره حساب'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
