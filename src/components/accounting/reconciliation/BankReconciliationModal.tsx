import React, { useState, useMemo, useRef } from 'react';
import { 
  ShieldCheck, 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  X, 
  ArrowDownLeft, 
  ArrowUpRight, 
  RefreshCw, 
  Check, 
  Filter,
  Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import { BankAccount } from '../../../types';
import { formatPersianNumber, formatPersianPrice } from '../../../utils';
import { confirmAction } from '../../ConfirmDialogHost';
import { 
  parseBankStatementBuffer, 
  matchStatementWithTransactions, 
  ReconcileMatchedRow,
  TreasuryTxCandidate 
} from './bankStatementMatcher';

interface BankReconciliationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankAccounts: BankAccount[];
  transactions: TreasuryTxCandidate[];
  initialBankAccountId?: number | string;
  onReconcileTransactions?: (bankAccountId: number, txIds: number[], batch: string, reconciled: boolean) => Promise<void>;
}

export function BankReconciliationModal({
  isOpen,
  onClose,
  bankAccounts,
  transactions,
  initialBankAccountId,
  onReconcileTransactions,
}: BankReconciliationModalProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    initialBankAccountId ? String(initialBankAccountId) : (bankAccounts[0]?.id ? String(bankAccounts[0].id) : '')
  );
  const [reconcileRows, setReconcileRows] = useState<ReconcileMatchedRow[]>([]);
  const [detectedBankName, setDetectedBankName] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  
  // فیلترها و جستجو
  const [activeSegmentTab, setActiveSegmentTab] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // حساب بانکی انتخاب‌شده
  const selectedBank = useMemo(() => {
    return bankAccounts.find(b => String(b.id) === String(selectedAccountId)) || null;
  }, [bankAccounts, selectedAccountId]);

  // تراکنش‌های حساب انتخابی
  const accountTxs = useMemo(() => {
    if (!selectedAccountId) return [];
    return transactions.filter(t => 
      (t as any).bankAccountId === Number(selectedAccountId) && 
      t.status !== 'voided' &&
      (t.isDeleted === undefined || t.isDeleted === 0)
    );
  }, [transactions, selectedAccountId]);

  // پردازش فایل اکسل صورت‌حساب
  const processFile = async (file: File) => {
    if (!selectedAccountId) {
      toast.error('لطفاً ابتدا حساب بانکی مورد نظر را انتخاب نمایید.');
      return;
    }

    setIsProcessingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const { rows, detectedBank } = parseBankStatementBuffer(buffer);

      if (!rows || rows.length === 0) {
        toast.error('هیچ ردیف معتبری دارای مبلغ در فایل اکسل یافت نشد.');
        return;
      }

      // تطبیق با تراکنش‌های خزانه‌داری
      const matched = matchStatementWithTransactions(rows, accountTxs);
      
      setReconcileRows(matched);
      setDetectedBankName(detectedBank || null);
      setUploadedFileName(file.name);
      
      const matchedCount = matched.filter(r => r.matchedTxId).length;
      const unmatchedCount = matched.length - matchedCount;
      
      toast.success(
        `صورت‌حساب پردازش شد: ${formatPersianNumber(matched.length)} ردیف ` +
        `(${formatPersianNumber(matchedCount)} تطبیق، ${formatPersianNumber(unmatchedCount)} مغایرت)`
      );
    } catch (err: any) {
      console.error('Error processing bank statement:', err);
      toast.error(err?.message || 'خطا در خواندن و تحلیل فایل صورت‌حساب اکسل');
    } finally {
      setIsProcessingFile(false);
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    e.target.value = '';
  };

  // آمار و محاسبات خلاصه
  const metrics = useMemo(() => {
    const totalRows = reconcileRows.length;
    const matchedRows = reconcileRows.filter(r => r.matchedTxId);
    const unmatchedRows = reconcileRows.filter(r => !r.matchedTxId);
    const newMatchedRows = matchedRows.filter(r => !r.alreadyReconciled);
    
    const totalDepositAmount = reconcileRows
      .filter(r => r.type === 'receipt')
      .reduce((sum, r) => sum + r.amount, 0);
      
    const totalWithdrawalAmount = reconcileRows
      .filter(r => r.type === 'payment')
      .reduce((sum, r) => sum + r.amount, 0);

    const matchPercentage = totalRows > 0 ? Math.round((matchedRows.length / totalRows) * 100) : 0;

    return {
      totalRows,
      matchedCount: matchedRows.length,
      unmatchedCount: unmatchedRows.length,
      newMatchedCount: newMatchedRows.length,
      newMatchedTxIds: newMatchedRows.map(r => r.matchedTxId as number),
      totalDepositAmount,
      totalWithdrawalAmount,
      matchPercentage,
    };
  }, [reconcileRows]);

  // اعمال فیلتر تب و جستجو
  const filteredRows = useMemo(() => {
    let result = reconcileRows;

    if (activeSegmentTab === 'matched') {
      result = result.filter(r => r.matchedTxId !== null);
    } else if (activeSegmentTab === 'unmatched') {
      result = result.filter(r => r.matchedTxId === null);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(r => 
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.tracking && r.tracking.includes(q)) ||
        (r.matchedTxNumber && r.matchedTxNumber.toLowerCase().includes(q)) ||
        (r.matchedTxParty && r.matchedTxParty.toLowerCase().includes(q)) ||
        String(r.amount).includes(q)
      );
    }

    return result;
  }, [reconcileRows, activeSegmentTab, searchQuery]);

  // ثبت نهایی تطبیق در دفاتر سیستم
  const handleCommitReconciliation = async () => {
    if (!onReconcileTransactions || !selectedAccountId) return;
    if (metrics.newMatchedTxIds.length === 0) {
      toast.error('هیچ ردیف تطبیق‌یافته جدیدی برای ثبت وجود ندارد.');
      return;
    }

    const ok = await confirmAction({
      title: 'ثبت قطعی تطبیق صورت‌حساب بانک',
      message: `آیا از علامت‌گذاری و ثبت ${formatPersianNumber(metrics.newMatchedTxIds.length)} تراکنش متناظر به‌عنوان «تطبیق‌یافته و کنترل‌شده با صورت‌حساب بانک» اطمینان دارید؟`
    });

    if (!ok) return;

    setIsCommitting(true);
    try {
      const batchCode = `reconcile-${Date.now()}`;
      await onReconcileTransactions(Number(selectedAccountId), metrics.newMatchedTxIds, batchCode, true);
      
      toast.success(
        `${formatPersianNumber(metrics.newMatchedTxIds.length)} تراکنش با موفقیت در دفاتر به‌عنوان تطبیق‌یافته ثبت شدند.`
      );
      
      // به‌روزرسانی وضعیت ردیف‌ها
      setReconcileRows(prev => prev.map(r => {
        if (r.matchedTxId && metrics.newMatchedTxIds.includes(r.matchedTxId)) {
          return { ...r, alreadyReconciled: true };
        }
        return r;
      }));
    } catch (err: any) {
      console.error('Error committing reconciliation:', err);
      toast.error(err?.message || 'خطا در ثبت تطبیق تراکنش‌ها در سرور');
    } finally {
      setIsCommitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-5xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in-50 zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/10 dark:bg-teal-400/20 text-teal-600 dark:text-teal-400 flex items-center justify-center shadow-xs">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                مغایرت‌گیری بانکی و تطبیق صورت‌حساب
                {detectedBankName && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/60">
                    {detectedBankName}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تطبیق خودکار فایل صورت‌حساب اکسل بانک با تراکنش‌های ثبت‌شده در خزانه‌داری
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          
          {/* بخش انتخاب حساب بانکی */}
          <div className="bg-slate-50 dark:bg-slate-850/50 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="w-full sm:w-80">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                حساب بانکی مورد بررسی *
              </label>
              <select
                value={selectedAccountId}
                onChange={e => {
                  setSelectedAccountId(e.target.value);
                  setReconcileRows([]);
                  setUploadedFileName(null);
                  setDetectedBankName(null);
                }}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl font-bold focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-hidden"
              >
                <option value="">انتخاب حساب بانکی...</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.title} {b.accountNumber ? `(${b.accountNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedBank && (
              <div className="flex items-center gap-4 text-xs">
                <div className="bg-white dark:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-400 block text-[10px]">مانده دفاتر خزانه‌داری:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                    {formatPersianPrice(Number(selectedBank.currentBalance ?? selectedBank.treasuryBalance ?? 0))}
                  </span>
                </div>
                <div className="bg-white dark:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <span className="text-slate-400 block text-[10px]">تراکنش‌های فعال در سیستم:</span>
                  <span className="font-bold text-teal-600 dark:text-teal-400">
                    {formatPersianNumber(accountTxs.length)} تراکنش
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ناحیه Drag & Drop دریافت فایل اکسل */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed p-6 transition flex flex-col items-center justify-center text-center cursor-pointer ${
              isDragging
                ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20 scale-[0.99]'
                : uploadedFileName
                ? 'border-teal-300 dark:border-teal-700 bg-teal-50/20 dark:bg-teal-900/10 hover:border-teal-400'
                : 'border-slate-300 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-600 bg-slate-50/50 dark:bg-slate-800/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />

            {isProcessingFile ? (
              <div className="flex flex-col items-center gap-2 py-3">
                <RefreshCw size={28} className="text-teal-600 animate-spin" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  در حال خواندن فایل و تطبیق هوشمند تراکنش‌ها...
                </span>
              </div>
            ) : uploadedFileName ? (
              <div className="flex flex-col sm:flex-row items-center justify-between w-full max-w-2xl px-2 py-1 gap-3">
                <div className="flex items-center gap-3 text-right">
                  <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center">
                    <FileSpreadsheet size={22} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <span>{uploadedFileName}</span>
                      <CheckCircle2 size={14} className="text-teal-600" />
                    </div>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatPersianNumber(reconcileRows.length)} سطر با موفقیت استخراج و تحلیل شد
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-3 py-1.5 text-xs font-bold rounded-xl border border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/40 transition"
                >
                  تغییر فایل
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 flex items-center justify-center mb-1">
                  <UploadCloud size={26} />
                </div>
                <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                  فایل اکسل یا CSV صورت‌حساب بانک را اینجا بکشید یا برای انتخاب کلیک کنید
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xl leading-5">
                  پشتیبانی کامل از خروجی رسمی اینترنت‌بانک تمامی بانک‌های کشور (ملت، ملی، سامان، پاسارگاد، صادرات، تجارت، رسالت، سپه و ...) با تشخیص خودکار ستون‌های تاریخ، واریز/برداشت و کد پیگیری
                </p>
              </div>
            )}
          </div>

          {/* کارت‌های خلاصه وضعیت مغایرت‌گیری */}
          {reconcileRows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* کل سطرها */}
              <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">کل ردیف‌های صورت‌حساب</span>
                <span className="text-base sm:text-lg font-mono font-bold text-slate-800 dark:text-white">
                  {formatPersianNumber(metrics.totalRows)}
                </span>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                  <span>واریز: {formatPersianPrice(metrics.totalDepositAmount)}</span>
                </div>
              </div>

              {/* تطبیق‌یافته */}
              <div className="bg-teal-50/60 dark:bg-teal-950/20 p-3 rounded-2xl border border-teal-200/70 dark:border-teal-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-teal-700 dark:text-teal-300 font-medium">اقلام تطبیق‌یافته</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-teal-200/60 dark:bg-teal-800/60 text-teal-800 dark:text-teal-200">
                    {formatPersianNumber(metrics.matchPercentage)}٪
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-bold text-teal-700 dark:text-teal-300">
                  {formatPersianNumber(metrics.matchedCount)}
                </span>
                <div className="text-[10px] text-teal-600 dark:text-teal-400 mt-1 pt-1 border-t border-teal-200/50 dark:border-teal-800/50">
                  <span>منطبق با اسناد خزانه‌داری</span>
                </div>
              </div>

              {/* مغایرت‌ها (نیازمند اقدام) */}
              <div className="bg-amber-50/60 dark:bg-amber-950/20 p-3 rounded-2xl border border-amber-200/70 dark:border-amber-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">اقلام مغایرت‌دار</span>
                  {metrics.unmatchedCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-200/60 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200">
                      نیازمند بررسی
                    </span>
                  )}
                </div>
                <span className="text-base sm:text-lg font-mono font-bold text-amber-700 dark:text-amber-300">
                  {formatPersianNumber(metrics.unmatchedCount)}
                </span>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 pt-1 border-t border-amber-200/50 dark:border-amber-800/50">
                  <span>ثبت‌نشده در دفاتر سیستم</span>
                </div>
              </div>

              {/* آماده ثبت تطبیق */}
              <div className="bg-sky-50/60 dark:bg-sky-950/20 p-3 rounded-2xl border border-sky-200/70 dark:border-sky-800/50">
                <span className="text-[11px] text-sky-700 dark:text-sky-300 font-medium">آماده ثبت رسمی</span>
                <span className="text-base sm:text-lg font-mono font-bold text-sky-700 dark:text-sky-300">
                  {formatPersianNumber(metrics.newMatchedCount)}
                </span>
                <div className="text-[10px] text-sky-600 dark:text-sky-400 mt-1 pt-1 border-t border-sky-200/50 dark:border-sky-800/50">
                  <span>مورد جدید جهت ثبت</span>
                </div>
              </div>
            </div>
          )}

          {/* تب‌های قطعه‌بندی‌شده و جستجو */}
          {reconcileRows.length > 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
              {/* تب‌های سه‌گانه */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-750 p-1 rounded-xl text-xs font-bold">
                <button
                  onClick={() => setActiveSegmentTab('all')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    activeSegmentTab === 'all'
                      ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  همه اقلام ({formatPersianNumber(metrics.totalRows)})
                </button>
                <button
                  onClick={() => setActiveSegmentTab('matched')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    activeSegmentTab === 'matched'
                      ? 'bg-teal-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-teal-700 dark:hover:text-teal-300'
                  }`}
                >
                  <CheckCircle2 size={13} />
                  <span>تطبیق‌یافته ({formatPersianNumber(metrics.matchedCount)})</span>
                </button>
                <button
                  onClick={() => setActiveSegmentTab('unmatched')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    activeSegmentTab === 'unmatched'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-amber-700 dark:hover:text-amber-300'
                  }`}
                >
                  <AlertTriangle size={13} />
                  <span>نیازمند اقدام / مغایرت ({formatPersianNumber(metrics.unmatchedCount)})</span>
                </button>
              </div>

              {/* کادر جستجو */}
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو در شرح، پیگیری، طرف‌حساب..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pr-8 pl-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-hidden"
                />
              </div>
            </div>
          )}

          {/* جدول نتایج تطبیق */}
          {reconcileRows.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
              <div className="max-h-[38vh] overflow-y-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead className="bg-slate-100/80 dark:bg-slate-750 sticky top-0 z-10 text-[11px] font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="p-2.5 w-10 text-center">#</th>
                      <th className="p-2.5 w-20">نوع</th>
                      <th className="p-2.5 w-24">تاریخ بانک</th>
                      <th className="p-2.5">مبلغ تراکنش</th>
                      <th className="p-2.5">شرح صورت‌حساب / شماره پیگیری</th>
                      <th className="p-2.5">وضعیت تطبیق</th>
                      <th className="p-2.5">تراکنش متناظر در خزانه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400 text-xs">
                          موردی با شرایط فیلتر انتخابی یافت نشد.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map(row => {
                        const isMatched = Boolean(row.matchedTxId);
                        
                        return (
                          <tr 
                            key={row.rowNo}
                            className={`transition hover:bg-slate-50/80 dark:hover:bg-slate-750/50 ${
                              isMatched 
                                ? 'bg-teal-50/25 dark:bg-teal-950/10' 
                                : 'bg-amber-50/25 dark:bg-amber-950/10'
                            }`}
                          >
                            <td className="p-2.5 text-center text-slate-400 font-mono text-[11px]">
                              {formatPersianNumber(row.rowNo)}
                            </td>

                            <td className="p-2.5">
                              {row.type === 'receipt' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                                  <ArrowDownLeft size={11} />
                                  واریز
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/60">
                                  <ArrowUpRight size={11} />
                                  برداشت
                                </span>
                              )}
                            </td>

                            <td className="p-2.5 font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                              {row.date || '—'}
                            </td>

                            <td className="p-2.5 font-mono font-bold text-slate-900 dark:text-white">
                              {formatPersianPrice(row.amount)}
                            </td>

                            <td className="p-2.5 max-w-[240px]">
                              <div className="truncate text-slate-700 dark:text-slate-200 font-medium" title={row.description}>
                                {row.description || '—'}
                              </div>
                              {row.tracking && (
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                  کد ارجاع/پیگیری: {row.tracking}
                                </div>
                              )}
                            </td>

                            <td className="p-2.5">
                              {isMatched ? (
                                <div className="space-y-0.5">
                                  {row.matchQuality === 'tracking' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200/60 dark:border-emerald-800/60">
                                      <Check size={11} />
                                      تطبیق دقیق (پیگیری)
                                    </span>
                                  )}
                                  {row.matchQuality === 'amount_date' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-md border border-sky-200/60 dark:border-sky-800/60">
                                      <Check size={11} />
                                      تطبیق هوشمند مبلغ و تاریخ
                                    </span>
                                  )}
                                  {row.matchQuality === 'amount_only' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/60">
                                      تطبیق بر اساس مبلغ
                                    </span>
                                  )}
                                  {row.alreadyReconciled && (
                                    <span className="block text-[9px] text-slate-400">
                                      (قبلاً در دفاتر ثبت شده)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-800/60">
                                  <AlertTriangle size={11} />
                                  مغایرت (فاقد ثبت در دفاتر)
                                </span>
                              )}
                            </td>

                            <td className="p-2.5">
                              {row.matchedTxId ? (
                                <div>
                                  <div className="font-mono font-bold text-teal-700 dark:text-teal-400">
                                    {row.matchedTxNumber}
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
                                    {row.matchedTxParty}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[10px]">
                                  نیازمند صدور سند
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* راهنمای کوتاه در صورت عدم آپلود فایل */}
          {reconcileRows.length === 0 && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/40 border border-slate-200/60 dark:border-slate-700/60 flex items-start gap-3 text-xs text-slate-500 dark:text-slate-400 leading-6">
              <Info size={18} className="text-teal-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">
                  راهنمای سریع مغایرت‌گیری بانکی:
                </span>
                ۱. ابتدا حساب بانکی مورد نظر را از منوی بالا انتخاب کنید. <br />
                ۲. خروجی اکسل گردش حساب را از سامانه اینترنت‌بانک خود دانلود نموده و در کادر بالا رها کنید. <br />
                ۳. موتور سیستم به صورت خودکار واریزها، برداشت‌ها و شماره‌های پیگیری را شناسایی کرده و سطرهای متناظر در خزانه‌داری را پیدا می‌کند. <br />
                ۴. اقلام منطبق را با ۱ کلیک تأیید و ثبت نمایید و موارد مغایرت را برای بررسی و صدور سند مشخص کنید.
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/80 flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {reconcileRows.length > 0 && (
              <span>
                تعداد ردیف‌های آماده ثبت جدید: <strong className="text-teal-600 dark:text-teal-400">{formatPersianNumber(metrics.newMatchedCount)}</strong> مورد
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
            >
              بستن
            </button>

            {reconcileRows.length > 0 && metrics.newMatchedCount > 0 && (
              <button
                type="button"
                onClick={handleCommitReconciliation}
                disabled={isCommitting}
                className="px-4 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white rounded-xl shadow-sm transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isCommitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>در حال ثبت در دفاتر...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>ثبت تطبیق {formatPersianNumber(metrics.newMatchedCount)} تراکنش در دفاتر</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
