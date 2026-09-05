import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  FileText, 
  Plus, 
  Search, 
  Filter, 
  Printer, 
  Edit3, 
  Trash2, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  Calendar,
  Layers,
  ArrowUpDown,
  Lock,
  RotateCcw,
  History,
  ShieldCheck,
  FileCheck,
  MoreVertical
} from 'lucide-react';
import { formatPersianPrice, formatPersianNumber, toEnglishDigits, formatPersianDate, extractDateString } from '../../utils';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import type { JournalVoucher, Account, Customer, Personnel } from '../../types';
import { VoucherReversalModal } from './VoucherReversalModal';
import { VoucherCorrectionModal } from './VoucherCorrectionModal';
import ConfirmModal from '../ConfirmModal';
import toast from 'react-hot-toast';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";

interface JournalVouchersTabProps {
  vouchers: JournalVoucher[];
  loading: boolean;
  accounts?: Account[];
  customers?: Customer[];
  personnelList?: Personnel[];
  onRefresh: () => void;
  onOpenNewVoucher: () => void;
  onEditVoucher: (voucher: JournalVoucher) => void;
  onDeleteVoucher: (id: number) => Promise<void>;
  onPrintVoucher: (voucher: JournalVoucher) => void;
  onReverseVoucher?: (voucherId: number, reason: string, date: string) => Promise<void>;
  onCorrectVoucher?: (voucherId: number, data: { reason: string; newItems: any[]; newDescription?: string; date?: string }) => Promise<void>;
  onFinalizeVoucher?: (voucherId: number) => Promise<void>;
  onApproveVoucher?: (voucherId: number) => Promise<any>;
  onSetVoucherStatus?: (voucherId: number, status: 'draft' | 'approved' | 'permanent', reason?: string) => Promise<any>;
  onBatchFinalizeVouchers?: (ids: number[]) => Promise<any>;
}

export function JournalVouchersTab({
  vouchers,
  loading,
  accounts = [],
  customers = [],
  personnelList = [],
  onRefresh,
  onOpenNewVoucher,
  onEditVoucher,
  onDeleteVoucher,
  onPrintVoucher,
  onReverseVoucher,
  onCorrectVoucher,
  onFinalizeVoucher,
  onApproveVoucher,
  onSetVoucherStatus,
  onBatchFinalizeVouchers,
}: JournalVouchersTabProps) {
  const appCurrency = useAppCurrency();
  const safeVouchers = Array.isArray(vouchers) ? vouchers : [];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedVoucherIds, setExpandedVoucherIds] = useState<Record<number, boolean>>({});
  const [openMenuVoucherId, setOpenMenuVoucherId] = useState<number | null>(null);

  // Close dropdown menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.voucher-action-menu-container')) {
        setOpenMenuVoucherId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Reversal & Correction modal state
  const [reversalTargetVoucher, setReversalTargetVoucher] = useState<JournalVoucher | null>(null);
  const [correctionTargetVoucher, setCorrectionTargetVoucher] = useState<JournalVoucher | null>(null);

  // Status counters for Subphase 2.1 segmented control
  const draftCount = useMemo(() => safeVouchers.filter(v => v.status === 'draft').length, [safeVouchers]);
  const approvedCount = useMemo(() => safeVouchers.filter(v => v.status === 'approved').length, [safeVouchers]);
  const permanentCount = useMemo(() => safeVouchers.filter(v => v.status === 'permanent').length, [safeVouchers]);
  const totalCount = safeVouchers.length;

  // دیالوگ تایید یکدست — ConfirmModal استاندارد
  type ConfirmAction = { kind: 'finalize' | 'approve' | 'revert_to_draft' | 'delete'; voucher: JournalVoucher } | null;
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const confirmBusy = useRef(false);

  const executeConfirmAction = async () => {
    if (!confirmAction || confirmBusy.current) return;
    confirmBusy.current = true;
    const { kind, voucher } = confirmAction;
    try {
      if (kind === 'delete') {
        await onDeleteVoucher(voucher.id);
        toast.success('سند حسابداری با موفقیت حذف شد');
      } else if (kind === 'finalize' && onFinalizeVoucher) {
        await onFinalizeVoucher(voucher.id);
      } else if (kind === 'approve' && onApproveVoucher) {
        await onApproveVoucher(voucher.id);
      } else if (kind === 'revert_to_draft' && onSetVoucherStatus) {
        await onSetVoucherStatus(voucher.id, 'draft', 'بازگشت به پیش‌نویس توسط کاربر');
      }
      setConfirmAction(null);
    } catch (err: any) {
      const labels = { finalize: 'قطعی‌سازی', approve: 'تایید', revert_to_draft: 'بازگشت به پیش‌نویس', delete: 'حذف' } as const;
      toast.error(err?.message || `خطا در ${labels[kind]} سند`);
      setConfirmAction(null);
    } finally {
      confirmBusy.current = false;
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedVoucherIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDelete = (voucher: JournalVoucher) => {
    if (voucher.status === 'permanent') {
      toast.error('اسناد دائم و قطعی‌شده قابل حذف مستقیم نیستند. لطفاً از گزینه «صدور سند برگشتی (ابطال سند)» استفاده فرمایید.');
      return;
    }
    if (voucher.status === 'approved') {
      toast.error('اسناد تاییدشده قابل حذف مستقیم نیستند. لطفاً ابتدا سند را به پیش‌نویس برگردانید.');
      return;
    }
    setConfirmAction({ kind: 'delete', voucher });
  };

  const handleFinalize = (voucher: JournalVoucher) => {
    if (voucher.status === 'permanent') return;
    setConfirmAction({ kind: 'finalize', voucher });
  };

  const handleApprove = (voucher: JournalVoucher) => {
    if (voucher.status === 'approved' || voucher.status === 'permanent') return;
    setConfirmAction({ kind: 'approve', voucher });
  };

  const handleRevertToDraft = (voucher: JournalVoucher) => {
    if (voucher.status === 'permanent') {
      toast.error('اسناد دائم و قطعی‌شده قابل تغییر وضعیت نیستند. لطفاً از گزینه «صدور سند برگشتی (ابطال سند)» استفاده فرمایید.');
      return;
    }
    setOpenMenuVoucherId(null);
    setConfirmAction({ kind: 'revert_to_draft', voucher });
  };

  const voucherTypeLabels: Record<string, { label: string; badge: string }> = {
    general: { label: 'عمومی', badge: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200' },
    sales: { label: 'فروش و درآمد', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
    purchase: { label: 'خرید و انبار', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    treasury: { label: 'خزانه‌داری / دریافت-پرداخت', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
    payroll: { label: 'حقوق و دستمزد', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
    closing: { label: 'افتتاحیه / اختتامیه', badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
    adjustment: { label: 'اصلاحی / معکوس', badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
  };

  const statusBadge = (status?: string) => {
    switch (status) {
      case 'permanent':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Lock className="w-2.5 h-2.5" />
            <span>دائم و قطعی</span>
          </span>
        );
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Clock className="w-2.5 h-2.5" />
            <span>پیش‌نویس</span>
          </span>
        );
      case 'approved':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <FileCheck className="w-2.5 h-2.5" />
            <span>تایید شده</span>
          </span>
        );
    }
  };

  const filteredVouchers = safeVouchers.filter(v => {
    const matchSearch = !searchQuery.trim() || 
      v.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
      String(v.voucherNumber).includes(searchQuery.trim()) ||
      (v.manualVoucherNumber && v.manualVoucherNumber.includes(searchQuery.trim())) ||
      (v.referenceNumber && v.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchType = selectedType === 'all' || v.voucherType === selectedType;
    const matchStatus = selectedStatus === 'all' || v.status === selectedStatus;
    const matchStart = !startDate || v.date >= startDate;
    const matchEnd = !endDate || v.date <= endDate;
    return matchSearch && matchType && matchStatus && matchStart && matchEnd;
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-white text-lg">دفتر ثبت اسناد حسابداری</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            مشاهده، ثبت دستی، تایید حسابرسی، قطعی‌سازی دفاتر، و صدور اسناد برگشتی و اصلاحی
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenNewVoucher}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-indigo-900/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>ثبت سند حسابداری جدید</span>
          </button>
        </div>
      </div>

      {/* Segmented 3-Status Selector Tabs (فاز ۲ نسخه ۳: تفکیک شفاف سه وضعیت اسناد) */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 dark:bg-slate-800/80 p-1.5 rounded-2xl border border-slate-200/70 dark:border-slate-700/70">
        <button
          onClick={() => setSelectedStatus('all')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            selectedStatus === 'all'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs border border-slate-200 dark:border-slate-600'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <span>همه اسناد حسابداری</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
            selectedStatus === 'all'
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold'
              : 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-400'
          }`}>
            {formatPersianNumber(totalCount)}
          </span>
        </button>

        <button
          onClick={() => setSelectedStatus('draft')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            selectedStatus === 'draft'
              ? 'bg-amber-500 text-white shadow-xs'
              : 'text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-950/40'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>پیش‌نویس‌ها (یادداشت اولیه)</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
            selectedStatus === 'draft'
              ? 'bg-white/20 text-white font-bold'
              : 'bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200'
          }`}>
            {formatPersianNumber(draftCount)}
          </span>
        </button>

        <button
          onClick={() => setSelectedStatus('approved')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            selectedStatus === 'approved'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-blue-800 dark:text-blue-300 hover:bg-blue-100/60 dark:hover:bg-blue-950/40'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5" />
          <span>تایید شده (حسابرسی‌شده)</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
            selectedStatus === 'approved'
              ? 'bg-white/20 text-white font-bold'
              : 'bg-blue-200/70 dark:bg-blue-900/60 text-blue-900 dark:text-blue-200'
          }`}>
            {formatPersianNumber(approvedCount)}
          </span>
        </button>

        <button
          onClick={() => setSelectedStatus('permanent')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            selectedStatus === 'permanent'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/40'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>دائم و قطعی (قفل دفاتر)</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
            selectedStatus === 'permanent'
              ? 'bg-white/20 text-white font-bold'
              : 'bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200'
          }`}>
            {formatPersianNumber(permanentCount)}
          </span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="جستجو در شماره سند، شرح یا عطف..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pr-9 pl-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {/* Type Filter */}
        <select
          value={selectedType}
          onChange={e => setSelectedType(e.target.value)}
          className="px-3 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
        >
          <option value="all">همه انواع اسناد</option>
          <option value="general">عمومی / عادی</option>
          <option value="sales">فروش و درآمد</option>
          <option value="purchase">خرید و انبار</option>
          <option value="treasury">دریافت و پرداخت</option>
          <option value="payroll">حقوق و دستمزد</option>
          <option value="closing">افتتاحیه / اختتامیه</option>
          <option value="adjustment">اصلاحی / برگشت</option>
        </select>

        {/* Date Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">از:</span>
            <DatePicker
              value={startDate}
              onChange={(dateObj: any) => setStartDate(extractDateString(dateObj))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="w-28 px-2.5 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              containerClassName="inline-block"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">تا:</span>
            <DatePicker
              value={endDate}
              onChange={(dateObj: any) => setEndDate(extractDateString(dateObj))}
              calendar={persian}
              locale={persian_fa}
              calendarPosition="bottom-right"
              inputClass="w-28 px-2.5 py-2 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              containerClassName="inline-block"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="text-xs text-rose-500 hover:text-rose-700 font-medium px-1.5 py-1 cursor-pointer"
            >
              پاک‌کردن تاریخ
            </button>
          )}
        </div>
      </div>

      {/* Vouchers Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-bold">
                <th className="py-3.5 px-3 w-10 text-center">#</th>
                <th className="py-3.5 px-3 w-28 text-center">شماره سند</th>
                <th className="py-3.5 px-3 w-28 text-center">تاریخ</th>
                <th className="py-3.5 px-3 w-32 text-center">وضعیت سند</th>
                <th className="py-3.5 px-3 w-32">نوع سند</th>
                <th className="py-3.5 px-4">شرح کلی سند</th>
                <th className="py-3.5 px-4 w-36 text-left">مبلغ کل (تراز)</th>
                <th className="py-3.5 px-3 w-28 text-center">ثبت‌کننده</th>
                <th className="py-3.5 px-4 w-48 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-xs">
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    {loading ? 'در حال بارگذاری اسناد...' : 'سندی با این مشخصات یافت نشد'}
                  </td>
                </tr>
              ) : (
                filteredVouchers.map(voucher => {
                  const isExpanded = !!expandedVoucherIds[voucher.id];
                  const typeInfo = voucherTypeLabels[voucher.voucherType] || voucherTypeLabels.general;
                  const isPermanent = voucher.status === 'permanent';

                  return (
                    <React.Fragment key={voucher.id}>
                      <tr className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition ${isPermanent ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : ''}`}>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => toggleExpand(voucher.id)}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded transition cursor-pointer"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>

                        <td className="py-3 px-3 text-center font-mono font-black text-slate-900 dark:text-white">
                          #{formatPersianNumber(voucher.voucherNumber)}
                        </td>

                        <td className="py-3 px-3 text-center font-mono text-slate-600 dark:text-slate-300">
                          {formatPersianDate(voucher.date)}
                        </td>

                        <td className="py-3 px-3 text-center">
                          {statusBadge(voucher.status)}
                        </td>

                        <td className="py-3 px-3">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeInfo.badge}`}>
                            {typeInfo.label}
                          </span>
                        </td>

                        <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                          <div>{voucher.description}</div>
                          {voucher.referenceNumber && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              ارجاع: {voucher.referenceModule} ({voucher.referenceNumber})
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-left font-mono font-black text-slate-900 dark:text-white">
                          {formatPersianPrice(voucher.totalDebit, voucher.currency || appCurrency)}
                        </td>

                        <td className="py-3 px-3 text-center text-slate-500 dark:text-slate-400">
                          {voucher.createdByUsername || 'کاربر'}
                        </td>

                        {/* Decluttered Actions Column (قانون طلایی ۱: خلوت‌سازی دکمه‌ها و منوی کشویی) */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* چاپ سریع */}
                            <button
                              onClick={() => onPrintVoucher(voucher)}
                              title="چاپ سند"
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:text-slate-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/40 rounded-lg transition cursor-pointer"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

                            {/* اقدام متنی اصلی */}
                            {voucher.status === 'draft' && onApproveVoucher ? (
                              <button
                                onClick={() => handleApprove(voucher)}
                                title="تایید حسابداری سند و انتقال به دفاتر رسمی"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-lg border border-blue-200 dark:border-blue-800 transition cursor-pointer shadow-xs"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                                <span>تایید سند</span>
                              </button>
                            ) : voucher.status === 'approved' && onFinalizeVoucher ? (
                              <button
                                onClick={() => handleFinalize(voucher)}
                                title="قطعی‌سازی و قفل سند در دفاتر رسمی"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 rounded-lg border border-emerald-200 dark:border-emerald-800 transition cursor-pointer shadow-xs"
                              >
                                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                                <span>قطعی‌سازی</span>
                              </button>
                            ) : (
                              <span 
                                title="سند دائم در دفاتر کل قفل است و تغییر مستقیم نمی‌پذیرد"
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                <span>قفل دفاتر</span>
                              </span>
                            )}

                            {/* منوی عملیات تکمیلی («...») */}
                            <div className="relative voucher-action-menu-container">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuVoucherId(openMenuVoucherId === voucher.id ? null : voucher.id);
                                }}
                                title="سایر عملیات سند"
                                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {openMenuVoucherId === voucher.id && (
                                <div 
                                  className="absolute left-0 mt-1 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1.5 z-40 animate-in fade-in zoom-in-95 text-right font-sans"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* گزینه‌های وضعیت پیش‌نویس */}
                                  {voucher.status === 'draft' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          onEditVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition cursor-pointer"
                                      >
                                        <Edit3 className="w-3.5 h-3.5 text-blue-500" />
                                        <span>ویرایش پیش‌نویس</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          handleDelete(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>حذف پیش‌نویس</span>
                                      </button>
                                    </>
                                  )}

                                  {/* گزینه‌های وضعیت تایید شده */}
                                  {voucher.status === 'approved' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          onEditVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition cursor-pointer"
                                      >
                                        <Edit3 className="w-3.5 h-3.5 text-blue-500" />
                                        <span>ویرایش مستقیم سند</span>
                                      </button>
                                      <button
                                        onClick={() => handleRevertToDraft(voucher)}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition cursor-pointer"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                                        <span>بازگشت به پیش‌نویس</span>
                                      </button>
                                      <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          setReversalTargetVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition cursor-pointer"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                                        <span>صدور سند برگشتی (ابطال سند)</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          setCorrectionTargetVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition cursor-pointer"
                                      >
                                        <History className="w-3.5 h-3.5 text-purple-500" />
                                        <span>صدور سند اصلاحی جایگزین</span>
                                      </button>
                                    </>
                                  )}

                                  {/* گزینه‌های وضعیت دائم و قطعی */}
                                  {voucher.status === 'permanent' && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          setReversalTargetVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition cursor-pointer"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                                        <span>صدور سند برگشتی (ابطال سند)</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setOpenMenuVoucherId(null);
                                          setCorrectionTargetVoucher(voucher);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition cursor-pointer"
                                      >
                                        <History className="w-3.5 h-3.5 text-purple-500" />
                                        <span>صدور سند اصلاحی جایگزین</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {/* Nested Expanded Articles */}
                      {isExpanded && voucher.items && (
                        <tr className="bg-slate-50/50 dark:bg-slate-850">
                          <td colSpan={9} className="p-3 pr-12">
                            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 shadow-inner">
                              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                                آرتیکل‌های تفکیکی سند شماره #{formatPersianNumber(voucher.voucherNumber)}:
                              </div>
                              <table className="w-full text-right border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400 text-[11px]">
                                    <th className="py-1 px-2 w-8 text-center">#</th>
                                    <th className="py-1 px-2 w-24 text-center">کد حساب</th>
                                    <th className="py-1 px-2">شرح حساب / تفصیلی</th>
                                    <th className="py-1 px-2">شرح ردیف</th>
                                    <th className="py-1 px-2 w-32 text-left">بدهکار</th>
                                    <th className="py-1 px-2 w-32 text-left">بستانکار</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {(Array.isArray(voucher.items) ? voucher.items : []).map((item, idx) => (
                                    <tr key={item.id || idx}>
                                      <td className="py-1.5 px-2 text-center text-slate-400">{idx + 1}</td>
                                      <td className="py-1.5 px-2 text-center font-mono font-bold">{item.accountCode || '-'}</td>
                                      <td className="py-1.5 px-2 font-medium">
                                        {item.accountName}
                                        {item.detailedName && (
                                          <span className="text-[10px] text-slate-400 mr-1.5">({item.detailedName})</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 px-2 text-slate-600 dark:text-slate-400">{item.description}</td>
                                      <td className="py-1.5 px-2 text-left font-mono font-bold text-slate-900 dark:text-white">
                                        {item.debit > 0 ? formatPersianPrice(item.debit) : '-'}
                                      </td>
                                      <td className="py-1.5 px-2 text-left font-mono font-bold text-slate-900 dark:text-white">
                                        {item.credit > 0 ? formatPersianPrice(item.credit) : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reversal Modal */}
      {reversalTargetVoucher && (
        <VoucherReversalModal
          isOpen={!!reversalTargetVoucher}
          onClose={() => setReversalTargetVoucher(null)}
          voucher={reversalTargetVoucher}
          onConfirm={async (voucherId, reason, date) => {
            if (onReverseVoucher) {
              await onReverseVoucher(voucherId, reason, date);
            }
          }}
        />
      )}

      {/* Correction Modal */}
      {correctionTargetVoucher && (
        <VoucherCorrectionModal
          isOpen={!!correctionTargetVoucher}
          onClose={() => setCorrectionTargetVoucher(null)}
          voucher={correctionTargetVoucher}
          accounts={accounts}
          customers={customers}
          personnelList={personnelList}
          onCorrect={async (voucherId, data) => {
            if (onCorrectVoucher) {
              await onCorrectVoucher(voucherId, data);
            }
          }}
        />
      )}

      {/* دیالوگ تایید استاندارد برای قطعی‌سازی / تایید / بازگشت به پیش‌نویس / حذف سند */}
      <ConfirmModal
        isOpen={!!confirmAction}
        title={
          confirmAction?.kind === 'finalize' ? 'قطعی‌سازی سند حسابداری'
          : confirmAction?.kind === 'approve' ? 'تایید حسابداری سند'
          : confirmAction?.kind === 'revert_to_draft' ? 'بازگشت سند به وضعیت پیش‌نویس'
          : 'حذف سند حسابداری'
        }
        message={
          confirmAction?.kind === 'finalize'
            ? `آیا از قطعی‌سازی و تبدیل سند شماره #${confirmAction?.voucher.voucherNumber} به سند دائم اطمینان دارید؟ پس از قطعی‌سازی، ویرایش یا حذف مستقیم سند غیرممکن خواهد بود و تنها از مسیر «صدور سند برگشتی (ابطال سند)» یا «سند اصلاحی» قابل اصلاح است.`
            : confirmAction?.kind === 'approve'
            ? `آیا از تایید حسابداری سند شماره #${confirmAction?.voucher.voucherNumber} اطمینان دارید؟ با تایید، سند در دفاتر و گزارش‌های مالی موثر خواهد بود.`
            : confirmAction?.kind === 'revert_to_draft'
            ? `آیا از بازگرداندن سند شماره #${confirmAction?.voucher.voucherNumber} به وضعیت پیش‌نویس اطمینان دارید؟ در صورت بازگشت، این سند موقتاً از دفاتر رسمی خارج شده و امکان ویرایش مجدد آن فراهم می‌شود.`
            : `آیا از حذف سند حسابداری شماره #${confirmAction?.voucher.voucherNumber} اطمینان دارید؟`
        }
        confirmText={
          confirmAction?.kind === 'delete' ? 'بله، حذف شود'
          : confirmAction?.kind === 'revert_to_draft' ? 'بله، بازگشت به پیش‌نویس'
          : 'بله، ثبت قطعی'
        }
        onConfirm={executeConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
