import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Calendar, 
  DollarSign, 
  Save, 
  X,
  Hash,
  Scale,
  Zap,
  ArrowRightLeft,
  Copy,
  Keyboard,
  HelpCircle,
  Sparkles,
  ChevronRight,
  Info
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { Account, Customer, Personnel, JournalVoucher, JournalVoucherItem } from '../../types';
import { AccountSearchSelect } from './AccountSearchSelect';
// V9 Phase 5.2: تایپ و جدول ردیف‌ها به کامپوننت VoucherItemsTable منتقل شد
import VoucherItemsTable, { VoucherItemDraft } from './VoucherItemsTable';
import { useServerDraft } from '../../hooks/useServerDraft';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

interface NewVoucherModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  customers: Customer[];
  personnelList: Personnel[];
  onSave: (data: any) => Promise<void>;
  editingVoucher?: JournalVoucher | null;
}

export function NewVoucherModal({
  isOpen,
  onClose,
  accounts,
  customers,
  personnelList,
  onSave,
  editingVoucher,
}: NewVoucherModalProps) {
  const appCurrency = useAppCurrency();
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

  const [date, setDate] = useState(() => getTodayJalaliDate());
  const [voucherType, setVoucherType] = useState<string>('general');
  const [manualVoucherNumber, setManualVoucherNumber] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('IRR');
  const [isSaving, setIsSaving] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Active focused row for keyboard actions
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);

  // Refs for keyboard focus control
  const itemRefs = useRef<Array<{
    accountRef?: React.RefObject<HTMLInputElement>;
    detailedTypeRef?: React.RefObject<HTMLSelectElement>;
    detailedSelectRef?: React.RefObject<HTMLSelectElement | HTMLInputElement>;
    descRef?: React.RefObject<HTMLInputElement>;
    debitRef?: React.RefObject<HTMLInputElement>;
    creditRef?: React.RefObject<HTMLInputElement>;
  }>>([]);

  const [items, setItems] = useState<VoucherItemDraft[]>([
    { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
    { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
  ]);

  // Server-backed draft auto-save hook
  const currentFormData = useMemo(() => ({
    date,
    voucherType,
    manualVoucherNumber,
    description,
    currency,
    items
  }), [date, voucherType, manualVoucherNumber, description, currency, items]);

  const {
    hasServerDraft,
    serverDraftData,
    draftUpdatedAt,
    draftStatusText,
    discardDraft,
    restoreDraft
  } = useServerDraft(currentFormData, {
    entityType: 'voucher',
    draftKey: editingVoucher ? `edit_${editingVoucher.id}` : 'new_voucher',
    enabled: isOpen && !editingVoucher,
    onDraftLoaded: (loaded) => {
      if (loaded.date) setDate(loaded.date);
      if (loaded.voucherType) setVoucherType(loaded.voucherType);
      if (loaded.manualVoucherNumber) setManualVoucherNumber(loaded.manualVoucherNumber);
      if (loaded.description) setDescription(loaded.description);
      if (loaded.currency) setCurrency(loaded.currency);
      if (Array.isArray(loaded.items) && loaded.items.length > 0) {
        setItems(loaded.items);
      }
    }
  });

  // Ensure refs array matches items length
  useEffect(() => {
    itemRefs.current = Array(items.length).fill(null).map((_, i) => itemRefs.current[i] || {
      accountRef: React.createRef<HTMLInputElement>(),
      detailedTypeRef: React.createRef<HTMLSelectElement>(),
      detailedSelectRef: React.createRef<HTMLSelectElement | HTMLInputElement>(),
      descRef: React.createRef<HTMLInputElement>(),
      debitRef: React.createRef<HTMLInputElement>(),
      creditRef: React.createRef<HTMLInputElement>(),
    });
  }, [items.length]);

  useEffect(() => {
    if (editingVoucher) {
      setDate(editingVoucher.date || '');
      setVoucherType(editingVoucher.voucherType || 'general');
      setManualVoucherNumber(editingVoucher.manualVoucherNumber || '');
      setDescription(editingVoucher.description || '');
      setCurrency(editingVoucher.currency || 'IRR');
      if (editingVoucher.items && Array.isArray(editingVoucher.items) && editingVoucher.items.length > 0) {
        setItems(editingVoucher.items.map(it => ({
          id: it.id,
          accountId: it.accountId,
          detailedType: it.detailedType || 'none',
          detailedId: it.detailedId || null,
          detailedName: it.detailedName || '',
          debit: it.debit || 0,
          credit: it.credit || 0,
          description: it.description || '',
        })));
      }
    } else {
      setDescription('');
      setManualVoucherNumber('');
      setItems([
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
      ]);
    }
  }, [editingVoucher, isOpen]);

  // Accounts for selection
  const selectableAccounts = useMemo(() => {
    return safeAccounts.filter(a => a.level === 'subsidiary' || a.level === 'detailed' || a.level === 'general');
  }, [safeAccounts]);

  const totalDebit = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.debit) || 0), 0);
  }, [items]);

  const totalCredit = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.credit) || 0), 0);
  }, [items]);

  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = totalDebit > 0 && difference === 0;
  const debitSurplus = totalDebit - totalCredit; // > 0 means debit is higher, need credit

  const addRow = (initialData?: Partial<VoucherItemDraft>) => {
    const newRowIndex = items.length;
    setItems(prev => [
      ...prev,
      {
        accountId: '',
        detailedType: 'none',
        detailedId: null,
        detailedName: '',
        debit: 0,
        credit: 0,
        description: description || '',
        ...initialData,
      }
    ]);
    setActiveRowIndex(newRowIndex);
    // Focus new row account input on next tick
    setTimeout(() => {
      itemRefs.current[newRowIndex]?.accountRef?.current?.focus();
    }, 50);
  };

  const removeRow = (index: number) => {
    if (items.length <= 2) {
      toast.error('سند حسابداری حداقل باید شامل دو آرتیکل (ردیف) باشد');
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
    if (activeRowIndex >= items.length - 1) {
      setActiveRowIndex(Math.max(0, items.length - 2));
    }
  };

  const updateItem = (index: number, patch: Partial<VoucherItemDraft>) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it;
      const updated = { ...it, ...patch };

      // If user sets debit, reset credit and vice versa
      if ('debit' in patch && (patch.debit || 0) > 0) {
        updated.credit = 0;
      } else if ('credit' in patch && (patch.credit || 0) > 0) {
        updated.debit = 0;
      }

      return updated;
    }));
  };

  // Auto-balance targeted row or active row
  const handleAutoBalanceRow = (targetIndex: number) => {
    if (isBalanced) {
      toast.success('سند هم‌اکنون کاملاً تراز است');
      return;
    }

    // Calculate sum of all other rows
    let otherDebit = 0;
    let otherCredit = 0;
    items.forEach((it, idx) => {
      if (idx !== targetIndex) {
        otherDebit += Number(it.debit) || 0;
        otherCredit += Number(it.credit) || 0;
      }
    });

    const diff = otherDebit - otherCredit;
    if (diff > 0) {
      // Debit is higher, this row should be Credit
      updateItem(targetIndex, { credit: diff, debit: 0 });
      toast.success(`ردیف شماره ${targetIndex + 1} با مبلغ ${formatPersianPrice(diff, appCurrency)} بستانکار تراز شد`);
    } else if (diff < 0) {
      // Credit is higher, this row should be Debit
      updateItem(targetIndex, { debit: Math.abs(diff), credit: 0 });
      toast.success(`ردیف شماره ${targetIndex + 1} با مبلغ ${formatPersianPrice(Math.abs(diff), appCurrency)} بدهکار تراز شد`);
    } else {
      toast.success('سند تراز شد');
    }
  };

  // Add auto-balancing row with 1-click
  const handleAddBalancingRow = () => {
    if (isBalanced) {
      toast.success('سند هم‌اکنون کاملاً تراز است');
      return;
    }

    if (debitSurplus > 0) {
      // Debit higher, need credit row
      addRow({ credit: debitSurplus, debit: 0, description: description || '' });
      toast.success(`سطر جدید با مبلغ ${formatPersianPrice(debitSurplus)} بستانکار جهت تراز سند اضافه شد`);
    } else if (debitSurplus < 0) {
      // Credit higher, need debit row
      addRow({ debit: Math.abs(debitSurplus), credit: 0, description: description || '' });
      toast.success(`سطر جدید با مبلغ ${formatPersianPrice(Math.abs(debitSurplus))} بدهکار جهت تراز سند اضافه شد`);
    }
  };

  // Swap debit and credit for active row
  const handleSwapDebitCredit = (index: number) => {
    const it = items[index];
    if (!it) return;
    if (it.debit > 0) {
      updateItem(index, { debit: 0, credit: it.debit });
      toast.success(`ردیف ${index + 1} به بستانکار تبدیل شد`);
    } else if (it.credit > 0) {
      updateItem(index, { debit: it.credit, credit: 0 });
      toast.success(`ردیف ${index + 1} به بدهکار تبدیل شد`);
    }
  };

  // Copy main description to row
  const handleCopyHeaderDesc = (index: number) => {
    if (!description) {
      toast.error('شرح کلی سند خالی است');
      return;
    }
    updateItem(index, { description });
    toast.success('شرح سند در این ردیف درج شد');
  };

  // Global Keyboard Shortcuts handler inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Check if saving shortcut: Ctrl+S or Ctrl+Enter
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) {
        e.preventDefault();
        if (isBalanced && description.trim()) {
          submitVoucher();
        } else if (!isBalanced) {
          toast.error(`سند تراز نیست! اختلاف: ${formatPersianPrice(difference, appCurrency)}`);
        } else {
          toast.error('لطفاً شرح سند را تکمیل نمایید');
        }
        return;
      }

      // Alt+B or Alt+Shift+B: Auto-balance active row or add balancing row
      if (e.altKey && (e.key === 'b' || e.key === 'B' || e.key === 'ذ')) {
        e.preventDefault();
        if (activeRowIndex >= 0 && activeRowIndex < items.length) {
          handleAutoBalanceRow(activeRowIndex);
        } else {
          handleAddBalancingRow();
        }
        return;
      }

      // Alt+N or Insert: Add new row
      if ((e.altKey && (e.key === 'n' || e.key === 'N' || e.key === 'د')) || e.key === 'Insert') {
        e.preventDefault();
        addRow();
        return;
      }

      // Alt+D or Ctrl+Delete: Delete active row
      if ((e.altKey && (e.key === 'd' || e.key === 'D' || e.key === 'ی')) || (e.ctrlKey && e.key === 'Delete')) {
        e.preventDefault();
        if (activeRowIndex >= 0 && activeRowIndex < items.length) {
          removeRow(activeRowIndex);
        }
        return;
      }

      // Alt+R: Swap debit/credit of active row
      if (e.altKey && (e.key === 'r' || e.key === 'R' || e.key === 'ق')) {
        e.preventDefault();
        if (activeRowIndex >= 0 && activeRowIndex < items.length) {
          handleSwapDebitCredit(activeRowIndex);
        }
        return;
      }

      // Alt+C: Copy header desc to active row
      if (e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'ز')) {
        e.preventDefault();
        if (activeRowIndex >= 0 && activeRowIndex < items.length) {
          handleCopyHeaderDesc(activeRowIndex);
        }
        return;
      }

      // Escape key to close shortcuts panel or close modal if handled
      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, isBalanced, description, activeRowIndex, items, difference, showShortcutsHelp]);

  const isPermanentVoucher = editingVoucher?.status === 'permanent';

  const submitVoucher = async () => {
    if (isPermanentVoucher) {
      toast.error('اسناد دائم و قطعی‌شده قابل ویرایش مستقیم نیستند. از گزینه صدور سند معکوس یا اصلاحی استفاده کنید.');
      return;
    }

    if (!description.trim()) {
      toast.error('شرح کلی سند الزامی است');
      return;
    }

    if (!isBalanced) {
      toast.error(`سند تراز نیست! اختلاف بدهکار و بستانکار: ${formatPersianPrice(difference, appCurrency)}`);
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.accountId) {
        toast.error(`حساب ردیف شماره ${i + 1} مشخص نشده است`);
        itemRefs.current[i]?.accountRef?.current?.focus();
        return;
      }
      if ((it.debit || 0) <= 0 && (it.credit || 0) <= 0) {
        toast.error(`مبلغ بدهکار یا بستانکار ردیف ${i + 1} باید بزرگتر از صفر باشد`);
        itemRefs.current[i]?.debitRef?.current?.focus();
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = {
        date,
        voucherType,
        manualVoucherNumber,
        description,
        currency,
        items: items.map(it => ({
          accountId: Number(it.accountId),
          detailedType: it.detailedType,
          detailedId: it.detailedId,
          detailedName: it.detailedName,
          debit: Number(it.debit) || 0,
          credit: Number(it.credit) || 0,
          description: it.description || description,
        }))
      };

      await onSave(payload);
      if (!editingVoucher) {
        await discardDraft();
      }
      toast.success(editingVoucher ? 'سند حسابداری به‌روزرسانی شد' : 'سند حسابداری با موفقیت ثبت شد');
      onClose();
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت سند حسابداری');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitVoucher();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[94vh] flex flex-col border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/60 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {editingVoucher ? `ویرایش سند حسابداری شماره ${formatPersianNumber(editingVoucher.voucherNumber)}` : 'فرم ثبت سریع سند حسابداری دوطرفه (دوبل)'}
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  ورود سریع کیبورد محور
                </span>
                {draftStatusText && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 animate-pulse">
                    {draftStatusText}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                ثبت آنی آرتیکل‌ها با کلیدهای میانبر، جستجوی کد معین و تراز خودکار لحظه‌ای
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowShortcutsHelp(!showShortcutsHelp)}
              title="راهنمای کلیدهای میانبر کیبورد"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition border ${
                showShortcutsHelp 
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700' 
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">راهنمای کلیدها</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Server Draft Recovery Banner */}
        {hasServerDraft && (
          <div className="bg-blue-50 dark:bg-blue-950/40 border-b border-blue-200 dark:border-blue-800 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-blue-900 dark:text-blue-200">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>یک پیش‌نویس ذخیره‌شده در سرور برای این سند وجود دارد. مایل به بازیابی هستید؟</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={restoreDraft}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-xs transition"
              >
                بازیابی پیش‌نویس
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg border border-slate-300 dark:border-slate-600 text-xs transition"
              >
                نادیده گرفتن
              </button>
            </div>
          </div>
        )}

        {/* Shortcuts Cheat Sheet Drawer / Banner */}
        {showShortcutsHelp && (
          <div className="bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 p-3 sm:px-6 text-xs text-amber-900 dark:text-amber-200 animate-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 font-bold">
                <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>کلیدهای میانبر ورود سریع و فوق‌سریع سند:</span>
              </div>
              <button 
                onClick={() => setShowShortcutsHelp(false)}
                className="text-xs text-amber-700 hover:text-amber-900 dark:hover:text-amber-100 underline"
              >
                بستن راهنما
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1 font-mono text-[11px]">
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Ctrl + S</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">ثبت قطعی سند</span>
              </div>
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-amber-600 dark:text-amber-400">Alt + B</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">تراز خودکار سطر</span>
              </div>
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-emerald-600 dark:text-emerald-400">Alt + N / Insert</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">افزودن سطر جدید</span>
              </div>
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-rose-600 dark:text-rose-400">Alt + D</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">حذف سطر جاری</span>
              </div>
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-purple-600 dark:text-purple-400">Alt + R</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">جابجایی بدهکار/بستانکار</span>
              </div>
              <div className="bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="font-bold text-blue-600 dark:text-blue-400">Space در خانه خالی</span>
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">درج مانده موازنه‌کننده</span>
              </div>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Permanent Voucher Warning */}
          {isPermanentVoucher && (
            <div className="flex items-start gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200">
              <AlertCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold">سند حسابداری دائم و قطعی‌شده:</span> این سند به دلیل وضعیت دائم (Permanent) قابل ویرایش یا حذف مستقیم نیست. جهت تعدیل مالی، لطفاً از دکمه‌های «صدور سند معکوس (عطف)» یا «صدور سند اصلاحی» در جدول اسناد استفاده فرمایید.
              </div>
            </div>
          )}

          {/* Top Form Header Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                تاریخ سند *
              </label>
              <DatePicker
                value={date}
                onChange={(dateObj: any) => {
                  setDate(extractDateString(dateObj));
                }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                inputClass="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                containerClassName="w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                نوع سند
              </label>
              <select
                value={voucherType}
                onChange={e => setVoucherType(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="general">عمومی / عادی</option>
                <option value="sales">فروش و درآمد</option>
                <option value="purchase">خرید و انبار</option>
                <option value="treasury">دریافت و پرداخت</option>
                <option value="payroll">حقوق و دستمزد</option>
                <option value="closing">افتتاحیه / اختتامیه</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                شماره عطف دستی (اختیاری)
              </label>
              <input
                type="text"
                value={manualVoucherNumber}
                onChange={e => setManualVoucherNumber(e.target.value)}
                placeholder="مثال: سند فیزیکی ۹۸"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                واحد پولی
              </label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="IRR">ریال (IRR)</option>
                <option value="TOMAN">تومان</option>
                <option value="USD">دلار ($)</option>
                <option value="EUR">یورو (€)</option>
                <option value="AED">درهم (AED)</option>
              </select>
            </div>

            <div className="sm:col-span-2 md:col-span-4">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                شرح کلی سند حسابداری *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="مثال: ثبت و شناسایی هزینه‌های تولید و پرداخت تنخواه مهر ماه..."
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
                />
                {description && (
                  <button
                    type="button"
                    onClick={() => {
                      setItems(prev => prev.map(it => ({ ...it, description: it.description || description })));
                      toast.success('شرح سند به تمام سطرهای خالی اعمال شد');
                    }}
                    title="اعمال شرح کلی به تمام سطرهای خالی"
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Copy className="w-3 h-3" />
                    <span>کپی در همه سطرها</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Dynamic Voucher Items Grid & Quick Action Bar */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  آرتیکل‌ها و ردیف‌های سند ({items.length} سطر)
                </h4>
                {!isBalanced && (
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                    مابه‌التفاوت: {formatPersianPrice(difference)} {currency}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isBalanced && (
                  <button
                    type="button"
                    onClick={handleAddBalancingRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition shadow-xs animate-pulse"
                    title="افزودن سطر جدید حاوی دقیقاً مبلغ موازنه‌کننده (Alt+B)"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>افزودن سطر موازنه‌کننده ({formatPersianPrice(difference)})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => addRow()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-xs"
                  title="کلید میانبر: Alt+N یا Insert"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>سطر جدید (Alt+N)</span>
                </button>
              </div>
            </div>

            {/* V9 Phase 5.2: جدول ردیف‌های سند استخراج‌شده */}
            <VoucherItemsTable
              items={items}
              selectableAccounts={selectableAccounts}
              customers={safeCustomers}
              personnelList={safePersonnelList}
              currencyLabel={currency}
              updateItem={updateItem}
              addRow={addRow}
              removeRow={removeRow}
              handleAutoBalanceRow={handleAutoBalanceRow}
              handleSwapDebitCredit={handleSwapDebitCredit}
              rowRefs={itemRefs}
            />
          </div>

          {/* Dynamic Balance Status & Action Banner */}
          <div className={`p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border transition-all ${
            isBalanced 
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' 
              : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                isBalanced 
                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400' 
                  : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400'
              }`}>
                {isBalanced ? <CheckCircle2 className="w-5 h-5" /> : <Scale className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-xs font-bold">
                  {isBalanced ? 'سند کاملاً تراز است و آماده ثبت نهایی می‌باشد' : 'سند حسابداری هنوز تراز نیست!'}
                </div>
                {!isBalanced && (
                  <div className="text-[11px] opacity-90 mt-0.5">
                    مابه‌التفاوت بدهکار و بستانکار: <strong className="font-mono text-rose-600 dark:text-rose-400">{formatPersianPrice(difference)} {currency}</strong>
                    {debitSurplus > 0 ? ' (بدهکار بیشتر است)' : ' (بستانکار بیشتر است)'}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {!isBalanced && (
                <button
                  type="button"
                  onClick={handleAddBalancingRow}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>تراز خودکار با سطر جدید</span>
                </button>
              )}

              <div className="text-left font-mono text-xs font-bold px-3 py-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                {isBalanced ? 'تراز: ۱۰۰٪' : `اختلاف: ${formatPersianPrice(difference)}`}
              </div>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span>راهنما: برای ثبت سریع از <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px] text-slate-800 dark:text-slate-200">Ctrl + S</kbd> و برای تراز خودکار از <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px] text-slate-800 dark:text-slate-200">Alt + B</kbd> استفاده کنید.</span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isSaving || !isBalanced || isPermanentVoucher}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition shadow-md disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>
                  {isSaving 
                    ? 'در حال ثبت...' 
                    : isPermanentVoucher 
                      ? 'سند دائم (غیرقابل ویرایش)' 
                      : (editingVoucher ? 'به‌روزرسانی سند' : 'ثبت قطعی سند (Ctrl+S)')
                  }
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
