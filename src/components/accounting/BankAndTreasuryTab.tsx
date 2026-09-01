import React, { useState, useMemo } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
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
  Download
} from 'lucide-react';
import * as xlsx from 'xlsx';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, formatPersianDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { BankAccount, TreasuryTransaction, Customer, Personnel, Account } from '../../types';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { AccountSearchSelect } from './AccountSearchSelect';

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
}: BankAndTreasuryTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];
  const safeAccounts = Array.isArray(accounts) ? accounts : [];

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
  });

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
      partyType: 'customer',
      partyId: null,
      partyName: '',
      trackingNumber: '',
      description: '',
      createVoucher: true,
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
      await onCreateTreasuryTransaction(txFormData);
      toast.success('عملیات دریافت / پرداخت با موفقیت ثبت شد');
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
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!(await confirmAction({ title: 'حذف حساب بانکی', message: `آیا از حذف حساب ${bank.title} اطمینان دارید؟` }))) return;
                        try {
                          await onDeleteBankAccount(bank.id);
                          toast.success('حساب حذف شد');
                        } catch (e) {
                          toast.error(e.message || 'خطا در حذف حساب');
                        }
                      }}
                      title="حذف حساب"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
                        {tx.description || '-'}
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
                        {!isVoided && !tx.payrollId && (tx as any).reversalOfId == null && (
                          <button
                            onClick={() => { setVoidTarget(tx); setVoidReason(''); }}
                            title="ابطال تراکنش با سند معکوس"
                            className="px-2 py-1 text-[10px] font-bold border border-rose-200 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors cursor-pointer"
                          >
                            ابطال
                          </button>
                        )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4">
              {txFormData.type === 'receipt' ? 'ثبت رسید دریافت وجه' : 'ثبت اعلام پرداخت وجه'}
            </h3>

            <form onSubmit={handleSaveTx} className="space-y-3.5">
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
                    <option value="personnel">پرسنل</option>
                    <option value="other">متفرقه</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    نام طرف حساب *
                  </label>
                  {txFormData.partyType === 'customer' ? (
                    <select
                      value={txFormData.partyId || ''}
                      onChange={e => {
                        const c = safeCustomers.find(x => x.id === Number(e.target.value));
                        setTxFormData({ ...txFormData, partyId: c ? c.id : null, partyName: c ? c.name : '' });
                      }}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    >
                      <option value="">انتخاب مشتری...</option>
                      {safeCustomers.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : txFormData.partyType === 'personnel' ? (
                    <select
                      value={txFormData.partyId || ''}
                      onChange={e => {
                        const p = safePersonnelList.find(x => x.id === Number(e.target.value));
                        setTxFormData({ ...txFormData, partyId: p ? p.id : null, partyName: p ? `${p.firstName} ${p.lastName}` : '' });
                      }}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    >
                      <option value="">انتخاب پرسنل...</option>
                      {safePersonnelList.map(p => (
                        <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="نام شخص یا شرکت..."
                      value={txFormData.partyName}
                      onChange={e => setTxFormData({ ...txFormData, partyName: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    />
                  )}
                </div>
              </div>

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

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50"
                >
                  {isSaving ? 'در حال ثبت...' : 'ثبت قطعی تراکنش'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
