import React, { useState, useMemo, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { fetchJson } from '../../api';
import { 
  Building2, 
  Wallet, 
  CreditCard, 
  Plus, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Search, 
  Filter, 
  RefreshCw, 
  Copy, 
  Check, 
  Trash2, 
  Edit3,
  Landmark,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ArrowRightLeft,
  Download,
  X
} from 'lucide-react';
import * as xlsx from 'xlsx';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, formatPersianDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { BankAccount, TreasuryTransaction, Customer, Personnel, Account, FinancialAttachment } from '../../types';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { AccountSearchSelect } from './AccountSearchSelect';
import { SearchableSelect } from '../SearchableSelect';
import { BankReconciliationModal } from './reconciliation/BankReconciliationModal';
import { ActionMenu, ActionMenuItem } from '../ActionMenu';
import { FinancialAttachmentUploader } from './FinancialAttachmentUploader';
import { FinancialAttachmentBadge } from './FinancialAttachmentBadge';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';

interface BankAndTreasuryTabProps {
  bankAccounts: BankAccount[];
  transactions: TreasuryTransaction[];
  customers: Customer[];
  personnelList: Personnel[];
  accounts?: Account[];
   loading: boolean;
   isSyncingBanks?: boolean;
   onRefresh: () => void;
   onSyncAndReconcileBanks?: () => Promise<void>;
   onCreateBankAccount: (data: any) => Promise<void>;
   onUpdateBankAccount: (id: number, data: any) => Promise<void>;
   onDeleteBankAccount: (id: number) => Promise<void>;
   onCreateTreasuryTransaction: (data: any) => Promise<void>;
   onVoidTreasuryTransaction?: (id: number, reason: string) => Promise<void>;
   onCreateTreasuryTransfer?: (data: any) => Promise<void>;
   onReconcileTransactions?: (bankAccountId: number, txIds: number[], batch: string, reconciled: boolean) => Promise<void>;
   onLoadCashFlowReport?: (startDate?: string, endDate?: string) => Promise<any>;
   onLoadChequeReconciliation?: () => Promise<any[]>;
 }

export function BankAndTreasuryTab({
  bankAccounts,
  transactions,
  customers,
  personnelList,
  accounts = [],
  loading,
  isSyncingBanks = false,
  onRefresh,
  onSyncAndReconcileBanks,
  onCreateBankAccount,
  onUpdateBankAccount,
  onDeleteBankAccount,
  onCreateTreasuryTransaction,
  onVoidTreasuryTransaction,
  onCreateTreasuryTransfer,
  onReconcileTransactions,
  onLoadCashFlowReport,
  onLoadChequeReconciliation,
}: BankAndTreasuryTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];
  const safeAccounts = Array.isArray(accounts) ? accounts : [];

  const customerList = useMemo(() => {
    return safeCustomers.filter(c => {
      const pt = c.partyType || (c as any).party_type || 'customer';
      return pt === 'customer' || pt === 'both';
    });
  }, [safeCustomers]);

  const supplierList = useMemo(() => {
    const list = safeCustomers.filter(c => {
      const pt = c.partyType || (c as any).party_type;
      return pt === 'supplier' || pt === 'both';
    });
    return list.length > 0 ? list : safeCustomers;
  }, [safeCustomers]);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [selectedMethodFilter, setSelectedMethodFilter] = useState<string>('all');
  // V1.5.0: فیلتر تاریخ + حساب + صفحه‌بندی + انتقال بین‌بانکی
  const [txPage, setTxPage] = useState(1);
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [txAccountFilter, setTxAccountFilter] = useState<string>('all');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferFormData, setTransferFormData] = useState({
    date: getTodayJalaliDate(),
    amount: 0,
    fromBankAccountId: null as number | null,
    toBankAccountId: null as number | null,
    trackingNumber: '',
    description: '',
  });
  const [isSavingTransfer, setIsSavingTransfer] = useState(false);
  const TX_PAGE_SIZE = 25;
  // V3 Phase 4: مغایرت‌گیری و تطبیق صورت‌حساب بانک + جریان نقدی
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [reconcileAccountId, setReconcileAccountId] = useState<string>('');
  const [isCashFlowModalOpen, setIsCashFlowModalOpen] = useState(false);
  const [cashFlowFrom, setCashFlowFrom] = useState('');
  const [cashFlowTo, setCashFlowTo] = useState('');
  const [cashFlowData, setCashFlowData] = useState<any>(null);
  const [isCashFlowLoading, setIsCashFlowLoading] = useState(false);

  // Modals
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  // V1.4.0: ابطال تراکنش خزانه با سند معکوس
  const [voidTarget, setVoidTarget] = useState<TreasuryTransaction | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  const handleVoidSubmit = async () => {
    if (!voidTarget || !onVoidTreasuryTransaction) return;
    if (voidReason.trim().length < 3) {
      toast.error('دلیل ابطال را وارد کنید (حداقل ۳ کاراکتر)');
      return;
    }
    const ok = await confirmAction({
      title: 'ابطال تراکنش خزانه',
      message: `تراکنش «${voidTarget.transactionNumber}» به مبلغ ${formatPersianPrice(voidTarget.amount)} با ثبت تراکنش معکوس و سند معکوس ابطال می‌شود و مانده حساب اصلاح خواهد شد. ادامه می‌دهید؟`
    });
    if (!ok) return;
    setIsVoiding(true);
    try {
      await onVoidTreasuryTransaction(voidTarget.id, voidReason.trim());
      toast.success('تراکنش با سند معکوس ابطال شد');
      setVoidTarget(null);
      setVoidReason('');
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ابطال تراکنش');
    } finally {
      setIsVoiding(false);
    }
  };

  // V1.6.0: جریان نقدی
  const handleOpenCashFlow = async () => {
    if (!onLoadCashFlowReport) return;
    setIsCashFlowLoading(true);
    try {
      const res = await onLoadCashFlowReport(cashFlowFrom || undefined, cashFlowTo || undefined);
      setCashFlowData(res);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در دریافت گزارش جریان نقدی');
    } finally {
      setIsCashFlowLoading(false);
    }
  };
  const [bankFormData, setBankFormData] = useState({
    code: '',
    title: '',
    type: 'bank' as 'bank' | 'cash' | 'pos',
    bankName: '',
    accountNumber: '',
    shebaNumber: '',
    cardNumber: '',
    branch: '',
    initialBalance: 0,
    currency: 'IRR',
    accountId: null as number | null,
    notes: '',
  });

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [viewingAttachments, setViewingAttachments] = useState<{ title: string; attachments: FinancialAttachment[] } | null>(null);
  const [txFormData, setTxFormData] = useState({
    type: 'receipt' as 'receipt' | 'payment' | 'transfer',
    date: getTodayJalaliDate(),
    method: 'bank_transfer' as 'cash' | 'bank_transfer' | 'pos' | 'cheque',
    amount: 0,
    currency: 'IRR',
    bankAccountId: null as number | null,
    partyType: 'customer' as 'customer' | 'personnel' | 'supplier' | 'other',
    partyId: null as number | null,
    partyName: '',
    trackingNumber: '',
    description: '',
    createVoucher: true,
    // V1.8.0: انگیزه پرداخت به پرسنل
    purpose: 'settlement' as 'settlement' | 'advance' | 'other',
    attachments: [] as FinancialAttachment[],
  });

  // V1.8.0: پیش‌نمایش زنده سند دوبل
  const [voucherPreview, setVoucherPreview] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  useEffect(() => {
    if (!isTxModalOpen || !txFormData.bankAccountId || !txFormData.amount || txFormData.amount <= 0 || !txFormData.createVoucher) {
      setVoucherPreview(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const res = await fetchJson('/accounting/treasury/preview-voucher', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            type: txFormData.type,
            amount: txFormData.amount,
            currency: txFormData.currency,
            bankAccountId: txFormData.bankAccountId,
            partyType: txFormData.partyType,
            purpose: txFormData.purpose,
            partyId: txFormData.partyId,
            partyName: txFormData.partyName,
          }),
        });
        setVoucherPreview(res);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setVoucherPreview(null);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 400);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [isTxModalOpen, txFormData.type, txFormData.amount, txFormData.bankAccountId, txFormData.partyType, txFormData.purpose, txFormData.partyName, txFormData.createVoucher]);

  const [isSaving, setIsSaving] = useState(false);

  // Computed reconciliation summary
  const totalLedgerBalance = safeBankAccounts.reduce((sum, b) => sum + (Number(b.ledgerBalance ?? b.currentBalance) || 0), 0);
  const totalTreasuryBalance = safeBankAccounts.reduce((sum, b) => sum + (Number(b.treasuryBalance ?? b.currentBalance) || 0), 0);
  const totalDiscrepancy = safeBankAccounts.reduce((sum, b) => sum + (Number(b.discrepancy) || 0), 0);
  const syncedAccountsCount = safeBankAccounts.filter(b => b.syncStatus === 'synced').length;
  const discrepantAccountsCount = safeBankAccounts.filter(b => b.syncStatus === 'discrepant').length;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('کپی شد');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openCreateBankModal = () => {
    setEditingBank(null);
    setBankFormData({
      code: `B-${safeBankAccounts.length + 1}`,
      title: '',
      type: 'bank',
      bankName: '',
      accountNumber: '',
      shebaNumber: '',
      cardNumber: '',
      branch: '',
      initialBalance: 0,
      currency: 'IRR',
      accountId: safeAccounts.find(a => a.code === '1010')?.id || safeAccounts.find(a => a.code === '1001')?.id || null,
      notes: '',
    });
    setIsBankModalOpen(true);
  };

  const openEditBankModal = (bank: BankAccount) => {
    setEditingBank(bank);
    setBankFormData({
      code: bank.code,
      title: bank.title,
      type: bank.type,
      bankName: bank.bankName || '',
      accountNumber: bank.accountNumber || '',
      shebaNumber: bank.shebaNumber || '',
      cardNumber: bank.cardNumber || '',
      branch: bank.branch || '',
      initialBalance: bank.initialBalance ?? 0,
      currency: bank.currency || 'IRR',
      accountId: bank.accountId || null,
      notes: bank.notes || '',
    });
    setIsBankModalOpen(true);
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankFormData.title.trim()) {
      toast.error('عنوان حساب / صندوق الزامی است');
      return;
    }
    setIsSaving(true);
    try {
      if (editingBank) {
        await onUpdateBankAccount(editingBank.id, bankFormData);
        toast.success('حساب بانکی به‌روزرسانی شد');
      } else {
        await onCreateBankAccount(bankFormData);
        toast.success('حساب / صندوق جدید تعریف شد');
      }
      setIsBankModalOpen(false);
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت حساب بانکی');
    } finally {
      setIsSaving(false);
    }
  };

  const openNewTxModal = (type: 'receipt' | 'payment') => {
    setTxFormData({
      type,
      date: getTodayJalaliDate(),
      method: 'bank_transfer',
      amount: 0,
      currency: 'IRR',
      bankAccountId: bankAccounts[0]?.id || null,
      partyType: type === 'payment' ? 'supplier' : 'customer',
      partyId: null,
      partyName: '',
      trackingNumber: '',
      description: '',
      createVoucher: true,
      purpose: 'settlement',
      attachments: [],
    });
    setIsTxModalOpen(true);
  };

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txFormData.amount || txFormData.amount <= 0) {
      toast.error('مبلغ تراکنش باید بزرگتر از صفر باشد');
      return;
    }
    if (!txFormData.partyName.trim()) {
      toast.error('نام طرف حساب الزامی است');
      return;
    }

    setIsSaving(true);
    try {
      const created = await onCreateTreasuryTransaction(txFormData);
      toast.success(
        (created as any)?.voucherId
          ? `تراکنش ثبت شد — سند دوبل #${formatPersianNumber((created as any).voucherId)} صادر گردید`
          : 'تراکنش ثبت شد (بدون صدور سند)'
      );
      setIsTxModalOpen(false);
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت تراکنش خزانه‌داری');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredTransactions = safeTransactions.filter(t => {
    const matchSearch = !searchQuery.trim() ||
      t.partyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.transactionNumber.includes(searchQuery.trim()) ||
      (t.trackingNumber && t.trackingNumber.includes(searchQuery.trim())) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchType = selectedTypeFilter === 'all' || t.type === selectedTypeFilter;
    const matchMethod = selectedMethodFilter === 'all' || t.method === selectedMethodFilter;
    const matchDate = (!dateFromFilter || String(t.date || '') >= dateFromFilter) && (!dateToFilter || String(t.date || '').slice(0, 10) <= dateToFilter);
    const matchAccount = txAccountFilter === 'all' || Number(t.bankAccountId) === Number(txAccountFilter);
    return matchSearch && matchType && matchMethod && matchDate && matchAccount;
  });

  // V1.5.0: صفحه‌بندی سمت کلاینت
  const txTotalPages = Math.max(1, Math.ceil(filteredTransactions.length / TX_PAGE_SIZE));
  const safeTxPage = Math.min(txPage, txTotalPages);
  const paginatedTransactions = filteredTransactions.slice((safeTxPage - 1) * TX_PAGE_SIZE, safeTxPage * TX_PAGE_SIZE);

  // V1.5.0: مانده تجمعی — فقط وقتی یک حساب مشخص فیلتر شده باشد (پیمایش صعودی، بدون ابطال‌شده‌ها)
  const runningBalanceMap = useMemo<Map<number, number>>(() => {
    const map = new Map<number, number>();
    if (txAccountFilter === 'all') return map;
    const accId = Number(txAccountFilter);
    const asc = [...safeTransactions]
      .filter(t => Number(t.bankAccountId) === accId && t.status !== 'voided')
      .sort((a, b) => (a.date === b.date ? (a.id - b.id) : String(a.date).localeCompare(String(b.date))));
    let bal = Number(safeBankAccounts.find(b => b.id === accId)?.initialBalance ?? 0) || 0;
    for (const t of asc) {
      bal = t.type === 'receipt' ? bal + (Number(t.amount) || 0) : bal - (Number(t.amount) || 0);
      map.set(t.id, bal);
    }
    return map;
  }, [txAccountFilter, safeTransactions, safeBankAccounts]);

  const methodLabels: Record<string, string> = {
    cash: 'وجه نقد / صندوق',
    bank_transfer: 'حواله / پایا / ساتنا',
    pos: 'دستگاه کارتخوان (POS)',
    cheque: 'چک صیادی',
  };

  // V1.5.0: خروجی اکسل تراکنش‌های فیلترشده
  const handleExportTxExcel = () => {
    try {
      const rows = filteredTransactions.map((t, i) => ({
        '#': i + 1,
        'شماره رسید': t.transactionNumber,
        'تاریخ': t.date,
        'نوع': t.type === 'receipt' ? 'دریافت' : 'پرداخت',
        'وضعیت': t.status === 'voided' ? 'ابطال‌شده' : 'ثبت‌شده',
        'حساب': t.bankAccountTitle || '',
        'طرف حساب': t.partyName,
        'روش': methodLabels[t.method] || t.method,
        'شماره پیگیری': t.trackingNumber || '',
        'شرح': t.description || '',
        'مبلغ': Number(t.amount) || 0,
        'ارز': t.currency || 'IRR',
        'سند حسابداری': t.voucherId ? `#${t.voucherId}` : '',
        'ثبت‌کننده': (t as any).creatorName || '',
      }));
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'تراکنش‌های خزانه');
      xlsx.writeFile(wb, `Treasury-Transactions-${getTodayJalaliDate().replace(/\//g, '-')}.xlsx`);
      toast.success(`${rows.length} ردیف اکسل تهیه شد`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در تهیه اکسل');
    }
  };

  // V1.5.0: ثبت انتقال بین‌بانکی
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateTreasuryTransfer) return;
    if (!transferFormData.fromBankAccountId || !transferFormData.toBankAccountId) {
      toast.error('حساب مبدأ و مقصد الزامی است');
      return;
    }
    if (transferFormData.fromBankAccountId === transferFormData.toBankAccountId) {
      toast.error('حساب مبدأ و مقصد باید متفاوت باشند');
      return;
    }
    if (!transferFormData.amount || transferFormData.amount <= 0) {
      toast.error('مبلغ انتقال باید بزرگتر از صفر باشد');
      return;
    }
    const fromAcc = safeBankAccounts.find(b => b.id === transferFormData.fromBankAccountId);
    if (fromAcc && Number(fromAcc.currentBalance) < transferFormData.amount) {
      toast.error(`مانده حساب مبدأ «${fromAcc.title}» کافی نیست`);
      return;
    }
    const ok = await confirmAction({
      title: 'انتقال بین‌بانکی',
      message: `انتقال ${formatPersianPrice(transferFormData.amount)} از «${fromAcc?.title}» به «${safeBankAccounts.find(b => b.id === transferFormData.toBankAccountId)?.title}» با یک سند دوبل ثبت شود؟`
    });
    if (!ok) return;
    setIsSavingTransfer(true);
    try {
      await onCreateTreasuryTransfer(transferFormData);
      toast.success('انتقال بین‌بانکی با سند دوبل ثبت شد');
      setIsTransferModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت انتقال');
    } finally {
      setIsSavingTransfer(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white text-lg">خزانه‌داری، حساب‌های بانکی و صندوق‌ها</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            کنترل نقدینگی، انطباق داینامیک با دفاتر اسناد دوبل، صدور رسید دریافت و پرداخت وجه
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSyncAndReconcileBanks && (
            <button
              onClick={onSyncAndReconcileBanks}
              disabled={isSyncingBanks || loading}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl transition border border-indigo-200/80 dark:border-indigo-800"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingBanks ? 'animate-spin' : ''}`} />
              <span>{isSyncingBanks ? 'در حال تطبیق با اسناد...' : 'تطبیق و همگام‌سازی با دفاتر دوبل'}</span>
            </button>
          )}

          {/* V3 Phase 4: مغایرت‌گیری بانکی + جریان نقدی */}
          <button
            onClick={() => setIsReconcileModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/30 dark:hover:bg-teal-900/50 text-teal-700 dark:text-teal-300 text-xs font-bold rounded-xl transition border border-teal-200 dark:border-teal-800"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>مغایرت‌گیری بانکی</span>
          </button>
          <button
            onClick={() => { setIsCashFlowModalOpen(true); void handleOpenCashFlow(); }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-50 hover:bg-sky-100 dark:bg-sky-900/30 dark:hover:bg-sky-900/50 text-sky-700 dark:text-sky-300 text-xs font-bold rounded-xl transition border border-sky-200 dark:border-sky-800"
          >
            <Layers className="w-4 h-4" />
            <span>جریان نقدی</span>
          </button>
          <button
            onClick={() => openNewTxModal('receipt')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>ثبت دریافت وجه</span>
          </button>
          <button
            onClick={() => openNewTxModal('payment')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>ثبت پرداخت وجه</span>
          </button>
          {/* V1.5.0: انتقال بین‌بانکی */}
          {onCreateTreasuryTransfer && (
            <button
              onClick={() => {
                setTransferFormData({
                  date: getTodayJalaliDate(),
                  amount: 0,
                  fromBankAccountId: safeBankAccounts[0]?.id || null,
                  toBankAccountId: safeBankAccounts[1]?.id || null,
                  trackingNumber: '',
                  description: '',
                });
                setIsTransferModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>انتقال بین‌بانکی</span>
            </button>
          )}
          <button
            onClick={openCreateBankModal}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف حساب / صندوق جدید</span>
          </button>
        </div>
      </div>

      {/* Dynamic Reconciliation & Balance Health Summary Banner */}
      <div className={`p-4 sm:p-5 rounded-2xl border transition-all ${
        discrepantAccountsCount === 0 
          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
          : 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              discrepantAccountsCount === 0 
                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' 
                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
            }`}>
              {discrepantAccountsCount === 0 ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {discrepantAccountsCount === 0 
                    ? 'وضعیت سلامت ریالی: انطباق ۱۰۰٪ کامل خزانه‌داری با دفاتر اسناد دوبل' 
                    : `هشدار مغایرت ریالی: ${discrepantAccountsCount} حساب نیازمند بررسی و تطبیق`}
                </h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  discrepantAccountsCount === 0 
                    ? 'bg-emerald-200/60 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300' 
                    : 'bg-amber-200/60 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                }`}>
                  {syncedAccountsCount} از {safeBankAccounts.length} حساب کاملاً همگام
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {discrepantAccountsCount === 0 
                  ? 'تمامی مانده‌های صندوق‌ها و بانک‌ها مستقیماً با مجموع گردش اسناد دوبل تاییدشده تراز هستند.' 
                  : 'مغایرت ممکن است به دلیل عدم ثبت سند دوبل برای برخی دریافت/پرداخت‌ها یا مانده اولیه ثبت‌نشده در سند افتتاحیه باشد.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <div className="bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px]">مجموع مانده دفاتر دوبل:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{formatPersianPrice(totalLedgerBalance, appCurrency)}</span>
            </div>
            <div className="bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400 block text-[10px]">مجموع گردش خزانه‌داری:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{formatPersianPrice(totalTreasuryBalance, appCurrency)}</span>
            </div>
            {totalDiscrepancy > 0 && (
              <div className="bg-rose-100/80 dark:bg-rose-900/40 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                <span className="block text-[10px]">میزان مغایرت کل:</span>
                <span className="font-bold">{formatPersianPrice(totalDiscrepancy, appCurrency)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bank & Cash Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {safeBankAccounts.map(bank => {
          const isBank = bank.type === 'bank';
          const isPos = bank.type === 'pos';
          const isSynced = bank.syncStatus === 'synced';
          const isDiscrepant = bank.syncStatus === 'discrepant';

          return (
            <div
              key={bank.id}
              className={`bg-white dark:bg-slate-800 p-5 rounded-2xl border shadow-sm relative overflow-hidden flex flex-col justify-between transition hover:shadow-md ${
                isDiscrepant 
                  ? 'border-amber-300 dark:border-amber-700/80 ring-1 ring-amber-400/20' 
                  : 'border-slate-200/80 dark:border-slate-700/80'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isBank ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' :
                      isPos ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400' :
                      'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {isBank ? <Building2 className="w-5 h-5" /> : isPos ? <CreditCard className="w-5 h-5" /> : <Wallet className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                          {bank.title}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                          {bank.code}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {bank.bankName ? `${bank.bankName} ${bank.branch ? `(${bank.branch})` : ''}` : (bank.type === 'cash' ? 'صندوق نقد' : 'دستگاه کارتخوان')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditBankModal(bank)}
                      title="ویرایش حساب و کد معین"
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <ActionMenu
                      items={[
                        {
                          label: 'مغایرت‌گیری و تطبیق بانکی',
                          icon: ShieldCheck,
                          onClick: () => {
                            setReconcileAccountId(String(bank.id));
                            setIsReconcileModalOpen(true);
                          },
                        },
                        ...(bank.accountNumber
                          ? [
                              {
                                label: 'کپی شماره حساب',
                                icon: Copy,
                                onClick: () => copyToClipboard(bank.accountNumber || '', `acc-${bank.id}`),
                              },
                            ]
                          : []),
                        ...(bank.shebaNumber
                          ? [
                              {
                                label: 'کپی شماره شبا',
                                icon: Copy,
                                onClick: () => copyToClipboard(bank.shebaNumber || '', `sheba-${bank.id}`),
                              },
                            ]
                          : []),
                        {
                          label: 'حذف حساب',
                          icon: Trash2,
                          variant: 'danger',
                          onClick: async () => {
                            if (!(await confirmAction({ title: 'حذف حساب بانکی', message: `آیا از حذف حساب ${bank.title} اطمینان دارید؟` }))) return;
                            try {
                              await onDeleteBankAccount(bank.id);
                              toast.success('حساب حذف شد');
                            } catch (e: any) {
                              toast.error(e?.message || 'خطا در حذف حساب');
                            }
                          },
                        },
                      ]}
                      align="left"
                    />
                  </div>
                </div>

                {/* Sync Badge */}
                <div className="mb-3">
                  {isSynced && (
                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200/60 dark:border-emerald-800/40">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>تراز ۱۰۰٪ با اسناد دوبل حسابداری</span>
                    </div>
                  )}
                  {isDiscrepant && (
                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200/60 dark:border-amber-800/40">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>مغایرت دفتری: {formatPersianPrice(bank.discrepancy || 0, bank.currency || appCurrency)}</span>
                    </div>
                  )}
                  {bank.syncStatus === 'unlinked' && (
                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>فاقد اتصال به سرفصل کدینگ</span>
                    </div>
                  )}
                </div>

                {/* Main Real-time Dynamic Balance */}
                <div className="my-2 p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-100 dark:border-slate-700/60">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">مانده همگام لحظه‌ای:</span>
                    <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                      {bank.accountName ? `متصل به: ${bank.accountName}` : 'کد معین اختصاصی'}
                    </span>
                  </div>
                  <div className="text-xl font-black text-slate-900 dark:text-white font-mono mt-1">
                    {formatPersianPrice(bank.currentBalance || 0)} <span className="text-xs font-normal text-slate-500">{formatCurrencyLabel(bank.currency || appCurrency)}</span>
                  </div>
                </div>

                {/* Sub-Ledger & Treasury Breakdown */}
                <div className="grid grid-cols-2 gap-2 my-2 text-[11px]">
                  <div className="p-2 bg-slate-50/70 dark:bg-slate-700/20 rounded-lg">
                    <span className="text-slate-400 block text-[10px]">مانده اسناد دوبل:</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">
                      {formatPersianPrice(bank.ledgerBalance ?? bank.currentBalance ?? 0)}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50/70 dark:bg-slate-700/20 rounded-lg">
                    <span className="text-slate-400 block text-[10px]">گردش خزانه‌داری:</span>
                    <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">
                      {formatPersianPrice(bank.treasuryBalance ?? bank.currentBalance ?? 0)}
                    </span>
                  </div>
                </div>

                {/* Turnover Details */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 py-1 border-t border-slate-100 dark:border-slate-700/60">
                  <span>گردش بدهکار اسناد: <strong className="text-emerald-600 font-mono">{formatPersianPrice(bank.totalDebit || 0)}</strong></span>
                  <span>گردش بستانکار اسناد: <strong className="text-rose-600 font-mono">{formatPersianPrice(bank.totalCredit || 0)}</strong></span>
                </div>

                {/* Bank Card / Sheba Info */}
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 mt-2">
                  {bank.cardNumber && (
                    <div className="flex items-center justify-between bg-slate-50/60 dark:bg-slate-700/20 px-2 py-1 rounded">
                      <span className="text-slate-400 text-[11px]">شماره کارت:</span>
                      <div className="flex items-center gap-1.5 font-mono">
                        <span>{bank.cardNumber}</span>
                        <button
                          onClick={() => copyToClipboard(bank.cardNumber || '', `card-${bank.id}`)}
                          className="text-slate-400 hover:text-indigo-600"
                        >
                          {copiedId === `card-${bank.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {bank.shebaNumber && (
                    <div className="flex items-center justify-between bg-slate-50/60 dark:bg-slate-700/20 px-2 py-1 rounded">
                      <span className="text-slate-400 text-[11px]">شماره شبا:</span>
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span>{bank.shebaNumber}</span>
                        <button
                          onClick={() => copyToClipboard(bank.shebaNumber || '', `sheba-${bank.id}`)}
                          className="text-slate-400 hover:text-indigo-600"
                        >
                          {copiedId === `sheba-${bank.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transactions Section */}
      <div className="space-y-4">
        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="جستجو در طرف حساب، شماره پیگیری، شرح..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={selectedTypeFilter}
              onChange={e => setSelectedTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
            >
              <option value="all">همه دریافت/پرداخت‌ها</option>
              <option value="receipt">فقط دریافت‌ها</option>
              <option value="payment">فقط پرداخت‌ها</option>
            </select>

            <select
              value={selectedMethodFilter}
              onChange={e => setSelectedMethodFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
            >
              <option value="all">همه روش‌های پرداخت</option>
              <option value="bank_transfer">حواله بانکی</option>
              <option value="pos">دستگاه کارتخوان</option>
              <option value="cash">نقدی</option>
              <option value="cheque">چک</option>
            </select>

            {/* V1.5.0: فیلتر حساب برای مانده تجمعی */}
            <select
              value={txAccountFilter}
              onChange={e => { setTxAccountFilter(e.target.value); setTxPage(1); }}
              className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white max-w-[180px]"
            >
              <option value="all">همه حساب‌ها</option>
              {safeBankAccounts.map(b => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>

            {/* V1.5.0: فیلتر بازه تاریخ */}
            <div className="flex items-center gap-1">
              <DatePicker
                value={dateFromFilter}
                onChange={(d: any) => { setDateFromFilter(extractDateString(d)); setTxPage(1); }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                placeholder="از تاریخ"
                inputClass="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
                containerClassName="inline-block"
              />
              <span className="text-slate-400 text-[10px]">تا</span>
              <DatePicker
                value={dateToFilter}
                onChange={(d: any) => { setDateToFilter(extractDateString(d)); setTxPage(1); }}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-left"
                placeholder="تا تاریخ"
                inputClass="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
                containerClassName="inline-block"
              />
            </div>

            {/* V1.5.0: خروجی اکسل تراکنش‌ها */}
            <button
              onClick={handleExportTxExcel}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors cursor-pointer shrink-0"
              title="خروجی اکسل تراکنش‌های فیلترشده"
            >
              <Download size={14} />
              اکسل
            </button>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-3 w-28 text-center">شماره رسید</th>
                  <th className="py-3 px-3 w-28 text-center">تاریخ</th>
                  <th className="py-3 px-3 w-28 text-center">نوع تراکنش</th>
                  <th className="py-3 px-4">طرف حساب</th>
                  <th className="py-3 px-3 w-36">روش و حساب مقصد</th>
                  <th className="py-3 px-4">شرح</th>
                  <th className="py-3 px-4 w-36 text-left">{`مبلغ (${formatCurrencyLabel(transactions[0]?.currency || appCurrency)})`}</th>
                  {txAccountFilter !== 'all' && (
                    <th className="py-3 px-3 w-32 text-left">مانده پس از تراکنش</th>
                  )}
                  <th className="py-3 px-3 w-24 text-center">سند حسابداری</th>
                  <th className="py-3 px-3 w-28 text-center">ثبت‌کننده</th>
                  <th className="py-3 px-3 w-20 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
                {paginatedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={txAccountFilter !== 'all' ? 12 : 11} className="text-center py-10 text-slate-400">تراکنشی ثبت نشده است</td>
                  </tr>
                ) : (
                  paginatedTransactions.map((tx, idx) => {
                    const isVoided = tx.status === 'voided';
                    return (
                    <tr key={tx.id} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition ${isVoided ? 'opacity-50' : ''}`}>
                      <td className="py-3 px-3 text-center text-slate-400 font-bold">{formatPersianNumber(idx + 1)}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                        {formatPersianNumber(tx.transactionNumber)}
                        {isVoided && (
                          <div className="text-[9px] font-bold text-slate-400 mt-0.5">ابطال‌شده</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-300">
                        {formatPersianDate(tx.date)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          tx.type === 'receipt'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                        }`}>
                          {tx.type === 'receipt' ? 'دریافت' : 'پرداخت'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">
                        {tx.partyName}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                        <div>{methodLabels[tx.method] || tx.method}</div>
                        {tx.trackingNumber && (
                          <div className="text-[10px] font-mono text-slate-400">پیگیری: {tx.trackingNumber}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{tx.description || '-'}</span>
                          {tx.attachments && tx.attachments.length > 0 && (
                            <FinancialAttachmentBadge
                              count={tx.attachments.length}
                              onClick={() => setViewingAttachments({
                                title: `اسناد و مدارک ضمیمه تراکنش ${tx.transactionNumber}`,
                                attachments: tx.attachments || []
                              })}
                            />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-left font-mono font-bold text-slate-900 dark:text-white">
                        <span className={tx.type === 'receipt' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {tx.type === 'receipt' ? '+' : '-'} {formatPersianPrice(tx.amount)}
                        </span>
                        {txAccountFilter !== 'all' && runningBalanceMap.has(tx.id) && (
                          <div className="text-[10px] font-normal text-slate-400 mt-0.5" title="مانده تجمعی حساب">
                            {formatPersianPrice(runningBalanceMap.get(tx.id)!)}
                          </div>
                        )}
                      </td>
                      {txAccountFilter !== 'all' && <td className="py-3 px-3" />}
                      <td className="py-3 px-3 text-center">
                        {tx.voucherId ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold">
                            #{formatPersianNumber(tx.voucherId)}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
                        {(tx as any).creatorName || '—'}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <ActionMenu
                          items={[
                            ...(tx.trackingNumber
                              ? [
                                  {
                                    label: `کپی کد پیگیری (${tx.trackingNumber})`,
                                    icon: Copy,
                                    onClick: () => copyToClipboard(tx.trackingNumber, `track-${tx.id}`),
                                  },
                                ]
                              : []),
                            {
                              label: `کپی شماره تراکنش (${tx.transactionNumber})`,
                              icon: Copy,
                              onClick: () => copyToClipboard(tx.transactionNumber, `txnum-${tx.id}`),
                            },
                            ...(!isVoided && !tx.payrollId && (tx as any).reversalOfId == null
                              ? [
                                  {
                                    label: 'ابطال تراکنش با سند معکوس',
                                    icon: Trash2,
                                    variant: 'danger' as const,
                                    onClick: () => {
                                      setVoidTarget(tx);
                                      setVoidReason('');
                                    },
                                  },
                                ]
                              : []),
                          ]}
                          align="left"
                        />
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* V1.5.0: Pagination Bar */}
          {filteredTransactions.length > TX_PAGE_SIZE && (
            <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800/50">
              <span className="text-slate-500 dark:text-slate-400 font-bold">
                نمایش {formatPersianNumber(paginatedTransactions.length)} از {formatPersianNumber(filteredTransactions.length)} تراکنش (صفحه {formatPersianNumber(safeTxPage)} از {formatPersianNumber(txTotalPages)})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTxPage(p => Math.max(1, p - 1))}
                  disabled={safeTxPage === 1}
                  className="px-2.5 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 disabled:opacity-40 text-xs font-bold cursor-pointer"
                >
                  قبلی
                </button>
                <span className="px-3 py-1 text-xs font-black text-slate-800 dark:text-white bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded">
                  {formatPersianNumber(safeTxPage)} / {formatPersianNumber(txTotalPages)}
                </span>
                <button
                  onClick={() => setTxPage(p => Math.min(txTotalPages, p + 1))}
                  disabled={safeTxPage >= txTotalPages}
                  className="px-2.5 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 disabled:opacity-40 text-xs font-bold cursor-pointer"
                >
                  بعدی
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* V3 Phase 4: Bank Reconciliation Engine Modal */}
      <BankReconciliationModal
        isOpen={isReconcileModalOpen}
        onClose={() => setIsReconcileModalOpen(false)}
        bankAccounts={safeBankAccounts}
        transactions={safeTransactions}
        initialBankAccountId={reconcileAccountId || undefined}
        onReconcileTransactions={onReconcileTransactions}
      />

      {/* V1.6.0: Cash-Flow Report Modal */}
      {isCashFlowModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1 flex items-center gap-2">
              <Layers size={18} className="text-sky-600" />
              گزارش جریان نقدی خزانه
            </h3>
            <div className="flex flex-wrap items-end gap-2 my-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">از تاریخ</label>
                <DatePicker
                  value={cashFlowFrom}
                  onChange={(d: any) => setCashFlowFrom(d ? extractDateString(d) : '')}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-right"
                  placeholder="ابتدای دوره"
                  inputClass="px-2 py-1.5 text-[11px] bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-28"
                  containerClassName="inline-block"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">تا تاریخ</label>
                <DatePicker
                  value={cashFlowTo}
                  onChange={(d: any) => setCashFlowTo(d ? extractDateString(d) : '')}
                  calendar={persian}
                  locale={persian_fa}
                  calendarPosition="bottom-left"
                  placeholder="انتهای دوره"
                  inputClass="px-2 py-1.5 text-[11px] bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-28"
                  containerClassName="inline-block"
                />
              </div>
              <button
                onClick={() => void handleOpenCashFlow()}
                disabled={isCashFlowLoading}
                className="px-4 py-2 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white rounded-xl disabled:opacity-50 cursor-pointer"
              >
                {isCashFlowLoading ? '...' : 'نمایش گزارش'}
              </button>
            </div>

            {cashFlowData?.rows && cashFlowData.rows.length > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl text-center">
                    <p className="text-[10px] text-slate-400 font-bold">مانده ابتدای دوره</p>
                    <p className="text-sm font-black text-slate-800 dark:text-white">{formatPersianPrice(cashFlowData.totals.opening)}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl text-center">
                    <p className="text-[10px] text-emerald-600 font-bold">جمع دریافت‌ها</p>
                    <p className="text-sm font-black text-emerald-700 dark:text-emerald-300">+{formatPersianPrice(cashFlowData.totals.receipts)}</p>
                  </div>
                  <div className="p-3 bg-rose-50 dark:bg-rose-900/30 rounded-xl text-center">
                    <p className="text-[10px] text-rose-600 font-bold">جمع پرداخت‌ها</p>
                    <p className="text-sm font-black text-rose-700 dark:text-rose-300">-{formatPersianPrice(cashFlowData.totals.payments)}</p>
                  </div>
                  <div className="p-3 bg-sky-50 dark:bg-sky-900/30 rounded-xl text-center">
                    <p className="text-[10px] text-sky-600 font-bold">مانده پایان دوره</p>
                    <p className="text-sm font-black text-sky-700 dark:text-sky-300">{formatPersianPrice(cashFlowData.totals.closing)}</p>
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden mb-4">
                  <table className="w-full text-right border-collapse text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-700/50">
                      <tr className="text-slate-500 dark:text-slate-400">
                        <th className="p-2">حساب</th>
                        <th className="p-2 text-left">مانده ابتدا</th>
                        <th className="p-2 text-left">دریافت‌ها</th>
                        <th className="p-2 text-left">پرداخت‌ها</th>
                        <th className="p-2 text-left">مانده پایان</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {cashFlowData.rows.map((r: any) => (
                        <tr key={r.accountId}>
                          <td className="p-2 font-bold">{r.title}</td>
                          <td className="p-2 text-left font-mono">{formatPersianPrice(r.opening)}</td>
                          <td className="p-2 text-left font-mono text-emerald-600">+{formatPersianPrice(r.receipts)}</td>
                          <td className="p-2 text-left font-mono text-rose-600">-{formatPersianPrice(r.payments)}</td>
                          <td className="p-2 text-left font-mono font-black">{formatPersianPrice(r.closing)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {cashFlowData.months?.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-right border-collapse text-[11px]">
                      <thead className="bg-slate-50 dark:bg-slate-700/50">
                        <tr className="text-slate-500 dark:text-slate-400">
                          <th className="p-2">ماه (شمسی)</th>
                          <th className="p-2 text-left">دریافت‌ها</th>
                          <th className="p-2 text-left">پرداخت‌ها</th>
                          <th className="p-2 text-left">خالص جریان</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {cashFlowData.months.map((m: any) => (
                          <tr key={m.month}>
                            <td className="p-2 font-mono font-bold">{formatPersianNumber(m.month)}</td>
                            <td className="p-2 text-left font-mono text-emerald-600">+{formatPersianPrice(m.receipts)}</td>
                            <td className="p-2 text-left font-mono text-rose-600">-{formatPersianPrice(m.payments)}</td>
                            <td className={`p-2 text-left font-mono font-black ${m.net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                              {m.net >= 0 ? '+' : ''}{formatPersianPrice(m.net)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setIsCashFlowModalOpen(false)}
                className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* V1.5.0: Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1 flex items-center gap-2">
              <ArrowRightLeft size={18} className="text-amber-600" />
              انتقال بین‌بانکی / بین‌صندوقی
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
              انتقال وجه با یک سند دوبل (بدهکار مقصد / بستانکار مبدأ) و دو ردیف خزانه مرتبط
            </p>
            <form onSubmit={handleTransferSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">از حساب (مبدأ) *</label>
                <select
                  value={transferFormData.fromBankAccountId || ''}
                  onChange={e => setTransferFormData(p => ({ ...p, fromBankAccountId: Number(e.target.value) || null }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                >
                  <option value="">انتخاب مبدأ...</option>
                  {safeBankAccounts.filter(b => b.id !== transferFormData.toBankAccountId).map(b => (
                    <option key={b.id} value={b.id}>{b.title} — مانده: {formatPersianPrice(b.currentBalance)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">به حساب (مقصد) *</label>
                <select
                  value={transferFormData.toBankAccountId || ''}
                  onChange={e => setTransferFormData(p => ({ ...p, toBankAccountId: Number(e.target.value) || null }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                >
                  <option value="">انتخاب مقصد...</option>
                  {safeBankAccounts.filter(b => b.id !== transferFormData.fromBankAccountId).map(b => (
                    <option key={b.id} value={b.id}>{b.title} — مانده: {formatPersianPrice(b.currentBalance)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">مبلغ *</label>
                  <input
                    type="number"
                    min="0"
                    value={transferFormData.amount || ''}
                    onChange={e => setTransferFormData(p => ({ ...p, amount: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 text-xs font-mono text-left bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تاریخ *</label>
                  <DatePicker
                    value={transferFormData.date}
                    onChange={(d: any) => setTransferFormData(p => ({ ...p, date: extractDateString(d) }))}
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
                  value={transferFormData.trackingNumber}
                  onChange={e => setTransferFormData(p => ({ ...p, trackingNumber: e.target.value }))}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  placeholder="اختیاری"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">توضیحات</label>
                <input
                  type="text"
                  value={transferFormData.description}
                  onChange={e => setTransferFormData(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  placeholder="پیش‌فرض: انتقال وجه از ... به ..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingTransfer}
                  className="px-4 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl disabled:opacity-50 cursor-pointer"
                >
                  {isSavingTransfer ? 'در حال ثبت...' : 'ثبت انتقال با سند دوبل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* V1.4.0: Void Transaction Modal */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="font-bold text-rose-700 dark:text-rose-300 text-base mb-1 flex items-center gap-2">
              <AlertTriangle size={18} />
              ابطال تراکنش خزانه
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-6">
              تراکنش «<span className="font-mono font-bold">{voidTarget.transactionNumber}</span>» به مبلغ{' '}
              <span className="font-bold">{formatPersianPrice(voidTarget.amount)}</span> ابطال می‌شود؛ یک تراکنش معکوس
              با شماره سری جدید و سند معکوس حسابداری ثبت و مانده «{voidTarget.bankAccountTitle || '—'}» اصلاح خواهد شد.
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
                onClick={() => { setVoidTarget(null); setVoidReason(''); }}
                disabled={isVoiding}
                className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
              >
                انصراف
              </button>
              <button
                onClick={handleVoidSubmit}
                disabled={isVoiding}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {isVoiding ? 'در حال ابطال...' : 'ابطال با سند معکوس'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Define / Edit Bank Account Modal */}
      {isBankModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4">
              {editingBank ? `ویرایش ${editingBank.title}` : 'تعریف حساب بانکی یا صندوق جدید'}
            </h3>

            <form onSubmit={handleSaveBank} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    کد حساب *
                  </label>
                  <input
                    type="text"
                    required
                    value={bankFormData.code}
                    onChange={e => setBankFormData({ ...bankFormData, code: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    نوع حساب
                  </label>
                  <select
                    value={bankFormData.type}
                    onChange={e => setBankFormData({ ...bankFormData, type: e.target.value as any })}
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
                  value={bankFormData.title}
                  onChange={e => setBankFormData({ ...bankFormData, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  اتصال به سرفصل کدینگ حسابداری (معین)
                </label>
                <AccountSearchSelect
                  accounts={safeAccounts}
                  value={bankFormData.accountId || ''}
                  onChange={(val) => setBankFormData({ ...bankFormData, accountId: val ? Number(val) : null })}
                  placeholder="جستجو و انتخاب سرفصل معین حسابداری..."
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  با اتصال حساب به کد معین، تمامی گردش‌های اسناد دوبل به صورت لحظه‌ای با این حساب تراز می‌شوند.
                </p>
              </div>

              {bankFormData.type !== 'cash' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        نام بانک
                      </label>
                      <input
                        type="text"
                        placeholder="ملت، ملی، سامان..."
                        value={bankFormData.bankName}
                        onChange={e => setBankFormData({ ...bankFormData, bankName: e.target.value })}
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
                        value={bankFormData.branch}
                        onChange={e => setBankFormData({ ...bankFormData, branch: e.target.value })}
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
                      value={bankFormData.cardNumber}
                      onChange={e => setBankFormData({ ...bankFormData, cardNumber: e.target.value })}
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
                      value={bankFormData.shebaNumber}
                      onChange={e => setBankFormData({ ...bankFormData, shebaNumber: e.target.value })}
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
                  value={bankFormData.initialBalance}
                  onChange={e => setBankFormData({ ...bankFormData, initialBalance: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsBankModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm"
                >
                  {isSaving ? 'در حال ثبت...' : 'ذخیره حساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Treasury Transaction Modal */}
      {isTxModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className={`p-1.5 rounded-lg ${txFormData.type === 'receipt' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                  {txFormData.type === 'receipt' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    {txFormData.type === 'receipt' ? 'ثبت رسید دریافت وجه' : 'ثبت اعلام پرداخت وجه'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {txFormData.type === 'receipt' ? 'دریافت نقدی / حواله / پایا / چک از مشتریان یا متفرقه' : 'پرداخت وجه به تامین‌کنندگان، پرسنل یا تسویه هزینه‌ها'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTx} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      تاریخ تراکنش *
                    </label>
                    <DatePicker
                      value={txFormData.date}
                      onChange={(dateObj: any) => {
                        setTxFormData({ ...txFormData, date: extractDateString(dateObj) });
                      }}
                      calendar={persian}
                      locale={persian_fa}
                      calendarPosition="bottom-right"
                      inputClass="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      containerClassName="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      روش پرداخت
                    </label>
                    <select
                      value={txFormData.method}
                      onChange={e => setTxFormData({ ...txFormData, method: e.target.value as any })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    >
                      <option value="bank_transfer">حواله / پایا / ساتنا</option>
                      <option value="pos">کارتخوان (POS)</option>
                      <option value="cash">نقدی / صندوق</option>
                      <option value="cheque">چک</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    حساب بانکی / صندوق مرتبط *
                  </label>
                  <select
                    required
                    value={txFormData.bankAccountId || ''}
                    onChange={e => setTxFormData({ ...txFormData, bankAccountId: Number(e.target.value) || null })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="">انتخاب حساب...</option>
                    {safeBankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.title} (موجودی: {formatPersianPrice(b.currentBalance)} {b.currency})
                      </option>
                    ))}
                  </select>
                  {/* V1.8.0: هشدار شفافیت — حساب بدون کدینگ سند صادر نمی‌کند */}
                  {txFormData.bankAccountId && !safeBankAccounts.find(b => b.id === txFormData.bankAccountId)?.accountId && (
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mt-1 leading-5">
                      ⚠️ این حساب به چارت حساب‌ها متصل نیست — سند دوبل صادر نخواهد شد. از ویرایش حساب، «اتصال به حساب معین» را تکمیل کنید.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      طرف حساب
                    </label>
                    <select
                      value={txFormData.partyType}
                      onChange={e => setTxFormData({
                        ...txFormData,
                        partyType: e.target.value as any,
                        partyId: null,
                        partyName: ''
                      })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    >
                      <option value="customer">مشتری</option>
                      <option value="supplier">تامین‌کننده</option>
                      <option value="personnel">پرسنل</option>
                      <option value="other">متفرقه</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      نام طرف حساب *
                    </label>
                    {txFormData.partyType === 'customer' ? (
                      <SearchableSelect
                        options={customerList.map(c => ({
                          value: String(c.id),
                          label: `${c.name}${c.city ? ` (${c.city})` : ''}${c.phone ? ` - ${c.phone}` : ''}`
                        }))}
                        value={txFormData.partyId ? String(txFormData.partyId) : ''}
                        onChange={(val) => {
                          const c = customerList.find(x => String(x.id) === val) || safeCustomers.find(x => String(x.id) === val);
                          setTxFormData({ ...txFormData, partyId: c ? c.id : null, partyName: c ? c.name : '' });
                        }}
                        placeholder="جستجو و انتخاب مشتری..."
                        maxResults={50}
                        className="w-full"
                      />
                    ) : txFormData.partyType === 'supplier' ? (
                      <SearchableSelect
                        options={supplierList.map(s => ({
                          value: String(s.id),
                          label: `${s.name}${s.supplierCategory ? ` [${s.supplierCategory}]` : ''}${s.city ? ` (${s.city})` : ''}${s.phone ? ` - ${s.phone}` : ''}`
                        }))}
                        value={txFormData.partyId ? String(txFormData.partyId) : ''}
                        onChange={(val) => {
                          const s = supplierList.find(x => String(x.id) === val) || safeCustomers.find(x => String(x.id) === val);
                          setTxFormData({ ...txFormData, partyId: s ? s.id : null, partyName: s ? s.name : '' });
                        }}
                        placeholder="جستجو و انتخاب تامین‌کننده..."
                        maxResults={50}
                        className="w-full"
                      />
                    ) : txFormData.partyType === 'personnel' ? (
                      <SearchableSelect
                        options={safePersonnelList.map(p => ({
                          value: String(p.id),
                          label: `${p.firstName} ${p.lastName}`.trim()
                        }))}
                        value={txFormData.partyId ? String(txFormData.partyId) : ''}
                        onChange={(val) => {
                          const p = safePersonnelList.find(x => String(x.id) === val);
                          setTxFormData({ ...txFormData, partyId: p ? p.id : null, partyName: p ? `${p.firstName} ${p.lastName}`.trim() : '' });
                        }}
                        placeholder="جستجو و انتخاب پرسنل..."
                        maxResults={50}
                        className="w-full"
                      />
                    ) : (
                      <input
                        type="text"
                        required
                        placeholder="نام شخص یا شرکت متفرقه..."
                        value={txFormData.partyName}
                        onChange={e => setTxFormData({ ...txFormData, partyName: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                      />
                    )}
                  </div>
                </div>

                {/* V1.8.0: نوع پرداخت به پرسنل — تعیین‌کننده طرف حساب سند */}
                {txFormData.partyType === 'personnel' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      نوع پرداخت به پرسنل *
                    </label>
                    <select
                      value={txFormData.purpose}
                      onChange={e => setTxFormData({ ...txFormData, purpose: e.target.value as any })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                    >
                      <option value="settlement">تسویه حقوق و دستمزد → بدهکار «حقوق پرداختنی»</option>
                      <option value="advance">مساعده / وام → بدهکار «مساعده و وام پرسنل»</option>
                      <option value="other">سایر</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      {`مبلغ (${curLbl}) *`}
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={txFormData.amount || ''}
                      onChange={e => setTxFormData({ ...txFormData, amount: parseFloat(e.target.value) || 0 })}
                      placeholder="1000000"
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono text-left font-bold"
                    />
                    {/* V1.5.0: هشدار سرریز مانده هنگام ورود */}
                    {txFormData.type === 'payment' && txFormData.bankAccountId && (() => {
                      const acc = safeBankAccounts.find(b => b.id === txFormData.bankAccountId);
                      return acc && txFormData.amount > Number(acc.currentBalance) ? (
                        <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mt-1">
                          ⚠️ مبلغ بیشتر از مانده «{acc.title}» ({formatPersianPrice(acc.currentBalance)}) است — ثبت با خطا مواجه خواهد شد.
                        </p>
                      ) : null;
                    })()}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      شماره پیگیری / ارجاع
                    </label>
                    <input
                      type="text"
                      placeholder="کد پیگیری تراکنش..."
                      value={txFormData.trackingNumber}
                      onChange={e => setTxFormData({ ...txFormData, trackingNumber: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    شرح و توضیحات
                  </label>
                  <input
                    type="text"
                    placeholder="بابت تسویه فاکتور / واریزی علی‌الحساب..."
                    value={txFormData.description}
                    onChange={e => setTxFormData({ ...txFormData, description: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="createVoucher"
                    checked={txFormData.createVoucher}
                    onChange={e => setTxFormData({ ...txFormData, createVoucher: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="createVoucher" className="text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                    صدور خودکار سند حسابداری دوبل برای این تراکنش
                  </label>
                </div>

                {/* پیوست اسناد مثبته و فیش واریز/رسید */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <FinancialAttachmentUploader
                    attachments={txFormData.attachments}
                    onChange={(atts) => setTxFormData(p => ({ ...p, attachments: atts }))}
                    title="پیوست تصویر فیش واریز / رسید پرداخت / اسناد مثبته"
                    description="امکان الصاق تصاویر با فشرده‌سازی خودکار هوشمند تا سقف ۳۰۰ کیلوبایت و PDF"
                  />
                </div>

                {/* V1.8.0: پیش‌نمایش زنده سند دوبل — شفافیت کامل قبل از ثبت */}
                {txFormData.createVoucher && txFormData.bankAccountId && txFormData.amount > 0 && (
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-black text-indigo-800 dark:text-indigo-300 flex items-center gap-1">
                        <ShieldCheck size={13} />
                        پیش‌نمایش سند دوبل (همان چیزی که صادر می‌شود)
                      </span>
                      {isPreviewLoading && <span className="text-[10px] text-slate-400">در حال محاسبه...</span>}
                    </div>
                    {voucherPreview?.debit && voucherPreview?.credit ? (
                      <table className="w-full text-[10px] border-collapse">
                        <thead>
                          <tr className="text-indigo-700 dark:text-indigo-300 border-b border-indigo-200 dark:border-indigo-800">
                            <th className="py-1 text-right">شرح</th>
                            <th className="py-1 text-right">حساب معین</th>
                            <th className="py-1 text-left">بدهکار</th>
                            <th className="py-1 text-left">بستانکار</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          <tr className="border-b border-indigo-100 dark:border-indigo-900/50">
                            <td className="py-1.5 font-sans font-bold text-slate-800 dark:text-slate-200">{voucherPreview.debit.detailedName}</td>
                            <td className="py-1.5 text-slate-600 dark:text-slate-300">{voucherPreview.debit.accountCode} — {voucherPreview.debit.accountName}</td>
                            <td className="py-1.5 text-left font-bold text-slate-900 dark:text-white">{formatPersianPrice(voucherPreview.debit.amount)}</td>
                            <td className="py-1.5 text-left text-slate-300">—</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 font-sans font-bold text-slate-800 dark:text-slate-200">{voucherPreview.credit.detailedName}</td>
                            <td className="py-1.5 text-slate-600 dark:text-slate-300">{voucherPreview.credit.accountCode} — {voucherPreview.credit.accountName}</td>
                            <td className="py-1.5 text-left text-slate-300">—</td>
                            <td className="py-1.5 text-left font-bold text-slate-900 dark:text-white">{formatPersianPrice(voucherPreview.credit.amount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : !isPreviewLoading ? (
                      <p className="text-[10px] font-bold text-slate-400">برای مشاهده پیش‌نمایش، مبلغ را وارد کنید.</p>
                    ) : null}
                    {voucherPreview?.warnings?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {voucherPreview.warnings.map((w: string, i: number) => (
                          <p key={i} className="text-[10px] font-bold text-amber-700 dark:text-amber-300 leading-5">⚠️ {w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Fixed Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50 transition cursor-pointer"
                >
                  {isSaving ? 'در حال ثبت...' : 'ثبت قطعی تراکنش'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* مدال پیش‌نمایش و دانلود تصاویر پیوست تراکنش‌ها */}
      {viewingAttachments && (
        <FinancialAttachmentViewerModal
          isOpen={!!viewingAttachments}
          onClose={() => setViewingAttachments(null)}
          title={viewingAttachments?.title || 'اسناد و مدارک پیوست'}
          attachments={viewingAttachments?.attachments || []}
        />
      )}
    </div>
  );
}
