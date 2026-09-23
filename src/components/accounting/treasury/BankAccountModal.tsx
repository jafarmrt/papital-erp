import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Sparkles, Filter } from 'lucide-react';
import { AccountSearchSelect } from '../AccountSearchSelect';
import { formatCurrencyLabel } from '../../../utils';
import { fetchJson } from '../../../api';
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
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  const [autoCodeGenerated, setAutoCodeGenerated] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  // واکشی کد خودکار پیشنهادی برای حساب جدید بر اساس نوع
  const fetchNextCode = useCallback(async (accountType: 'bank' | 'cash' | 'pos') => {
    try {
      setIsLoadingCode(true);
      const res = await fetchJson<{ code: string }>(`/accounting/banks/next-code?type=${accountType}`);
      if (res && res.code) {
        setFormData(prev => ({ ...prev, code: res.code }));
        setAutoCodeGenerated(true);
      }
    } catch {
      // در صورت بروز خطا در شبکه، تولید کد محلی بر اساس پیشوند
      const prefix = accountType === 'cash' ? 'CASH' : accountType === 'pos' ? 'POS' : 'BANK';
      setFormData(prev => ({ ...prev, code: `${prefix}-01` }));
      setAutoCodeGenerated(true);
    } finally {
      setIsLoadingCode(false);
    }
  }, []);

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
      setAutoCodeGenerated(false);
      setShowAllAccounts(false);
    } else if (isOpen) {
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
      setAutoCodeGenerated(false);
      setShowAllAccounts(false);
      fetchNextCode('bank');
    }
  }, [editingBank, isOpen, fetchNextCode]);

  // هر بار که کاربر نوع حساب را تغییر داد و در حالت ایجاد بود، کد جدید متناسب واکشی شود
  const handleTypeChange = (newType: 'bank' | 'cash' | 'pos') => {
    setFormData(prev => ({ ...prev, type: newType }));
    if (!editingBank) {
      fetchNextCode(newType);
    }
  };

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

  // فیلتر هوشمند سرفصل‌های معین حسابداری متناسب با نوع حساب خزانه
  const treasuryAccountFilter = (acc: Account): boolean => {
    if (showAllAccounts) return true;
    const c = String(acc.code || '').trim();

    // اگر حساب انتخابی فعلی باشد، همیشه نمایش داده شود تا انتخاب کاربر حفظ شود
    if (formData.accountId && acc.id === formData.accountId) {
      return true;
    }

    if (formData.type === 'cash') {
      // سرفصل‌های صندوق و تنخواه‌گردان (1001، 1002، 1006) یا هر معینی زیر کل 10 که نام صندوق/نقد داشته باشد
      return c.startsWith('1001') || c.startsWith('1002') || c.startsWith('1006') || 
        (c.startsWith('10') && (acc.name.includes('صندوق') || acc.name.includes('نقد') || acc.name.includes('تنخواه')));
    } else if (formData.type === 'pos') {
      // دستگاه‌های کارتخوان (1005) یا زیرمجموعه کل 10 مرتبط با کارتخوان یا بانک
      return c.startsWith('1005') || c.startsWith('1003') || 
        (c.startsWith('10') && (acc.name.includes('کارتخوان') || acc.name.includes('POS') || acc.name.includes('بانک')));
    } else {
      // حساب‌های بانکی ریالی و ارزی (1003، 1004) یا زیرمجموعه کل 10 مرتبط با بانک
      return c.startsWith('1003') || c.startsWith('1004') || 
        (c.startsWith('10') && (acc.name.includes('بانک') || acc.name.includes('جاری') || acc.name.includes('سپرده')));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 dark:text-white text-base">
            {editingBank ? `ویرایش ${editingBank.title}` : 'تعریف حساب بانکی یا صندوق جدید'}
          </h3>
          {!editingBank && autoCodeGenerated && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Sparkles className="w-3 h-3" />
              کدگذاری خودکار
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                  کد حساب *
                </label>
                {!editingBank && (
                  <button
                    type="button"
                    onClick={() => fetchNextCode(formData.type)}
                    disabled={isLoadingCode}
                    title="تولید مجدد کد خودکار"
                    className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isLoadingCode ? 'animate-spin' : ''}`} />
                    کد جدید
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={formData.code}
                onChange={e => setFormData({ ...formData, code: e.target.value })}
                placeholder={isLoadingCode ? 'در حال دریافت...' : 'مثال: BANK-01'}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                نوع حساب
              </label>
              <select
                value={formData.type}
                onChange={e => handleTypeChange(e.target.value as any)}
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                اتصال به سرفصل کدینگ حسابداری (معین)
                {formData.initialBalance !== 0 && (
                  <span className="text-rose-500 mr-1">* (الزامی برای موجودی اولیه)</span>
                )}
              </label>
              <button
                type="button"
                onClick={() => setShowAllAccounts(!showAllAccounts)}
                className="text-[10px] text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                title="تغییر محدوده نمایش حساب‌ها"
              >
                <Filter className="w-2.5 h-2.5" />
                {showAllAccounts ? 'فیلتر حساب‌های مرتبط خزانه' : 'نمایش همه سرفصل‌ها'}
              </button>
            </div>
            <AccountSearchSelect
              accounts={safeAccounts}
              value={formData.accountId || ''}
              onChange={(val) => setFormData({ ...formData, accountId: val ? Number(val) : null })}
              filterFn={treasuryAccountFilter}
              placeholder={
                formData.type === 'cash'
                  ? 'جستجو در سرفصل‌های صندوق و نقد (کد ۱۰)...'
                  : formData.type === 'pos'
                  ? 'جستجو در سرفصل‌های پوز و کارتخوان (کد ۱۰)...'
                  : 'جستجو در سرفصل‌های بانک‌های ریالی/ارزی (کد ۱۰)...'
              }
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {showAllAccounts
                ? 'در حال حاضر همه سرفصل‌های کدینگ نمایش داده می‌شوند.'
                : `لیست به سرفصل‌های مرتبط با ${formData.type === 'cash' ? 'صندوق و نقد' : formData.type === 'pos' ? 'کارتخوان' : 'بانک'} (کل ۱۰) محدود شده است.`}
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
