import React, { useState, useEffect, useMemo } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Trash2,
  Check,
  X,
  Calendar,
  History,
  Download,
  ShieldCheck,
  Copy,
  Edit3
} from 'lucide-react';
import * as xlsx from 'xlsx';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, getTodayJalaliDate, formatPersianDate, extractDateString, formatCurrencyLabel } from '../../utils';
import { SearchableSelect } from '../SearchableSelect';
import { ActionMenu } from '../ActionMenu';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { Cheque, ChequeType, ChequeStatus, BankAccount, Customer, Personnel } from '../../types';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import DateObject from "react-date-object";

interface ChequesTabProps {
  cheques: Cheque[];
  bankAccounts: BankAccount[];
  customers: Customer[];
  personnelList: Personnel[];
  loading: boolean;
  onRefresh: () => void;
  onCreateCheque: (data: any) => Promise<void>;
  onUpdateStatus: (id: number, status: ChequeStatus, description?: string, bankAccountId?: number) => Promise<void>;
  onDeleteCheque: (id: number) => Promise<void>;
  onLoadChequeReconciliation?: () => Promise<any[]>;
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
  onLoadChequeReconciliation,
}: ChequesTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  const safeCheques = Array.isArray(cheques) ? cheques : [];
  const safeBankAccounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safePersonnelList = Array.isArray(personnelList) ? personnelList : [];

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
    issueDate: new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).replace(/\//g, '-'),
    dueDate: '',
    amount: 0,
    currency: 'IRR',
    partyType: 'customer' as 'customer' | 'personnel' | 'supplier' | 'other',
    partyId: null as number | null,
    partyName: '',
    drawerName: '',
    payeeName: '',
    bankAccountId: null as number | null,
    description: '',
  });

  const [statusModalCheque, setStatusModalCheque] = useState<Cheque | null>(null);
  const [targetStatus, setTargetStatus] = useState<ChequeStatus>('passed');
  const [statusDescription, setStatusDescription] = useState('');
  const [targetBankAccountId, setTargetBankAccountId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [historyModalCheque, setHistoryModalCheque] = useState<Cheque | null>(null);

  const statusLabels: Record<ChequeStatus, { label: string; badge: string }> = {
    received: { label: 'دریافت شده', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    in_treasury: { label: 'در خزانه / صندوق', badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
    in_safe: { label: 'نزد صندوق', badge: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
    in_collection: { label: 'در جریان وصول (خوابانده به حساب)', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    passed: { label: 'وصول شده (پاس شده)', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    bounced: { label: 'واخواست / برگشت خورده', badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
    returned: { label: 'عودت داده شده به مشتری', badge: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
    spent: { label: 'خرج شده / واگذار به غیر', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  };

  // V1.4.0: ماشین وضعیت چک — فقط انتقال‌های مجاز (هماهنگ با بک‌اند)
  const CHEQUE_TRANSITIONS: Record<string, ChequeStatus[]> = {
    received: ['in_treasury', 'in_collection', 'passed', 'bounced'],
    in_treasury: ['in_collection', 'passed', 'bounced'],
    in_safe: ['in_collection', 'passed', 'bounced'],
    in_collection: ['passed', 'bounced'],
    passed: [],
    bounced: ['returned'],
    returned: [],
    spent: [],
  };
  const STATUS_OPTIONS: Record<string, { value: ChequeStatus; label: string }[]> = {
    received: [
      { value: 'in_treasury', label: 'نگهداری نزد صندوق' },
      { value: 'in_collection', label: 'خواباندن به حساب (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    in_treasury: [
      { value: 'in_collection', label: 'ارسال به بانک (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
      { value: 'bounced', label: 'برگشت / واخواست چک' },
    ],
    in_safe: [
      { value: 'in_collection', label: 'ارسال به بانک (در جریان وصول)' },
      { value: 'passed', label: 'وصول نهایی (پاس شده)' },
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
    ? (STATUS_OPTIONS[String(statusModalCheque.status)] || [])
    : [];

  // باز شدن مودال: وضعیت هدف به اولین گزینه مجاز ریست شود
  useEffect(() => {
    if (statusModalCheque) {
      const opts = CHEQUE_TRANSITIONS[String(statusModalCheque.status)] || [];
      setTargetStatus(opts[0] || ('passed' as ChequeStatus));
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

    setIsSaving(true);
    try {
      await onCreateCheque(newFormData);
      toast.success('چک با موفقیت در سیستم ثبت شد');
      setIsNewModalOpen(false);
    } catch (err) {
      toast.error(err.message || 'خطا در ثبت چک');
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

    setIsSaving(true);
    try {
      await onUpdateStatus(
        statusModalCheque.id, 
        targetStatus, 
        statusDescription, 
        targetBankAccountId || undefined
      );
      toast.success('وضعیت چک به‌روزرسانی شد');
      setStatusModalCheque(null);
    } catch (err) {
      toast.error(err.message || 'خطا در تغییر وضعیت چک');
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
      toast.error(err.message || 'خطا در حذف چک');
    }
  };

  // V1.5.0: فیلتر بازه سررسید
  const [dueFromFilter, setDueFromFilter] = useState('');
  const [dueToFilter, setDueToFilter] = useState('');
  // V1.6.0: آشتی‌سنجی دفتر چک
  const [chqReconRows, setChqReconRows] = useState<any[]>([]);
  const [isLoadingChqRecon, setIsLoadingChqRecon] = useState(false);

  const handleLoadChequeReconciliation = async () => {
    if (!onLoadChequeReconciliation) return;
    setIsLoadingChqRecon(true);
    try {
      const rows = await onLoadChequeReconciliation();
      setChqReconRows(Array.isArray(rows) ? rows : []);
      if (Array.isArray(rows) && rows.length > 0) {
        const clean = rows.filter(r => Math.abs(r.discrepancy) < 0.01).length;
        toast.success(`آشتی‌سنجی انجام شد — ${clean} از ${rows.length} حساب بدون مغایرت`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'خطا در آشتی‌سنجی دفتر چک');
    } finally {
      setIsLoadingChqRecon(false);
    }
  };

  const filteredCheques = safeCheques.filter(c => {
    const matchSearch = !searchQuery.trim() ||
      c.chequeNumber.includes(searchQuery.trim()) ||
      (c.sayadNumber && c.sayadNumber.includes(searchQuery.trim())) ||
      c.partyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.bankName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = selectedTypeFilter === 'all' || c.type === selectedTypeFilter;
    const matchStatus = selectedStatusFilter === 'all' || c.status === selectedStatusFilter;
    const due = toEnglishDigits(String(c.dueDate || '')).slice(0, 10);
    const matchDue = (!dueFromFilter || due >= dueFromFilter) && (!dueToFilter || due <= dueToFilter);
    return matchSearch && matchType && matchStatus && matchDue;
  });

  // V1.5.0: aging سررسید — روزهای باقی‌مانده تا سررسید (با تقویم جلالی)
  const getDueDays = (dueDate: string): number | null => {
    try {
      const d1 = new DateObject(toEnglishDigits(String(dueDate || '')).replace(/-/g, '/'));
      const d2 = new DateObject(getTodayJalaliDate().replace(/\//g, '-'));
      if (isNaN(d1.toDate().getTime())) return null;
      return Math.round((d1.toDate().getTime() - d2.toDate().getTime()) / 86400000);
    } catch {
      return null;
    }
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
          'تاریخ صدور': c.issueDate,
          'سررسید': c.dueDate,
          'وضعیت': statusLabels[c.status as ChequeStatus]?.label || c.status,
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
              issueDate: getTodayJalaliDate(),
              dueDate: '',
              amount: 0,
              currency: 'IRR',
              partyType: 'customer',
              partyId: null,
              partyName: '',
              drawerName: '',
              payeeName: '',
              bankAccountId: null,
              description: '',
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
            <option value="received">دریافت شده</option>
            <option value="in_collection">در جریان وصول</option>
            <option value="passed">وصول شده (پاس)</option>
            <option value="bounced">برگشت خورده</option>
            <option value="returned">عودت داده شده</option>
            <option value="spent">خرج شده</option>
          </select>

          {/* V1.5.0: بازه سررسید + اکسل */}
          <div className="flex items-center gap-1">
            <DatePicker
              value={dueFromFilter}
              onChange={(d: any) => setDueFromFilter(d ? extractDateString(d) : '')}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              placeholder="سررسید از"
              inputClass="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
              containerClassName="inline-block"
            />
            <span className="text-slate-400 text-[10px]">تا</span>
            <DatePicker
              value={dueToFilter}
              onChange={(d: any) => setDueToFilter(d ? extractDateString(d) : '')}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-left"
              placeholder="سررسید تا"
              inputClass="px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-center w-24"
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
                        <div className="font-mono font-bold text-slate-900 dark:text-white">
                          {c.chequeNumber}
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
                              {
                                label: 'تغییر وضعیت چک',
                                icon: Edit3,
                                onClick: () => {
                                  setStatusModalCheque(c);
                                  setStatusDescription('');
                                  setTargetBankAccountId(c.bankAccountId || bankAccounts[0]?.id || null);
                                },
                              },
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
                                        navigator.clipboard.writeText(c.sayadNumber);
                                        toast.success('شناسه صیاد کپی شد');
                                      },
                                    },
                                  ]
                                : []),
                              {
                                label: 'کپی شماره چک',
                                icon: Copy,
                                onClick: () => {
                                  navigator.clipboard.writeText(c.chequeNumber);
                                  toast.success('شماره چک کپی شد');
                                },
                              },
                              {
                                label: 'حذف چک',
                                icon: Trash2,
                                variant: 'danger',
                                onClick: () => handleDelete(c),
                              },
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-slate-900 dark:text-white text-base mb-4">
              ثبت مشخصات چک صیادی جدید
            </h3>

            <form onSubmit={handleCreateCheque} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    نوع چک *
                  </label>
                  <select
                    value={newFormData.type}
                    onChange={e => setNewFormData({ ...newFormData, type: e.target.value as ChequeType })}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
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
                  <DatePicker
                    value={newFormData.issueDate}
                    onChange={(dateObj: any) => {
                      setNewFormData({ ...newFormData, issueDate: extractDateString(dateObj) });
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
                    تاریخ سررسید *
                  </label>
                  <DatePicker
                    value={newFormData.dueDate}
                    onChange={(dateObj: any) => {
                      setNewFormData({ ...newFormData, dueDate: extractDateString(dateObj) });
                    }}
                    calendar={persian}
                    locale={persian_fa}
                    calendarPosition="bottom-right"
                    inputClass="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
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
                    onChange={e => setNewFormData({ ...newFormData, partyType: e.target.value as any, partyId: null, partyName: '' })}
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
                  {newFormData.partyType === 'customer' ? (
                    <SearchableSelect
                      value={String(newFormData.partyId || '')}
                      onChange={(val) => {
                        const c = safeCustomers.find(x => x.id === Number(val));
                        setNewFormData({ ...newFormData, partyId: c ? c.id : null, partyName: c ? c.name : '' });
                      }}
                      placeholder="انتخاب مشتری..."
                      options={[{ value: '', label: 'انتخاب مشتری...' },
                        ...(Array.isArray(safeCustomers) ? safeCustomers : []).map(c => ({ value: String(c.id), label: c.name }))]}
                    />
                  ) : newFormData.partyType === 'personnel' ? (
                    <SearchableSelect
                      value={String(newFormData.partyId || '')}
                      onChange={(val) => {
                        const p = safePersonnelList.find(x => x.id === Number(val));
                        setNewFormData({ ...newFormData, partyId: p ? p.id : null, partyName: p ? `${p.firstName} ${p.lastName}` : '' });
                      }}
                      placeholder="انتخاب پرسنل..."
                      options={[{ value: '', label: 'انتخاب پرسنل...' },
                        ...(Array.isArray(safePersonnelList) ? safePersonnelList : []).map(p => ({ value: String(p.id), label: `${p.firstName} ${p.lastName}` }))]}
                    />
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="نام شخص یا شرکت..."
                      value={newFormData.partyName}
                      onChange={e => setNewFormData({ ...newFormData, partyName: e.target.value })}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  {`مبلغ چک (${curLbl}) *`}
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="50000000"
                  value={newFormData.amount || ''}
                  onChange={e => setNewFormData({ ...newFormData, amount: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl font-mono font-black text-left"
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

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm disabled:opacity-50"
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700">
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
                    این چک در وضعیت پایانی «{String(statusModalCheque.status)}» است و تغییر وضعیت بیشتری ندارد.
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
                        {statusLabels[h.status as ChequeStatus]?.label || h.status}
                      </span>
                      <span className="text-slate-400 font-mono text-[10px]">{formatPersianDate(h.date)}</span>
                    </div>
                    {h.description && <p className="text-slate-600 dark:text-slate-300">{h.description}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
