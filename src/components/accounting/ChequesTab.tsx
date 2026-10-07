import React, { useState, useEffect, useMemo } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { CreditCard, Plus, Search, ArrowDownLeft, ArrowUpRight, Trash2, X, History, Download, ShieldCheck, Copy, Edit3 } from 'lucide-react';
import * as xlsx from 'xlsx';
import { formatPersianPrice, formatPersianNumber, getTodayJalaliDate, getTodayIsoDate, formatPersianDate, formatCurrencyLabel, errorMessageOf, toStorageDate, isoToJalaliDate, toEnglishDigits } from '../../utils';
import { SearchableSelect } from '../SearchableSelect';
import { ActionMenu } from '../ActionMenu';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { Cheque, ChequeType, ChequeStatus, BankAccountOption, Customer, Personnel, FinancialAttachment } from '../../types';
import toast from 'react-hot-toast';
import { JalaliDateInput } from '../common/JalaliDateInput';
import { FinancialAttachmentUploader } from './FinancialAttachmentUploader';
import { FinancialAttachmentBadge } from './FinancialAttachmentBadge';
import { FinancialAttachmentViewerModal } from './FinancialAttachmentViewerModal';
import { FinancialAmountInput } from '../common/FinancialAmountInput';
import { useChequeReconciliationReport } from '../../hooks/accounting/useChequeQueries';
import { copyToClipboard } from '../../utils/clipboard';
import { CHEQUE_STATUS_LABELS, CHEQUE_TRANSITIONS, chequeHasNextStep, chequeStatusLabel } from '../../lib/treasury/chequeTransitions';
import { needsChosenContraAccount, type PersonnelPurpose } from '../../lib/treasury/partyPurpose';
import { PartyPurposeFields } from './treasury/PartyPurposeFields';

interface ChequesTabProps {
  cheques: Cheque[];
  /** v9.0.97 (TD-505): فهرست انتخاب حساب‌های خزانه، بی شماره حساب و مانده */
  bankAccounts: BankAccountOption[];
  customers: Customer[];
  personnelList: Personnel[];
  loading: boolean;
  onRefresh: () => void;
  onCreateCheque: (data: any) => Promise<void>;
  onUpdateStatus: (id: number, status: ChequeStatus, description?: string, bankAccountId?: number, transfereePartyId?: number, actionDate?: string) => Promise<void>;
  onDeleteCheque: (id: number) => Promise<void>;
}

export function ChequesTab({
  cheques,
  bankAccounts,
  customers,
  personnelList,
  loading,
  onRefresh,
  onCreateCheque,
  onUpdateStatus,
  onDeleteCheque,
}: ChequesTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeCheques = Array.isArray(cheques) ? cheques : [];
  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

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
    // v9.0.84 (TD-497): سرور فقط تأمین‌کننده (یا «هر دو») را می‌پذیرد؛ پیش‌تر نبود تأمین‌کننده همه مشتریان را فهرست می‌کرد
    return list;
  }, [safeCustomers]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newFormData, setNewFormData] = useState({
    type: 'received' as ChequeType,
    chequeNumber: '',
    sayadNumber: '',
    bankName: '',
    branch: '',
    // v9.0.106 (TD-515): تاریخ‌های فرم ISO هستند و `JalaliDateInput` آن‌ها را شمسی نشان می‌دهد؛ امروز از منطقه زمانی نمایش
    issueDate: getTodayIsoDate(),
    dueDate: '',
    amount: 0,
    currency: 'IRR',
    partyType: 'customer' as 'customer' | 'personnel' | 'supplier' | 'other',
    partyId: null as number | null,
    partyName: '',
    // v9.0.84 (TD-497، ت۲ الف): هدف چک پرسنل و سرفصل طرف مقابل «متفرقه» و «سایر»
    purpose: '' as PersonnelPurpose | '',
    contraAccountId: null as number | null,
    drawerName: '',
    payeeName: '',
    bankAccountId: null as number | null,
    description: '',
    attachments: [] as FinancialAttachment[],
  });

  const [viewingAttachments, setViewingAttachments] = useState<{ title: string; attachments: FinancialAttachment[] } | null>(null);
  const [statusModalCheque, setStatusModalCheque] = useState<Cheque | null>(null);
  const [targetStatus, setTargetStatus] = useState<ChequeStatus>('passed');
  const [statusDescription, setStatusDescription] = useState('');
  // v9.0.98 (TD-506، ت۶ الف): تاریخ اقدام (ISO)؛ پیش‌فرض امروز، سند گام چک به همین تاریخ صادر می‌شود
  const [statusActionDate, setStatusActionDate] = useState('');
  const [targetBankAccountId, setTargetBankAccountId] = useState<number | null>(null);
  const [transfereePartyId, setTransfereePartyId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [historyModalCheque, setHistoryModalCheque] = useState<Cheque | null>(null);

  // v9.0.105 (TD-513): برچسب‌ها همان نگاشت مشترک سرور و رابط است
  const statusLabels: Record<ChequeStatus, { label: string; badge: string }> = {
    received: { label: CHEQUE_STATUS_LABELS.received, badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    in_treasury: { label: CHEQUE_STATUS_LABELS.in_treasury, badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
    in_safe: { label: CHEQUE_STATUS_LABELS.in_safe, badge: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
    in_collection: { label: CHEQUE_STATUS_LABELS.in_collection, badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    passed: { label: CHEQUE_STATUS_LABELS.passed, badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    bounced: { label: CHEQUE_STATUS_LABELS.bounced, badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
    returned: { label: CHEQUE_STATUS_LABELS.returned, badge: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
    spent: { label: CHEQUE_STATUS_LABELS.spent, badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  };

  const STATUS_OPTIONS: Record<string, { value: ChequeStatus; label: string }[]> = {
    received: [
      { value: 'in_treasury', label: 'نگهداری نزد صندوق' },
      { value: 'in_collection', label: 'خواباندن به حساب (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'spent', label: 'واگذاری و خرج چک به غیر (تأمین‌کننده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    in_treasury: [
      { value: 'in_collection', label: 'ارسال به بانک (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'spent', label: 'واگذاری و خرج چک به غیر (تأمین‌کننده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    in_safe: [
      { value: 'in_collection', label: 'ارسال به بانک (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'spent', label: 'واگذاری و خرج چک به غیر (تأمین‌کننده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    in_collection: [
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    bounced: [
      { value: 'returned', label: 'عودت چک به صادرکننده (پایان پیگیری)' },
    ],
    passed: [],
    returned: [],
    spent: [],
  };
  const allowedStatusOptions: { value: ChequeStatus; label: string }[] = statusModalCheque
    ? (STATUS_OPTIONS[String(statusModalCheque.status)] || []).filter(o => {
        if (o.value === 'spent' && statusModalCheque.type === 'paid') return false;
        return true;
      })
    : [];

  // باز شدن مودال: وضعیت هدف به اولین گزینه مجاز ریست شود
  useEffect(() => {
    if (statusModalCheque) {
      const opts = CHEQUE_TRANSITIONS[String(statusModalCheque.status)] || [];
      setTargetStatus(opts[0] || ('passed' as ChequeStatus));
      setTransfereePartyId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusModalCheque?.id]);

  const handleCreateCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFormData.chequeNumber.trim() || !newFormData.bankName.trim() || !newFormData.dueDate.trim()) {
      toast.error('شماره چک، نام بانک و تاریخ سررسید الزامی است');
      return;
    }
    if (!newFormData.partyName.trim()) {
      toast.error('نام طرف حساب الزامی است');
      return;
    }
    if (newFormData.amount <= 0) {
      toast.error('مبلغ چک باید بزرگتر از صفر باشد');
      return;
    }
    const needsContra = needsChosenContraAccount(newFormData.partyType, newFormData.purpose);
    if (needsContra && !newFormData.contraAccountId) {
      toast.error('سرفصل طرف مقابل را انتخاب کنید.');
      return;
    }

    setIsSaving(true);
    try {
      await onCreateCheque({
        ...newFormData,
        purpose: newFormData.partyType === 'personnel' ? newFormData.purpose : undefined,
        contraAccountId: needsContra ? newFormData.contraAccountId : null,
      });
      toast.success('چک با موفقیت در سیستم ثبت شد');
      setIsNewModalOpen(false);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت چک');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalCheque) return;
    // V1.4.0: گارد وضعیت پایانی — هیچ انتقالی از وضعیت‌های پایانی مجاز نیست
    if (!allowedStatusOptions.some(o => o.value === targetStatus)) {
      toast.error('وضعیت انتخابی برای این چک مجاز نیست');
      return;
    }
    // v9.0.85 (TD-498، تصمیم ت۳ الف): خرج چک بی تأمین‌کننده انتخاب‌شده فرستاده نمی‌شود
    if (targetStatus === 'spent' && !transfereePartyId) {
      toast.error('تأمین‌کننده‌ای را که چک به او واگذار می‌شود انتخاب کنید');
      return;
    }
    if (!statusActionDate) {
      toast.error('تاریخ اقدام را وارد کنید');
      return;
    }
    if (statusActionDate > getTodayIsoDate()) {
      toast.error('تاریخ اقدام نمی‌تواند پس از امروز باشد');
      return;
    }

    setIsSaving(true);
    try {
      await onUpdateStatus(
        statusModalCheque.id, 
        targetStatus, 
        statusDescription, 
        targetBankAccountId || undefined,
        targetStatus === 'spent' ? transfereePartyId ?? undefined : undefined,
        statusActionDate
      );
      toast.success('وضعیت چک به‌روزرسانی شد');
      setStatusModalCheque(null);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در تغییر وضعیت چک');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (cheque: Cheque) => {
    if (!(await confirmAction({ title: 'حذف چک', message: `آیا از حذف چک شماره ${cheque.chequeNumber} (${cheque.bankName}) اطمینان دارید؟` }))) return;
    try {
      await onDeleteCheque(cheque.id);
      toast.success('چک حذف شد');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در حذف چک');
    }
  };

  // V1.5.0: فیلتر بازه سررسید
  const [dueFromFilter, setDueFromFilter] = useState('');
  const [dueToFilter, setDueToFilter] = useState('');
  // V1.6.0: آشتی‌سنجی دفتر چک
  // با React Query: درخواست با بسته شدن تب لغو می‌شود و خطا با پیام «خطا در آشتی‌سنجی دفتر چک» اعلام می‌شود
  const chequeReconciliation = useChequeReconciliationReport();
  const chqReconRows = chequeReconciliation.data ?? [];
  const isLoadingChqRecon = chequeReconciliation.loading;

  const handleLoadChequeReconciliation = async () => {
    if (isLoadingChqRecon) return;
    const rows = await chequeReconciliation.run({});
    if (Array.isArray(rows) && rows.length > 0) {
      const clean = rows.filter(r => Math.abs(r.discrepancy) < 0.01).length;
      toast.success(`آشتی‌سنجی انجام شد — ${clean} از ${rows.length} حساب بدون مغایرت`);
    }
  };

  const filteredCheques = safeCheques.filter(c => {
    // v8.0.108 (TD-385): شماره چک و صیادی با ارقام لاتین ذخیره می‌شوند؛ جست‌وجو با ارقام فارسی هم پیدا می‌کند
    const numberQuery = toEnglishDigits(searchQuery.trim());
    const matchSearch = !searchQuery.trim() ||
      toEnglishDigits(c.chequeNumber).includes(numberQuery) ||
      (c.sayadNumber && c.sayadNumber.includes(numberQuery)) ||
      c.partyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.bankName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = selectedTypeFilter === 'all' || c.type === selectedTypeFilter;
    const matchStatus = selectedStatusFilter === 'all' || c.status === selectedStatusFilter;
    // v7.0.133 (TD-232): سررسید میلادی ISO است و فیلتر شمسی انتخاب می‌شود؛ هر دو ISO مقایسه می‌شوند
    const due = toStorageDate(c.dueDate) || '';
    const dueFrom = toStorageDate(dueFromFilter) || '';
    const dueTo = toStorageDate(dueToFilter) || '';
    const matchDue = (!dueFrom || due >= dueFrom) && (!dueTo || due <= dueTo);
    return matchSearch && matchType && matchStatus && matchDue;
  });

  // V1.5.0: aging سررسید — روزهای باقی‌مانده تا سررسید (با تقویم جلالی)
  const getDueDays = (dueDate: string): number | null => {
    // v7.0.133 (TD-232): فاصله روز با تاریخ‌های ISO (پیش‌تر رشته شمسی با تقویم میلادی پارس می‌شد)
    const dueIso = toStorageDate(dueDate);
    const todayIso = toStorageDate(getTodayJalaliDate());
    if (!dueIso || !todayIso) return null;
    return Math.round((Date.parse(dueIso) - Date.parse(todayIso)) / 86400000);
  };

  const dueAging = (c: Cheque): { label: string; cls: string } => {
    const days = getDueDays(c.dueDate);
    if (days === null) return { label: '—', cls: 'text-slate-400' };
    const isOpen = !['passed', 'returned', 'spent'].includes(String(c.status));
    if (days < 0) return { label: `${Math.abs(days)} روز گذشته`, cls: 'text-rose-700 bg-rose-50 border-rose-200' };
    if (days === 0) return { label: 'سررسید امروز', cls: 'text-amber-700 bg-amber-50 border-amber-200' };
    if (days <= 3 && isOpen) return { label: `${days} روز مانده`, cls: 'text-amber-700 bg-amber-50 border-amber-200' };
    return { label: `${days} روز مانده`, cls: 'text-slate-600 bg-slate-50 border-slate-200' };
  };

  // V1.5.0: خروجی اکسل چک‌ها
  const handleExportChequesExcel = () => {
    try {
      const rows = filteredCheques.map((c, i) => {
        const days = getDueDays(c.dueDate);
        return {
          '#': i + 1,
          'نوع': c.type === 'received' ? 'دریافتی' : 'پرداختی',
          'شماره چک': c.chequeNumber,
          'شماره صیادی': c.sayadNumber || '',
          'بانک': c.bankName,
          'شعبه': c.branch || '',
          'طرف حساب': c.partyName,
          'تاریخ صدور': isoToJalaliDate(c.issueDate) || c.issueDate,
          'سررسید': isoToJalaliDate(c.dueDate) || c.dueDate,
          'وضعیت': chequeStatusLabel(c.status),
          'وضعیت سررسید': days === null ? '' : days < 0 ? `گذشته ${Math.abs(days)} روز` : `${days} روز مانده`,
          'مبلغ': Number(c.amount) || 0,
          'ارز': c.currency || 'IRR',
          'حساب مقصد': c.bankAccountTitle || '',
          'شرح': c.description || '',
        };
      });
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'دفتر چک صیادی');
      xlsx.writeFile(wb, `Cheques-${getTodayJalaliDate().replace(/\//g, '-')}.xlsx`);
      toast.success(`${rows.length} ردیف اکسل تهیه شد`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در تهیه اکسل');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white text-lg">دفتر چک صیادی (دریافتی و پرداختی)</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            پیگیری سررسید، گردش وضعیت صیادی، خواباندن به حساب و وصول با صدور سند خودکار
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* V1.6.0: آشتی‌سنجی دفتر چک با دفاتر دوبل */}
          <button
            onClick={() => void handleLoadChequeReconciliation()}
            disabled={isLoadingChqRecon}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs font-bold rounded-xl transition border border-teal-200 dark:border-teal-800 disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck size={16} />
            <span>{isLoadingChqRecon ? '...' : 'آشتی‌سنجی دفتر چک'}</span>
          </button>

          <button
            onClick={() => {
              setNewFormData({
                type: 'received',
              chequeNumber: '',
              sayadNumber: '',
              bankName: '',
              branch: '',
              issueDate: getTodayIsoDate(),
              dueDate: '',
              amount: 0,
              currency: 'IRR',
              partyType: 'customer',
              partyId: null,
              partyName: '',
              purpose: '',
              contraAccountId: null,
              drawerName: '',
              payeeName: '',
              bankAccountId: null,
              description: '',
              attachments: [],
            });
            setIsNewModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-indigo-900/20"
        >
          <Plus className="w-4 h-4" />
          <span>ثبت چک صیادی جدید</span>
        </button>
        </div>
      </div>

      {/* V1.6.0: Cheque Ledger Reconciliation Panel */}
      {chqReconRows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-teal-200 dark:border-teal-800 p-4 space-y-2">
          <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-teal-600" />
            آشتی‌سنجی دفتر چک با دفاتر دوبل
          </h4>
          <table className="w-full text-right border-collapse text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-700/50">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="p-2">کد حساب</th>
                <th className="p-2">عنوان</th>
                <th className="p-2 text-left">مانده دفتری</th>
                <th className="p-2 text-left">موردانتظار از دفتر چک</th>
                <th className="p-2 text-left">مغایرت</th>
                <th className="p-2 text-center">تعداد چک</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {chqReconRows.map(r => (
                <tr key={r.code}>
                  <td className="p-2 font-mono font-bold">{r.code}</td>
                  <td className="p-2 font-bold">{r.title}</td>
                  <td className="p-2 text-left font-mono">{formatPersianPrice(r.ledgerBalance)}</td>
                  <td className="p-2 text-left font-mono">{formatPersianPrice(r.expectedBalance)}</td>
                  <td className={`p-2 text-left font-mono font-black ${Math.abs(r.discrepancy) < 0.01 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                    {Math.abs(r.discrepancy) < 0.01 ? '✓ بدون مغایرت' : formatPersianPrice(r.discrepancy)}
                  </td>
                  <td className="p-2 text-center font-mono">{formatPersianNumber(r.counts.cheques)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="جستجو در شماره چک، شناسه صیاد ۱۶ رقمی، طرف حساب یا بانک..."
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
            <option value="all">همه انواع چک (دریافتی/پرداختی)</option>
            <option value="received">چک‌های دریافتی</option>
            <option value="paid">چک‌های پرداختی</option>
          </select>

          <select
            value={selectedStatusFilter}
            onChange={e => setSelectedStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
          >
            <option value="all">همه وضعیت‌ها</option>
            {/* v9.0.105 (TD-513): همه وضعیت‌ها، از جمله «در خزانه / صندوق» (چک پرداختی پاس‌نشده) */}
            {(Object.keys(CHEQUE_STATUS_LABELS) as ChequeStatus[]).map(status => (
              <option key={status} value={status}>{CHEQUE_STATUS_LABELS[status]}</option>
            ))}
          </select>

          {/* V1.5.0: بازه سررسید + اکسل */}
          <div className="flex items-center gap-1">
            <JalaliDateInput
              value={dueFromFilter}
              onChange={setDueFromFilter}
              calendarPosition="bottom-right"
              placeholder="سررسید از"
              className="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
              containerClassName="inline-block"
            />
            <span className="text-slate-400 text-[10px]">تا</span>
            <JalaliDateInput
              value={dueToFilter}
              onChange={setDueToFilter}
              calendarPosition="bottom-left"
              placeholder="سررسید تا"
              className="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
              containerClassName="inline-block"
            />
          </div>

          <button
            onClick={handleExportChequesExcel}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg transition-colors cursor-pointer shrink-0"
            title="خروجی اکسل چک‌های فیلترشده"
          >
            <Download size={14} />
            اکسل
          </button>
        </div>
      </div>

      {/* Cheques Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                <th className="py-3 px-3 w-10 text-center">#</th>
                <th className="py-3 px-3 w-24 text-center">نوع</th>
                <th className="py-3 px-4 w-44">شماره و صیاد</th>
                <th className="py-3 px-4">بانک و شعبه</th>
                <th className="py-3 px-4">طرف حساب</th>
                <th className="py-3 px-3 w-28 text-center">سررسید</th>
                <th className="py-3 px-4 w-36 text-left">{`مبلغ (${formatCurrencyLabel(cheques[0]?.currency || appCurrency)})`}</th>
                <th className="py-3 px-4 w-36 text-center">وضعیت</th>
                <th className="py-3 px-4 w-28 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
              {filteredCheques.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">چکی ثبت نشده است</td>
                </tr>
              ) : (
                filteredCheques.map((c, idx) => {
                  const statusInfo = statusLabels[c.status] || statusLabels.received;

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition">
                      <td className="py-3 px-3 text-center text-slate-400 font-bold">{idx + 1}</td>

                      <td className="py-3 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          c.type === 'received'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                        }`}>
                          {c.type === 'received' ? 'دریافتی' : 'پرداختی'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {c.chequeNumber}
                          </div>
                          {c.attachments && c.attachments.length > 0 && (
                            <FinancialAttachmentBadge
                              count={c.attachments.length}
                              onClick={() => setViewingAttachments({
                                title: `تصاویر و مدارک پیوست چک شماره ${c.chequeNumber} (${c.bankName})`,
                                attachments: c.attachments || []
                              })}
                            />
                          )}
                        </div>
                        {c.sayadNumber && (
                          <div className="text-[10px] font-mono text-slate-400 tracking-wider mt-0.5">
                            صیاد: {c.sayadNumber}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        <div className="font-semibold">{c.bankName}</div>
                        {c.branch && <div className="text-[10px] text-slate-400">شعبه: {c.branch}</div>}
                      </td>

                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">
                        {c.partyName}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <div className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {formatPersianDate(c.dueDate)}
                        </div>
                        {(() => {
                          const aging = dueAging(c);
                          return (
                            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border mt-0.5 ${aging.cls}`}>
                              {aging.label}
                            </span>
                          );
                        })()}
                      </td>

                      <td className="py-3 px-4 text-left font-mono font-black text-slate-900 dark:text-white">
                        {formatPersianPrice(c.amount)}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => {
                            setStatusModalCheque(c);
                            // وضعیت هدف توسط useEffect بر اساس اولین گزینه مجاز ریست می‌شود
                            setStatusDescription('');
                            setStatusActionDate(getTodayIsoDate());
                            setTargetBankAccountId(c.bankAccountId || bankAccounts[0]?.id || null);
                          }}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition hover:opacity-80 ${statusInfo.badge}`}
                        >
                          {statusInfo.label}
                        </button>
                      </td>

                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setHistoryModalCheque(c)}
                            title="تاریخچه وضعیت چک"
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <ActionMenu
                            items={[
                              // v9.0.69 (TD-502، ت۹): وضعیت پایانی نه تغییر وضعیت دارد نه حذف
                              ...(chequeHasNextStep(c.status) ? [{
                                label: 'تغییر وضعیت چک',
                                icon: Edit3,
                                onClick: () => {
                                  setStatusModalCheque(c);
                                  setStatusDescription('');
                                  setStatusActionDate(getTodayIsoDate());
                                  setTargetBankAccountId(c.bankAccountId || bankAccounts[0]?.id || null);
                                },
                              }] : []),
                              {
                                label: 'تاریخچه گردش وضعیت',
                                icon: History,
                                onClick: () => setHistoryModalCheque(c),
                              },
                              ...(c.sayadNumber
                                ? [
                                    {
                                      label: 'کپی شناسه صیاد',
                                      icon: Copy,
                                      onClick: () => {
                                        void copyToClipboard(String(c.sayadNumber)).then(ok => {
                                          if (ok) toast.success('شناسه صیاد کپی شد');
                                          else toast.error('کپی نشد؛ متن را دستی انتخاب و کپی کنید');
                                        });
                                      },
                                    },
                                  ]
                                : []),
                              {
                                label: 'کپی شماره چک',
                                icon: Copy,
                                onClick: () => {
                                  void copyToClipboard(c.chequeNumber).then(ok => {
                                    if (ok) toast.success('شماره چک کپی شد');
                                    else toast.error('کپی نشد؛ متن را دستی انتخاب و کپی کنید');
                                  });
                                },
                              },
                              ...(chequeHasNextStep(c.status) ? [{
                                label: 'حذف چک',
                                icon: Trash2,
                                variant: 'danger' as const,
                                onClick: () => { void handleDelete(c); },
                              }] : []),
                            ]}
                            align="left"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Cheque Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className={`p-1.5 rounded-lg ${newFormData.type === 'received' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                  {newFormData.type === 'received' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    ثبت مشخصات چک صیادی جدید
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {newFormData.type === 'received' ? 'ثبت چک دریافت شده از مشتریان' : 'ثبت چک پرداختی به تأمین‌کنندگان'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCheque} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      نوع چک *
                    </label>
                    <select
                      value={newFormData.type}
                      onChange={e => {
                        const nextType = e.target.value as ChequeType;
                        setNewFormData({
                          ...newFormData,
                          type: nextType,
                          partyType: nextType === 'paid' ? 'supplier' : 'customer',
                          partyId: null,
                          partyName: ''
                        });
                      }}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                    >
                      <option value="received">چک دریافتی (از مشتری)</option>
                      <option value="paid">چک پرداختی (به تأمین‌کننده)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      شماره چک (سریال) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: 123456"
                      value={newFormData.chequeNumber}
                      onChange={e => setNewFormData({ ...newFormData, chequeNumber: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    شناسه صیاد ۱۶ رقمی
                  </label>
                  <input
                    type="text"
                    maxLength={16}
                    placeholder="1234567890123456"
                    value={newFormData.sayadNumber}
                    onChange={e => setNewFormData({ ...newFormData, sayadNumber: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono tracking-widest text-left"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      نام بانک صادرکننده *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: بانک ملت"
                      value={newFormData.bankName}
                      onChange={e => setNewFormData({ ...newFormData, bankName: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      شعبه
                    </label>
                    <input
                      type="text"
                      placeholder="کد یا نام شعبه"
                      value={newFormData.branch}
                      onChange={e => setNewFormData({ ...newFormData, branch: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      تاریخ صدور
                    </label>
                    <JalaliDateInput
                      value={newFormData.issueDate}
                      onChange={iso => setNewFormData({ ...newFormData, issueDate: iso })}
                      calendarPosition="bottom-right"
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      containerClassName="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      تاریخ سررسید *
                    </label>
                    <JalaliDateInput
                      value={newFormData.dueDate}
                      onChange={iso => setNewFormData({ ...newFormData, dueDate: iso })}
                      calendarPosition="bottom-right"
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                      containerClassName="w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      طرف حساب
                    </label>
                    <select
                      value={newFormData.partyType}
                      onChange={e => setNewFormData({ ...newFormData, partyType: e.target.value as any, partyId: null, partyName: '', purpose: '', contraAccountId: null })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                    >
                      <option value="customer">مشتری</option>
                      <option value="supplier">تأمین‌کننده</option>
                      <option value="personnel">پرسنل</option>
                      <option value="other">متفرقه</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      نام طرف حساب *
                    </label>
                    {newFormData.partyType === 'customer' ? (
                      <SearchableSelect
                        value={String(newFormData.partyId || '')}
                        onChange={(val) => {
                          const c = customerList.find(x => x.id === Number(val)) || safeCustomers.find(x => x.id === Number(val));
                          setNewFormData({ ...newFormData, partyId: c ? c.id : null, partyName: c ? c.name : '' });
                        }}
                        placeholder="جستجو و انتخاب مشتری..."
                        options={customerList.map(c => ({
                          value: String(c.id),
                          label: `${c.name}${c.city ? ` (${c.city})` : ''}${c.phone ? ` - ${c.phone}` : ''}`
                        }))}
                      />
                    ) : newFormData.partyType === 'supplier' ? (
                      <SearchableSelect
                        value={String(newFormData.partyId || '')}
                        onChange={(val) => {
                          const s = supplierList.find(x => x.id === Number(val)) || safeCustomers.find(x => x.id === Number(val));
                          setNewFormData({ ...newFormData, partyId: s ? s.id : null, partyName: s ? s.name : '' });
                        }}
                        placeholder="جستجو و انتخاب تأمین‌کننده..."
                        options={supplierList.map(s => ({
                          value: String(s.id),
                          label: `${s.name}${s.supplierCategory ? ` [${s.supplierCategory}]` : ''}${s.city ? ` (${s.city})` : ''}${s.phone ? ` - ${s.phone}` : ''}`
                        }))}
                      />
                    ) : newFormData.partyType === 'personnel' ? (
                      <SearchableSelect
                        value={String(newFormData.partyId || '')}
                        onChange={(val) => {
                          const p = safePersonnelList.find(x => x.id === Number(val));
                          setNewFormData({ ...newFormData, partyId: p ? p.id : null, partyName: p ? `${p.firstName} ${p.lastName}`.trim() : '' });
                        }}
                        placeholder="جستجو و انتخاب پرسنل..."
                        options={safePersonnelList.map(p => ({
                          value: String(p.id),
                          label: `${p.firstName} ${p.lastName}`.trim()
                        }))}
                      />
                    ) : (
                      <input
                        type="text"
                        required
                        placeholder="نام شخص یا شرکت متفرقه..."
                        value={newFormData.partyName}
                        onChange={e => setNewFormData({ ...newFormData, partyName: e.target.value })}
                        className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                      />
                    )}
                  </div>
                </div>

                <PartyPurposeFields
                  partyType={newFormData.partyType}
                  purpose={newFormData.purpose}
                  contraAccountId={newFormData.contraAccountId}
                  isReceipt={newFormData.type === 'received'}
                  onChange={patch => setNewFormData(prev => ({ ...prev, ...patch }))}
                />

                <div>
                  <FinancialAmountInput
                    label="مبلغ چک"
                    required
                    min={1}
                    value={newFormData.amount}
                    currency={curLbl}
                    onChange={val => setNewFormData({ ...newFormData, amount: val })}
                    placeholder="50000000"
                    showWordsBadge={true}
                    showTomanEquivalent={true}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    توضیحات و بابت
                  </label>
                  <input
                    type="text"
                    placeholder="بابت تسویه فاکتور فروش شماره..."
                    value={newFormData.description}
                    onChange={e => setNewFormData({ ...newFormData, description: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  />
                </div>

                {/* الصاق تصاویر رو و پشت چک / رسید و مدارک */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <FinancialAttachmentUploader
                    attachments={newFormData.attachments}
                    onChange={(atts) => setNewFormData(p => ({ ...p, attachments: atts }))}
                    title="الصاق تصویر چک (رو و پشت چک) و مدارک پیوست"
                    description="امکان الصاق چند فایل تصویری و PDF با فشرده‌سازی خودکار هوشمند تا ۳۰۰ کیلوبایت"
                  />
                </div>
              </div>

              {/* Fixed Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50 transition cursor-pointer"
                >
                  {isSaving ? 'در حال ثبت...' : 'ثبت قطعی چک'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Status Workflow Modal */}
      {statusModalCheque && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-1">
              تغییر وضعیت چک شماره {statusModalCheque.chequeNumber}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              مبلغ: {formatPersianPrice(statusModalCheque.amount)} {statusModalCheque.currency} • سررسید: {formatPersianDate(statusModalCheque.dueDate)}
            </p>

            <form onSubmit={handleUpdateStatusSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  وضعیت جدید چک *
                </label>
                {allowedStatusOptions.length === 0 ? (
                  <div className="text-[11px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                    این چک در وضعیت پایانی «{chequeStatusLabel(statusModalCheque.status)}» است و تغییر وضعیت بیشتری ندارد.
                  </div>
                ) : (
                  <select
                    value={targetStatus}
                    onChange={e => setTargetStatus(e.target.value as ChequeStatus)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-bold"
                  >
                    {allowedStatusOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>

              {(targetStatus === 'in_collection' || targetStatus === 'passed') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    حساب بانکی مقصد *
                  </label>
                  <select
                    value={targetBankAccountId || ''}
                    onChange={e => setTargetBankAccountId(Number(e.target.value) || null)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                  >
                    <option value="">انتخاب حساب بانکی...</option>
                    {safeBankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({b.bankName})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetStatus === 'spent' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    تأمین‌کننده گیرنده چک *
                  </label>
                  <SearchableSelect
                    value={String(transfereePartyId || '')}
                    onChange={(val) => setTransfereePartyId(Number(val) || null)}
                    placeholder="جستجو و انتخاب تأمین‌کننده..."
                    options={supplierList.map(s => ({ value: String(s.id), label: `${s.name}${s.phone ? ` - ${s.phone}` : ''}` }))}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  تاریخ اقدام *
                </label>
                <JalaliDateInput
                  value={statusActionDate}
                  onChange={setStatusActionDate}
                  placeholder="تاریخ اقدام"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  شرح و یادداشت تغییر وضعیت
                </label>
                <textarea
                  rows={2}
                  value={statusDescription}
                  onChange={e => setStatusDescription(e.target.value)}
                  placeholder="مثال: وصول و واریز به حساب بانک ملت..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModalCheque(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50"
                >
                  {isSaving ? 'در حال ثبت...' : 'ثبت وضعیت و صدور سند'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModalCheque && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                سجل و تاریخچه گردش چک {historyModalCheque.chequeNumber}
              </h3>
              <button
                onClick={() => setHistoryModalCheque(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {(!historyModalCheque.statusHistory || !Array.isArray(historyModalCheque.statusHistory) || historyModalCheque.statusHistory.length === 0) ? (
                <div className="text-center py-6 text-slate-400 text-xs">تاریخچه‌ای ثبت نشده است</div>
              ) : (
                (historyModalCheque.statusHistory || []).map((h, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-100 dark:border-slate-700/60 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {chequeStatusLabel(h.status)}
                      </span>
                      <span className="text-slate-400 font-mono text-[10px]">{formatPersianDate(h.date)}</span>
                    </div>
                    {/* v9.0.105 (TD-513): سرور یادداشت را در notes می‌نویسد؛ description فقط برای تاریخچه‌های قدیمی */}
                    {(h.notes || h.description) && <p className="text-slate-600 dark:text-slate-300">{h.notes || h.description}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* مدال پیش‌نمایش و دانلود تصاویر پیوست چک‌ها */}
      {viewingAttachments && (
        <FinancialAttachmentViewerModal
          isOpen={!!viewingAttachments}
          onClose={() => setViewingAttachments(null)}
          title={viewingAttachments?.title || 'تصاویر و مدارک پیوست'}
          attachments={viewingAttachments?.attachments || []}
        />
      )}
    </div>
  );
}
