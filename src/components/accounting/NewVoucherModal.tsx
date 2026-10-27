import React, { useState, useMemo, useEffect, useEffectEvent, useRef, useId } from 'react';
import { Plus, CheckCircle2, AlertCircle, FileText, Save, X, Scale, Zap, Copy, Keyboard, Sparkles } from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, getTodayIsoDate, toStorageDate, errorMessageOf, toPersianDigits } from '../../utils';
import type { Account, Customer, Personnel, JournalVoucher, FinancialAttachment } from '../../types';
// V9 Phase 5.2: تایپ و جدول ردیف‌ها به کامپوننت VoucherItemsTable منتقل شد
import VoucherItemsTable, { VoucherItemDraft } from './VoucherItemsTable';
import {
  voucherBalancingAmount, voucherFormBalance, voucherFormCurrency, voucherHeaderRateFromRows, voucherRowCurrencyRate,
  voucherRowDraftFromStored, withVoucherRowCurrency, type VoucherHeaderCurrency,
} from '../../lib/accounting/voucherFormCurrency';
import { VoucherHeaderCurrencyFields } from './VoucherCurrencyInputs';
import { voucherDetailedTypeFromStored } from '../../lib/accounting/voucherDetailedTypes';
import { manualVoucherFormType } from '../../lib/accounting/manualVoucherRules';
import { FinancialAttachmentUploader } from './FinancialAttachmentUploader';
import { useServerDraft } from '../../hooks/useServerDraft';
import toast from 'react-hot-toast';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { postingAccountsOf } from '../../lib/accounting/postingAccount';
import { DialogLayer } from '../common/DialogLayer';
import { useDialogEscape } from '../../lib/a11y/dialogEscapeStack';
import { withFreshRowKeys, withoutRowKey, withRowKey, withRowKeys } from '../../lib/rowKey';
import { CONTROL_REASON_REQUIRED_MESSAGE, controlAccountRefusalMessage } from '../../lib/accounting/controlAccounts';
import { ControlAccountNotice, useControlAccountRows } from './vouchers/ControlAccountNotice';

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
  const fieldId = useId();
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

  // v9.0.196 (TD-578): تاریخ ISO نگه داشته و با JalaliDateInput شمسی نشان داده می‌شود (پیش‌تر ویرایش «۲۰۲۶/۰۴/۰۱» نشان می‌داد)
  const [date, setDate] = useState(() => getTodayIsoDate());
  const [voucherType, setVoucherType] = useState<string>('general');
  const [manualVoucherNumber, setManualVoucherNumber] = useState('');
  const [description, setDescription] = useState('');
  // v11 phase 6.1b (M3): the reason of a row on a control account, stored on the voucher
  const [controlReason, setControlReason] = useState('');
  const controlReasonRef = useRef<HTMLTextAreaElement>(null);
  const [currency, setCurrency] = useState('IRR');
  // v9.0.191 (TD-564): نرخ ارز سند به ریال؛ ردیف هم‌ارز سند بی نرخ خودش این نرخ را می‌گیرد
  const [headerRate, setHeaderRate] = useState<number | string | ''>('');
  const header = useMemo<VoucherHeaderCurrency>(() => ({ currency, rate: headerRate }), [currency, headerRate]);
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  // Esc closes the shortcuts panel before the voucher window
  useDialogEscape(() => setShowShortcutsHelp(false), isOpen && showShortcutsHelp);

  // Active focused row for keyboard actions
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);

  const formRef = useRef<HTMLFormElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  // Refs for keyboard focus control
  const itemRefs = useRef<Array<{
    accountRef?: React.RefObject<HTMLInputElement>;
    detailedTypeRef?: React.RefObject<HTMLSelectElement>;
    detailedSelectRef?: React.RefObject<HTMLSelectElement | HTMLInputElement>;
    descRef?: React.RefObject<HTMLInputElement>;
    debitRef?: React.RefObject<HTMLInputElement>;
    creditRef?: React.RefObject<HTMLInputElement>;
  }>>([]);

  const [items, setItems] = useState<VoucherItemDraft[]>(() => withRowKeys<VoucherItemDraft>([
    { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
    { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
  ]));

  // Server-backed draft auto-save hook
  const currentFormData = useMemo(() => ({
    date,
    voucherType,
    manualVoucherNumber,
    description,
    controlReason,
    currency,
    headerRate,
    attachments,
    // v10.2.4 (TD-1291): کلید ردیف فقط در مرورگر است و در پیش‌نویس ذخیره نمی‌شود
    items: items.map(withoutRowKey)
  }), [date, voucherType, manualVoucherNumber, description, controlReason, currency, headerRate, attachments, items]);

  const {
    hasServerDraft,
    draftStatusText,
    discardDraft,
    restoreDraft
  } = useServerDraft(currentFormData, {
    entityType: 'voucher',
    draftKey: editingVoucher ? `edit_${editingVoucher.id}` : 'new_voucher',
    enabled: isOpen && !editingVoucher,
    onDraftLoaded: (loaded) => {
      if (loaded.date) setDate(toStorageDate(loaded.date) || getTodayIsoDate());
      if (loaded.voucherType) setVoucherType(manualVoucherFormType(loaded.voucherType));
      if (loaded.manualVoucherNumber) setManualVoucherNumber(loaded.manualVoucherNumber);
      if (loaded.description) setDescription(loaded.description);
      if (typeof loaded.controlReason === 'string') setControlReason(loaded.controlReason);
      if (loaded.currency) setCurrency(supportedVoucherCurrency(loaded.currency));
      setHeaderRate(loaded.headerRate ?? '');
      if (Array.isArray(loaded.attachments)) setAttachments(loaded.attachments);
      if (Array.isArray(loaded.items) && loaded.items.length > 0) {
        // v9.0.193 (TD-569): پیش‌نویس قدیمی «متفرقه» را `custom` نگه داشته بود
        setItems(withFreshRowKeys((loaded.items as VoucherItemDraft[]).map(it => ({ ...it, detailedType: voucherDetailedTypeFromStored(it.detailedType) }))));
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
      setDate(toStorageDate(editingVoucher.date) || '');
      // v9.0.160 (TD-559): سند دستی قدیمی از نوع اختتامیه در فرم «افتتاحیه» است؛ اختتامیه را فقط بستن سال صادر می‌کند
      setVoucherType(manualVoucherFormType(editingVoucher.voucherType));
      setManualVoucherNumber(editingVoucher.manualVoucherNumber || '');
      setDescription(editingVoucher.description || '');
      setControlReason(editingVoucher.controlReason || '');
      // v9.0.191 (TD-564): ارز و نرخ سند و هر ردیف همان که ذخیره شده می‌ماند (پیش‌تر ویرایش آن‌ها را می‌انداخت)
      const editCurrency = supportedVoucherCurrency(editingVoucher.currency);
      const editHeader = { currency: editCurrency, rate: voucherHeaderRateFromRows(editingVoucher.items, editCurrency) };
      setCurrency(editHeader.currency);
      setHeaderRate(editHeader.rate);
      setAttachments(Array.isArray(editingVoucher.attachments) ? editingVoucher.attachments : []);
      if (editingVoucher.items && Array.isArray(editingVoucher.items) && editingVoucher.items.length > 0) {
        setItems(withFreshRowKeys(editingVoucher.items.map(it => ({
          ...voucherRowDraftFromStored({ currency: it.currency, exchangeRate: it.exchangeRate ?? it.exchange_rate }, editHeader),
          id: it.id,
          accountId: it.accountId,
          detailedType: voucherDetailedTypeFromStored(it.detailedType),
          detailedId: it.detailedId || null,
          detailedName: it.detailedName || '',
          debit: it.debit || 0,
          credit: it.credit || 0,
          description: it.description || '',
        }))));
      }
    } else {
      setDescription('');
      setControlReason('');
      setManualVoucherNumber('');
      setAttachments([]);
      setItems(withRowKeys<VoucherItemDraft>([
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
        { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' },
      ]));
    }
  }, [editingVoucher, isOpen]);

  // v9.0.198 (TD-549، B03-07): فقط حساب قابل ثبت (فعال، معین یا تفصیلی، بی زیرحساب فعال)؛ پیش‌تر حساب کل هم بود
  const selectableAccounts = useMemo(() => postingAccountsOf(safeAccounts), [safeAccounts]);

  // v7.0.76 (P3-6): جمع اعشاری دقیق و تلورانس سرور. v9.0.191 (TD-564): با ارز و نرخ هر ردیف؛ سند چندارزی یا چندنرخی به ریال
  const balance = useMemo(() => voucherFormBalance(items, header), [items, header]);
  const { difference, isBalanced } = balance;
  const control = useControlAccountRows(items.map(it => it.accountId), isOpen);
  const debitSurplus = balance.totalDebit - balance.totalCredit;
  const rowsWithoutRateText = toPersianDigits(balance.rowsWithoutRate.join('، '));

  const addRow = (initialData?: Partial<VoucherItemDraft>) => {
    const newRowIndex = items.length;
    setItems(prev => [
      ...prev,
      withRowKey<VoucherItemDraft>({
        accountId: '',
        detailedType: 'none',
        detailedId: null,
        detailedName: '',
        debit: 0,
        credit: 0,
        description: description || '',
        ...initialData,
        rowKey: undefined,
      })
    ]);
    setActiveRowIndex(newRowIndex);
    // Focus new row account input on next tick
    setTimeout(() => {
      itemRefs.current[newRowIndex]?.accountRef?.current?.focus();
    }, 50);
  };

  const removeRow = (index: number) => {
    if (items.length <= 2) {
      toast.error('سند حسابداری دست‌کم دو ردیف لازم دارد');
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
  // v9.0.191 (TD-564): مبلغ موازنه با قاعده تراز سرور؛ در سند چندارزی اختلاف ریالی بر نرخ همان ردیف
  const applyBalancing = (rows: VoucherItemDraft[], targetIndex: number, apply: (side: 'debit' | 'credit', amount: number) => void) => {
    const result = voucherBalancingAmount(rows, targetIndex, header);
    if (result.kind === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.kind === 'balanced') {
      toast.success('سند تراز شد');
      return;
    }
    apply(result.side, result.amount);
    const rowCurrency = voucherRowCurrencyRate(rows[targetIndex], header).currency;
    toast.success(`ردیف شماره ${toPersianDigits(String(targetIndex + 1))} با مبلغ ${formatPersianPrice(result.amount, rowCurrency)} ${result.side === 'debit' ? 'بدهکار' : 'بستانکار'} تراز شد`);
  };

  const handleAutoBalanceRow = (targetIndex: number) => {
    if (isBalanced) {
      toast.success('سند هم‌اکنون کاملاً تراز است');
      return;
    }
    applyBalancing(items, targetIndex, (side, amount) => updateItem(targetIndex, side === 'debit' ? { debit: amount, credit: 0 } : { credit: amount, debit: 0 }));
  };

  // Add auto-balancing row with 1-click
  const handleAddBalancingRow = () => {
    if (isBalanced) {
      toast.success('سند هم‌اکنون کاملاً تراز است');
      return;
    }
    const newRow: VoucherItemDraft = { accountId: '', detailedType: 'none', detailedId: null, detailedName: '', debit: 0, credit: 0, description: description || '' };
    applyBalancing([...items, newRow], items.length, (side, amount) => addRow(side === 'debit' ? { ...newRow, debit: amount } : { ...newRow, credit: amount }));
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
  // 10.3 (ARCH review finding 4): the window listener calls the handler of the latest render, so Ctrl+S sends the date,
  // type, reference number and attachments on screen and Alt+R / Alt+C act on the rows on screen. Before, the listener kept
  // the functions of the render that last changed a row or the description, so a date changed last went out with its old value.
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Check if saving shortcut: Ctrl+S or Ctrl+Enter
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) {
      e.preventDefault();
      // v10.2.4 (TD-1291): میان‌بر هم مانند دکمه ثبت، فرمی را که کادر نادرست دارد نمی‌فرستد
      const form = formRef.current;
      if (form && !form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (isBalanced && description.trim()) {
        void submitVoucher();
      } else if (!isBalanced) {
        toast.error(balance.rowsWithoutRate.length > 0 ? `نرخ تبدیل ردیف ${rowsWithoutRateText} به ریال را وارد کنید` : `سند تراز نیست! اختلاف: ${formatPersianPrice(difference, balance.currency)}`);
      } else {
        refuseEmptyDescription();
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
  };
  const onShortcutKey = useEffectEvent(handleGlobalKeyDown);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => onShortcutKey(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const isPermanentVoucher = editingVoucher?.status === 'permanent';

  // One save at a time: a second Ctrl+S or Ctrl+Enter before the first answer sent the voucher again (backlog: Ctrl+S
  // double save). A ref, not `isSaving`, because two key presses can land before React draws the saving state.
  const savingRef = useRef(false);

  // 10.3 package 4 (10.2 backlog): an empty description is told in Persian and the field takes the focus; the field is no
  // longer `required`, whose check showed the browser's own bubble on Ctrl+S (the validity check stays for amount fields)
  const refuseEmptyDescription = () => {
    toast.error('شرح کلی سند الزامی است');
    descriptionRef.current?.focus();
  };

  const submitVoucher = async () => {
    if (savingRef.current) return;
    if (isPermanentVoucher) {
      toast.error('اسناد دائم و قطعی‌شده قابل ویرایش مستقیم نیستند. از گزینه صدور سند معکوس یا اصلاحی استفاده کنید.');
      return;
    }

    if (!description.trim()) {
      refuseEmptyDescription();
      return;
    }

    if (balance.rowsWithoutRate.length > 0) {
      toast.error(`نرخ تبدیل ردیف ${rowsWithoutRateText} به ریال را وارد کنید؛ ردیف غیرریالی بی نرخ ثبت نمی‌شود`);
      return;
    }

    if (!isBalanced) {
      toast.error(`سند تراز نیست! اختلاف بدهکار و بستانکار: ${formatPersianPrice(difference, balance.currency)}`);
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

    if (control.hits.length > 0 && !control.mayAdjust) {
      toast.error(controlAccountRefusalMessage(control.hits, toPersianDigits), { duration: 8000 });
      return;
    }
    if (control.hits.length > 0 && !controlReason.trim()) {
      toast.error(CONTROL_REASON_REQUIRED_MESSAGE);
      controlReasonRef.current?.focus();
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const payload = {
        date,
        voucherType,
        manualVoucherNumber,
        description,
        // the server keeps it only when a row is on a control account
        ...(controlReason.trim() ? { controlReason: controlReason.trim() } : {}),
        currency,
        attachments,
        // v9.0.191 (TD-564): هر ردیف با ارز و نرخ قطعی خود (ردیف ریالی بی نرخ)
        items: withVoucherRowCurrency(items, header).map(it => ({
          accountId: Number(it.accountId),
          detailedType: it.detailedType,
          detailedId: it.detailedId,
          detailedName: it.detailedName,
          debit: Number(it.debit) || 0,
          credit: Number(it.credit) || 0,
          currency: it.currency,
          ...(it.exchangeRate !== undefined ? { exchangeRate: it.exchangeRate } : {}),
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
      toast.error(errorMessageOf(err) || 'خطا در ثبت سند حسابداری');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitVoucher();
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4">
      <DialogLayer onClose={onClose} disabled={isSaving} />
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
                  {editingVoucher ? `ویرایش سند حسابداری شماره ${formatPersianNumber(editingVoucher.voucherNumber)}` : 'فرم ثبت سریع سند حسابداری'}
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  ورود سریع با صفحه‌کلید
                </span>
                {draftStatusText && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 animate-pulse">
                    {draftStatusText}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                ثبت آنی ردیف‌ها با کلیدهای میانبر، جست‌وجوی کد معین و تراز خودکار لحظه‌ای
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowShortcutsHelp(!showShortcutsHelp)}
              title="راهنمای کلیدهای میانبر صفحه‌کلید"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition border ${
                showShortcutsHelp 
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700' 
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">راهنمای کلیدها</span>
            </button>

            <button aria-label="بستن"
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
                <span className="block text-[10px] text-slate-600 dark:text-slate-300 font-sans">ذخیره پیش‌نویس سند</span>
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
        <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Permanent Voucher Warning */}
          {isPermanentVoucher && (
            <div className="flex items-start gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200">
              <AlertCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold">سند حسابداری دائم و قطعی‌شده:</span> این سند به دلیل وضعیت دائم و قطعی، قابل ویرایش یا حذف مستقیم نیست. جهت تعدیل مالی، لطفاً از دکمه‌های «صدور سند معکوس (عطف)» یا «صدور سند اصلاحی» در جدول اسناد استفاده فرمایید.
              </div>
            </div>
          )}

          {/* Top Form Header Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
            <div>
              <label htmlFor={`${fieldId}-date`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                تاریخ سند *
              </label>
              <JalaliDateInput
                id={`${fieldId}-date`}
                value={date}
                onChange={setDate}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                containerClassName="w-full"
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-voucher-type`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                نوع سند
              </label>
              <select
                id={`${fieldId}-voucher-type`}
                value={voucherType}
                onChange={e => setVoucherType(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              >
                <option value="general">عمومی / عادی</option>
                <option value="sales">فروش و درآمد</option>
                <option value="purchase">خرید و انبار</option>
                <option value="treasury">دریافت و پرداخت</option>
                <option value="payroll">حقوق و دستمزد</option>
                <option value="opening">افتتاحیه (مانده‌های اول دوره)</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${fieldId}-manual-voucher-number`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                شماره عطف دستی (اختیاری)
              </label>
              <input
                id={`${fieldId}-manual-voucher-number`}
                type="text"
                value={manualVoucherNumber}
                onChange={e => setManualVoucherNumber(e.target.value)}
                placeholder="مثال: سند فیزیکی ۹۸"
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            {/* v9.0.191 (TD-564): ارزهای خزانه و نرخ ارز سند؛ «تومان» حذف شد (مبلغ تومانی را به ریال وارد کنید) */}
            <VoucherHeaderCurrencyFields
              value={header}
              onChange={next => { setCurrency(next.currency); setHeaderRate(next.rate ?? ''); }}
            />

            <div className="sm:col-span-2 md:col-span-4">
              <label htmlFor={`${fieldId}-description`} className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                شرح کلی سند حسابداری *
              </label>
              <div className="relative">
                <input
                  id={`${fieldId}-description`}
                  ref={descriptionRef}
                  type="text"
                  aria-required="true"
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
                  ردیف‌های سند ({formatPersianNumber(items.length)} سطر)
                </h4>
                {!isBalanced && (
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                    مابه‌التفاوت: {formatPersianPrice(difference, balance.currency)}
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
                    <span>افزودن سطر موازنه‌کننده ({formatPersianPrice(difference, balance.currency)})</span>
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
              header={header}
              updateItem={updateItem}
              addRow={addRow}
              removeRow={removeRow}
              handleAutoBalanceRow={handleAutoBalanceRow}
              handleSwapDebitCredit={handleSwapDebitCredit}
              rowRefs={itemRefs}
            />

            <ControlAccountNotice
              hits={control.hits}
              mayAdjust={control.mayAdjust}
              reason={{ id: `${fieldId}-control-reason`, value: controlReason, onChange: setControlReason, inputRef: controlReasonRef }}
            />
          </div>

          {/* الصاق تصاویر فاکتور و اسناد مثبته پیوست */}
          <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <FinancialAttachmentUploader
              attachments={attachments}
              onChange={setAttachments}
              title="تصاویر فاکتور و اسناد مثبته ضمیمه سند حسابداری"
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
                  {isBalanced ? 'سند کاملاً تراز است و آماده ثبت نهایی است' : 'سند حسابداری هنوز تراز نیست!'}
                </div>
                {!isBalanced && balance.rowsWithoutRate.length > 0 && (
                  <div className="text-[11px] opacity-90 mt-0.5">
                    نرخ تبدیل ردیف {rowsWithoutRateText} به ریال را وارد کنید؛ تراز ریالی سند بی آن سنجیده نمی‌شود.
                  </div>
                )}
                {!isBalanced && balance.rowsWithoutRate.length === 0 && (
                  <div className="text-[11px] opacity-90 mt-0.5">
                    مابه‌التفاوت بدهکار و بستانکار: <strong className="font-mono text-rose-600 dark:text-rose-400">{formatPersianPrice(difference, balance.currency)}</strong>
                    {debitSurplus > 0 ? ' (بدهکار بیشتر است)' : ' (بستانکار بیشتر است)'}
                    {balance.inRial ? ' — سند چندارزی به ریال و با نرخ هر ردیف تراز می‌شود' : ''}
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
                {isBalanced ? 'تراز: ۱۰۰٪' : `اختلاف: ${formatPersianPrice(difference, balance.currency)}`}
              </div>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span>راهنما: برای ذخیره سریع از <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px] text-slate-800 dark:text-slate-200">Ctrl + S</kbd> و برای تراز خودکار از <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px] text-slate-800 dark:text-slate-200">Alt + B</kbd> استفاده کنید.</span>
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
                    ? 'در حال ذخیره...' 
                    : isPermanentVoucher 
                      ? 'سند دائم (غیرقابل ویرایش)' 
                      : (editingVoucher ? 'به‌روزرسانی سند' : 'ذخیره پیش‌نویس سند (Ctrl+S)')
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

/** v9.0.191 (TD-564): ارز سند از فهرست ارزهای خزانه؛ ارز بیرون از آن (مانند «تومان» قدیمی) ریال می‌شود و کاربر آگاه می‌شود */
function supportedVoucherCurrency(value: string | null | undefined): string {
  const { currency, replaced } = voucherFormCurrency(value);
  if (replaced) toast.error(`ارز «${replaced}» در فهرست ارزهای سند نیست؛ ارز سند ریال شد. مبلغ ردیف‌ها را به ریال بررسی کنید.`);
  return currency;
}
