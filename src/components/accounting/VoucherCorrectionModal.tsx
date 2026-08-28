import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Calendar, 
  Save, 
  X,
  Scale,
  Sparkles,
  ArrowRightLeft,
  AlertTriangle,
  History
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { Account, Customer, Personnel, JournalVoucher } from '../../types';
import { AccountSearchSelect } from './AccountSearchSelect';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

interface VoucherCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: JournalVoucher | null;
  accounts: Account[];
  customers: Customer[];
  personnelList: Personnel[];
  onCorrect: (voucherId: number, data: { reason: string; newItems: any[]; newDescription?: string; date?: string }) => Promise<void>;
}

interface VoucherItemDraft {
  id?: number;
  accountId: number | '';
  detailedType: 'none' | 'customer' | 'personnel' | 'project' | 'bank_account' | 'custom';
  detailedId: number | null;
  detailedName: string;
  debit: number;
  credit: number;
  description: string;
}

export function VoucherCorrectionModal({
  isOpen,
  onClose,
  voucher,
  accounts,
  customers,
  personnelList,
  onCorrect,
}: VoucherCorrectionModalProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

  const [date, setDate] = useState(() => getTodayJalaliDate());
  const [reason, setReason] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [items, setItems] = useState<VoucherItemDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (voucher && isOpen) {
      setDate(getTodayJalaliDate());
      setReason('');
      setNewDescription(voucher.description || '');
      if (voucher.items && Array.isArray(voucher.items) && voucher.items.length > 0) {
        setItems(voucher.items.map(it => ({
          accountId: it.accountId,
          detailedType: (it.detailedType as any) || 'none',
          detailedId: it.detailedId || null,
          detailedName: it.detailedName || '',
          debit: it.debit || 0,
          credit: it.credit || 0,
          description: it.description || '',
        })));
      } else {
        setItems([
          { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
          { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
        ]);
      }
    }
  }, [voucher, isOpen]);

  const selectableAccounts = useMemo(() => {
    return safeAccounts.filter(a => a.level === 'subsidiary' || a.level === 'detailed' || a.level === 'general');
  }, [safeAccounts]);

  const totalDebit = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.debit) || 0), 0);
  }, [items]);

  const totalCredit = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.credit) || 0), 0);
  }, [items]);

  const balanceDifference = Math.abs(totalDebit - totalCredit);
  const isBalanced = balanceDifference < 0.01 && totalDebit > 0;

  if (!isOpen || !voucher) return null;

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: newDescription || '' }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 2) {
      toast.error('حداقل دو ردیف برای سند حسابداری الزامی است');
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof VoucherItemDraft, value: any) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAutoBalance = () => {
    if (balanceDifference <= 0) return;
    if (totalDebit > totalCredit) {
      // Need credit
      setItems(prev => [
        ...prev,
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: balanceDifference, description: 'ردیف موازنه‌ساز' }
      ]);
    } else {
      // Need debit
      setItems(prev => [
        ...prev,
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: balanceDifference, credit: 0, description: 'ردیف موازنه‌ساز' }
      ]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('لطفاً دلیل و علت اصلاح سند را وارد فرمایید');
      return;
    }

    if (!isBalanced) {
      toast.error(`سند تراز نیست! اختلاف تراز: ${formatPersianPrice(balanceDifference, appCurrency)}`);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.accountId) {
        toast.error(`لطفاً حساب ردیف ${i + 1} را مشخص کنید`);
        return;
      }
      if ((it.debit || 0) === 0 && (it.credit || 0) === 0) {
        toast.error(`ردیف ${i + 1} دارای مبلغ صفر است`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onCorrect(voucher.id, {
        date: date.trim(),
        reason: reason.trim(),
        newDescription: newDescription.trim(),
        newItems: items.map(it => ({
          accountId: Number(it.accountId),
          detailedType: it.detailedType,
          detailedId: it.detailedId,
          detailedName: it.detailedName,
          debit: Number(it.debit) || 0,
          credit: Number(it.credit) || 0,
          description: it.description || newDescription,
        }))
      });
      onClose();
    } catch (err) {
      toast.error(err.message || 'خطا در صدور سند اصلاحی');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-850 w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>صدور سند اصلاحی جایگزین</span>
                <span className="text-xs font-mono bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
                  اصلاح سند شماره #{formatPersianNumber(voucher.voucherNumber)}
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تولید خودکار سند معکوس (عطف) و ثبت نسخه اصلاح‌شده به صورت کاملاً زنجیره‌ای و غیرقابل انکار.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Information Notice */}
          <div className="flex items-start gap-3 p-3.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl text-xs text-blue-900 dark:text-blue-200">
            <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold">فرایند استاندارد اصلاح سند (Reversal + Re-issue):</span> در حسابداری حرفه‌ای، سند دائم هرگز پاک یا بازنویسی نمی‌شود؛ با تایید این فرم:
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px] opacity-90">
                <li>یک سند معکوس (عطف) به صورت خودکار صادر شده تا سند قبلی را بی‌اثر کند.</li>
                <li>سند اصلاحی جدید با آرتیکل‌های زیر و ارجاع مستقیم به سند مبدا ثبت می‌گردد.</li>
              </ul>
            </div>
          </div>

          {/* Reason & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span>تاریخ اصلاحیه</span>
              </label>
              <DatePicker
                value={date}
                onChange={(dateObj: any) => {
                  setDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                containerClassName="w-full"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-500" />
                <span>علت و توجیه اصلاح سند (الزامی)</span>
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: تصحیح کد معین تفصیلی مشتری یا اصلاح مبلغ مالیات بر ارزش افزوده..."
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              شرح کلی سند جدید اصلاحی
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="شرح کامل سند جدید..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* New Items Editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-indigo-500" />
                <span>آرتیکل‌های جدید سند اصلاحی</span>
              </h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن ردیف جدید</span>
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[11px] border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2.5 px-2 w-8 text-center">#</th>
                    <th className="py-2.5 px-2 min-w-[200px]">حساب معین / تفصیلی</th>
                    <th className="py-2.5 px-2 min-w-[150px]">شرح ردیف</th>
                    <th className="py-2.5 px-2 w-32 text-left">{`بدهکار (${curLbl})`}</th>
                    <th className="py-2.5 px-2 w-32 text-left">{`بستانکار (${curLbl})`}</th>
                    <th className="py-2.5 px-2 w-10 text-center">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-2 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-2 px-2">
                        <div className="space-y-1.5">
                          <AccountSearchSelect
                            accounts={selectableAccounts}
                            value={item.accountId}
                            onChange={(accId) => handleItemChange(idx, 'accountId', accId)}
                            placeholder="انتخاب حساب..."
                          />
                          {/* Detailed Selector */}
                          <div className="flex items-center gap-1">
                            <select
                              value={item.detailedType}
                              onChange={(e) => {
                                const type = e.target.value as any;
                                handleItemChange(idx, 'detailedType', type);
                                handleItemChange(idx, 'detailedId', null);
                                handleItemChange(idx, 'detailedName', '');
                              }}
                              className="w-24 text-[10px] bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 text-slate-700 dark:text-slate-300"
                            >
                              <option value="none">بدون تفصیلی</option>
                              <option value="customer">مشتری</option>
                              <option value="personnel">پرسنل</option>
                              <option value="custom">سایر</option>
                            </select>

                            {item.detailedType === 'customer' && (
                              <select
                                value={item.detailedId || ''}
                                onChange={(e) => {
                                  const cId = Number(e.target.value);
                                  const cust = safeCustomers.find(c => c.id === cId);
                                  handleItemChange(idx, 'detailedId', cId || null);
                                  handleItemChange(idx, 'detailedName', cust?.name || '');
                                }}
                                className="flex-1 text-[10px] bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5"
                              >
                                <option value="">انتخاب مشتری...</option>
                                {safeCustomers.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            )}

                            {item.detailedType === 'personnel' && (
                              <select
                                value={item.detailedId || ''}
                                onChange={(e) => {
                                  const pId = Number(e.target.value);
                                  const p = safePersonnelList.find(x => x.id === pId);
                                  handleItemChange(idx, 'detailedId', pId || null);
                                  handleItemChange(idx, 'detailedName', p?.fullName || '');
                                }}
                                className="flex-1 text-[10px] bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5"
                              >
                                <option value="">انتخاب پرسنل...</option>
                                {safePersonnelList.map(p => (
                                  <option key={p.id} value={p.id}>{p.fullName || p.username}</option>
                                ))}
                              </select>
                            )}

                            {item.detailedType === 'custom' && (
                              <input
                                type="text"
                                value={item.detailedName}
                                onChange={(e) => handleItemChange(idx, 'detailedName', e.target.value)}
                                placeholder="عنوان تفصیلی..."
                                className="flex-1 text-[10px] bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5"
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                          placeholder="شرح ردیف..."
                          className="w-full text-xs bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded px-2 py-1"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0"
                          value={item.debit || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            handleItemChange(idx, 'debit', val);
                            if (val > 0) handleItemChange(idx, 'credit', 0);
                          }}
                          placeholder="0"
                          className="w-full text-xs text-left font-mono font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0"
                          value={item.credit || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            handleItemChange(idx, 'credit', val);
                            if (val > 0) handleItemChange(idx, 'debit', 0);
                          }}
                          placeholder="0"
                          className="w-full text-xs text-left font-mono font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/80 dark:bg-slate-800 font-bold border-t border-slate-200 dark:border-slate-700 text-xs">
                    <td colSpan={3} className="py-2.5 px-3 text-left">جمع کل آرتیکل‌ها:</td>
                    <td className="py-2.5 px-2 text-left font-mono text-slate-900 dark:text-white">
                      {formatPersianPrice(totalDebit)}
                    </td>
                    <td className="py-2.5 px-2 text-left font-mono text-slate-900 dark:text-white">
                      {formatPersianPrice(totalCredit)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Balance Status Banner */}
          <div className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-bold ${
            isBalanced 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              {isBalanced ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
              <span>
                {isBalanced 
                  ? 'سند کاملاً تراز است (بدهکار = بستانکار)' 
                  : `سند تراز نیست! اختلاف تراز: ${formatPersianPrice(balanceDifference, appCurrency)}`}
              </span>
            </div>

            {!isBalanced && (
              <button
                type="button"
                onClick={handleAutoBalance}
                className="flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] transition shadow-sm cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>تراز خودکار</span>
              </button>
            )}
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isBalanced}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-md shadow-blue-900/20 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSubmitting ? 'در حال صدور سند معکوس و اصلاحیه...' : 'تایید و صدور اسناد اصلاحی'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
