import { useState, useEffect, useMemo } from 'react';
import { Lock, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Scale, RefreshCw, ShieldCheck, Check, Layers, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { formatPersianPrice, toPersianDigits, formatPersianDate, formatCurrencyLabel, errorMessageOf } from '../../utils';
import { fiscalClosingJalaliDates } from '../../lib/fiscalClosingDates';
import { useAppCurrency } from '../../hooks/useAppCurrency';
import { FiscalYearClosingPreview, FiscalYearClosingResult, JournalVoucher, FiscalClosingAccountRow } from '../../types';
import toast from 'react-hot-toast';
import { useExecuteFiscalClosing, useFiscalClosingPreview, useFiscalClosingYears } from '../../hooks/accounting/useFiscalClosing';
import { FiscalYearReopenPanel } from './FiscalYearReopenPanel';

interface FiscalYearClosingTabProps {
  onViewVoucher?: (voucher: JournalVoucher) => void;
  onPrintVoucher?: (voucher: JournalVoucher) => void;
}

export function FiscalYearClosingTab({ onViewVoucher, onPrintVoucher }: FiscalYearClosingTabProps) {
  const appCurrency = useAppCurrency();
  const curLbl = formatCurrencyLabel(appCurrency);
  // v9.0.161 (TD-543، تصمیم ت۱ مالک محصول): فقط سال‌های تمام‌شده از سرور؛ سال جاری و آینده بسته نمی‌شوند. پیش‌تر فرم سال جاری
  // را پیش‌فرض داشت و همان را با یک تأیید می‌بست
  const yearsQuery = useFiscalClosingYears();
  const yearsInfo = yearsQuery.data;
  const yearRows = useMemo(() => yearsInfo?.years ?? [], [yearsInfo]);
  const [pickedYear, setPickedYear] = useState<string>('');
  const selectedYear = pickedYear || (yearsInfo?.defaultYear != null ? String(yearsInfo.defaultYear) : '');
  const selectedRow = yearRows.find(y => String(y.year) === selectedYear);
  const isSelectedClosed = selectedRow?.status === 'closed';
  // v8.0.47 (TD-310): تاریخ اختتامیه همیشه آخرین روز سال (۲۹ یا ۳۰ اسفند) و افتتاحیه ۱ فروردین سال بعد است
  const { closingDate, openingDateNewYear } = fiscalClosingJalaliDates(selectedYear);
  const [createOpeningVoucher, setCreateOpeningVoucher] = useState<boolean>(true);

  // پیش‌نمایش و اجرای بستن سال با React Query: پیش‌نمایش سال قبلی که دیر برسد جای پیش‌نمایش سال تازه را نمی‌گیرد
  const preview = useFiscalClosingPreview();
  const executeClosing = useExecuteFiscalClosing();
  const isLoadingPreview = preview.loading;
  const isExecuting = executeClosing.isPending;
  const previewData: FiscalYearClosingPreview | null = preview.data;
  const [executionResult, setExecutionResult] = useState<FiscalYearClosingResult | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    step1: true,
    step2: true,
    step3: true,
    step4: true,
  });

  const toggleSection = (step: string) => {
    setExpandedSections(prev => ({ ...prev, [step]: !prev[step] }));
  };

  const handleYearChange = (newYear: string) => {
    setPickedYear(newYear);
    preview.reset();
    setExecutionResult(null);
  };

  const loadPreview = async () => {
    if (!selectedYear) {
      toast.error('لطفاً سال مالی را مشخص کنید');
      return;
    }
    setExecutionResult(null);
    // خطا با پیام «خطا در محاسبه پیش‌نمایش بستن سال مالی» در خود پرس‌وجو اعلام می‌شود
    const data = await preview.run({ year: selectedYear, closingDate, openingDateNewYear });
    if (data !== undefined) {
      toast.success(`پیش‌نمایش بستن سال مالی ${toPersianDigits(selectedYear)} با موفقیت محاسبه شد.`);
    }
  };

  useEffect(() => {
    if (selectedYear) void loadPreview();
  }, [selectedYear]);

  // Computed safe values from previewData
  const safeTotalRevenue = previewData?.summary?.totalRevenue ?? previewData?.totalRevenues ?? previewData?.totalRevenue ?? 0;
  const safeTotalExpenses = previewData?.summary?.totalExpenses ?? ((previewData?.totalExpenses ?? 0) + (previewData?.totalCostOfSales ?? 0));
  const safeNetProfit = previewData?.summary?.netProfit ?? previewData?.netProfit ?? 0;
  const isNetProfitPositive = previewData?.summary?.isProfit ?? previewData?.isProfit ?? (safeNetProfit >= 0);
  const draftVoucherCount = previewData?.draftVoucherCount ?? 0;
  // v9.0.161 (TD-543): سال تمام‌نشده (پیش‌نمایش کهنه) یا بسته اجرا نمی‌شود
  const yearNotEnded = previewData?.yearEnded === false;
  // v9.0.162 (TD-544): سال‌ها به ترتیب بسته می‌شوند؛ سال پیشینِ دارای سند و باز این سال را نگه می‌دارد
  const earlierOpenYears = previewData?.earlierOpenYears ?? [];
  const earlierOpenText = earlierOpenYears.map(y => toPersianDigits(y)).join('، ');
  const closingBlocked = draftVoucherCount > 0 || yearNotEnded || isSelectedClosed || earlierOpenYears.length > 0;
  const closingBlockedReason = isSelectedClosed ? `سال مالی ${toPersianDigits(selectedYear)} بسته است`
    : yearNotEnded ? `سال مالی ${toPersianDigits(selectedYear)} هنوز تمام نشده است`
    : earlierOpenYears.length > 0 ? `ابتدا سال ${earlierOpenText} را ببندید`
    : draftVoucherCount > 0 ? 'ابتدا اسناد پیش‌نویس این سال را تأیید یا حذف کنید' : undefined;
  // v9.0.163 (TD-577): بی سند افتتاحیه، سال بعد بی مانده ابتدای دوره آغاز می‌شود
  const noOpeningVoucherText = `سند افتتاحیه صادر نمی‌شود؛ سال مالی ${toPersianDigits(Number(selectedYear) + 1)} بی مانده ابتدای دوره آغاز می‌شود`;

  // Normalize temporary accounts (revenue / expense)
  const { revenuesList, expensesList } = useMemo(() => {
    let revs: FiscalClosingAccountRow[] = [];
    let exps: FiscalClosingAccountRow[] = [];

    if (previewData?.temporaryAccounts) {
      if (Array.isArray(previewData.temporaryAccounts)) {
        revs = previewData.temporaryAccounts.filter(a => a.accountType === 'revenue');
        exps = previewData.temporaryAccounts.filter(a => a.accountType === 'expense' || a.accountType === 'cost_of_sales');
      } else if (typeof previewData.temporaryAccounts === 'object') {
        const rawObj = previewData.temporaryAccounts as { revenues?: unknown; expenses?: unknown };
        revs = Array.isArray(rawObj.revenues) ? rawObj.revenues : [];
        exps = Array.isArray(rawObj.expenses) ? rawObj.expenses : [];
      }
    }
    return { revenuesList: revs, expensesList: exps };
  }, [previewData]);

  // Normalize permanent accounts (assets / liabilities & equity)
  const { assetsList, liabilitiesAndEquityList } = useMemo(() => {
    let assets: FiscalClosingAccountRow[] = [];
    let liabs: FiscalClosingAccountRow[] = [];

    if (previewData?.permanentAccounts) {
      if (Array.isArray(previewData.permanentAccounts)) {
        assets = previewData.permanentAccounts.filter(a => a.accountType === 'asset');
        liabs = previewData.permanentAccounts.filter(a => a.accountType === 'liability' || a.accountType === 'equity');
      } else if (typeof previewData.permanentAccounts === 'object') {
        const rawObj = previewData.permanentAccounts as { assets?: unknown; liabilitiesAndEquity?: unknown };
        assets = Array.isArray(rawObj.assets) ? rawObj.assets : [];
        liabs = Array.isArray(rawObj.liabilitiesAndEquity) ? rawObj.liabilitiesAndEquity : [];
      }
    }
    return { assetsList: assets, liabilitiesAndEquityList: liabs };
  }, [previewData]);

  const handleExecuteClosing = async () => {
    if (executeClosing.isPending) return;
    try {
      const result = await executeClosing.mutateAsync({
        year: selectedYear,
        closingDate,
        openingDateNewYear,
        createOpeningVoucher,
      });

      setExecutionResult(result);
      setIsConfirmModalOpen(false);
      toast.success(result?.message || 'عملیات بستن سال مالی با موفقیت کامل انجام شد!');
    } catch (error) {
      toast.error(errorMessageOf(error) || 'خطا در بستن سال مالی');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Parameters */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Lock className="w-5 h-5" />
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                بستن سال مالی و صدور اسناد اختتامیه و افتتاحیه
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              این فرایند حساب‌های موقت (درآمد و هزینه) را بسته، سود/زیان سال را به سود انباشته منتقل کرده و با صدور سند اختتامیه و افتتاحیه، سال مالی جدید را آماده می‌کند.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                سال مالی:
              </label>
              <select
                value={selectedYear}
                onChange={e => handleYearChange(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-amber-500 outline-none"
              >
                {selectedYear === '' && <option value="">سال تمام‌شده‌ای نیست</option>}
                {yearRows.map(y => (
                  <option key={y.year} value={String(y.year)}>
                    سال مالی {toPersianDigits(y.year)}{y.status === 'closed' ? ' (بسته)' : ''}{y.hasVouchers ? '' : ' (بی سند)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                تاریخ سند اختتامیه:
              </span>
              <span data-testid="fiscal-closing-date" className="inline-block w-36 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold text-slate-800 dark:text-slate-200 text-center">
                {toPersianDigits(closingDate)}
              </span>
            </div>

            <div>
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                تاریخ افتتاحیه سال جدید:
              </span>
              <span data-testid="fiscal-opening-date" className="inline-block w-36 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold text-slate-800 dark:text-slate-200 text-center">
                {toPersianDigits(openingDateNewYear)}
              </span>
            </div>

            <div className="self-end">
              <button
                type="button"
                onClick={loadPreview}
                disabled={isLoadingPreview}
                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                محاسبه مجدد
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Execution Success Result Card (If executed) */}
      {executionResult && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in duration-300">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                سال مالی {toPersianDigits(selectedYear)} با موفقیت بسته شد!
              </h3>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                کلیه اسناد بستن حساب‌های موقت، انتقال سود/زیان و سند اختتامیه با موفقیت صادر شدند. اسناد در منوی اسناد حسابداری قابل مشاهده و چاپ هستند.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {executionResult.closingVouchers.map((v, idx) => (
              <div 
                key={v.id || idx}
                className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-200/80 dark:border-emerald-800/40 shadow-xs flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                    <span>سند شماره {toPersianDigits(v.voucher_number || v.voucherNumber)}</span>
                    <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                      {formatPersianDate(v.date)}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-2 line-clamp-2">
                    {v.description}
                  </h4>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {formatPersianPrice(v.total_debit || v.totalDebit, appCurrency)}
                  </span>
                  {onPrintVoucher && (
                    <button
                      onClick={() => onPrintVoucher(v)}
                      className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 flex items-center gap-1 font-semibold"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      چاپ
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards / Summary */}
      {previewData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">جمع کل درآمدها</span>
              <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                {formatPersianPrice(safeTotalRevenue, appCurrency)}
              </div>
              <span className="text-[11px] text-slate-400">
                {toPersianDigits(revenuesList.length)} حساب درآمدی
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">جمع کل هزینه‌ها</span>
              <div className="text-lg font-black text-rose-600 dark:text-rose-400">
                {formatPersianPrice(safeTotalExpenses, appCurrency)}
              </div>
              <span className="text-[11px] text-slate-400">
                {toPersianDigits(expensesList.length)} حساب هزینه‌ای
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <TrendingDown className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {isNetProfitPositive ? 'سود خالص سال' : 'زیان خالص سال'}
              </span>
              <div className={`text-lg font-black ${isNetProfitPositive ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {formatPersianPrice(Math.abs(safeNetProfit), appCurrency)}
              </div>
              <span className="text-[11px] text-slate-400">
                قابل انتقال به سود (زیان) انباشته
              </span>
            </div>
            <div className={`w-12 h-12 rounded-2xl ${isNetProfitPositive ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'} flex items-center justify-center`}>
              <Scale className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">حساب‌های دائمی (ترازنامه)</span>
              <div className="text-lg font-black text-slate-800 dark:text-slate-200">
                {toPersianDigits(assetsList.length + liabilitiesAndEquityList.length)} <span className="text-xs font-normal">حساب مانده‌دار</span>
              </div>
              <span className="text-[11px] text-slate-400">
                آماده انتقال به سند افتتاحیه {toPersianDigits(Number(selectedYear) + 1)}
              </span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
          </div>
        </div>
      )}

      {/* v9.0.122 (TD-543): سال جاری تا پایانش بسته نمی‌شود؛ سال بسته فقط با بازگشایی دوباره باز می‌شود */}
      {yearsInfo && yearRows.length === 0 && (
        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/60 rounded-2xl p-5 text-sm text-sky-800 dark:text-sky-300" role="status">
          هیچ سال مالی تمام‌شده‌ای برای بستن نیست؛ سال مالی {toPersianDigits(yearsInfo.currentYear)} پس از آخرین روزش بسته می‌شود.
        </div>
      )}
      {(yearNotEnded || isSelectedClosed) && !executionResult && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-5 text-sm font-bold text-amber-800 dark:text-amber-300" role="alert">
          {isSelectedClosed
            ? `سال مالی ${toPersianDigits(selectedYear)} بسته است؛ برای تغییر آن، اگر آخرین سال بسته است، از «بازگشایی سال مالی» استفاده کنید.`
            : `سال مالی ${toPersianDigits(selectedYear)} هنوز تمام نشده است و پس از آخرین روزش (${toPersianDigits(closingDate)}) بسته می‌شود.`}
        </div>
      )}

      {earlierOpenYears.length > 0 && !isSelectedClosed && !executionResult && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-5 text-sm font-bold text-rose-700 dark:text-rose-300" role="alert">
          پیش از سال مالی {toPersianDigits(selectedYear)}، سال {earlierOpenText} سند دارد و هنوز بسته نشده است؛ سال‌ها به ترتیب بسته می‌شوند.
        </div>
      )}

      {/* v8.0.2 (TD-252): سال با سند حسابداری پیش‌نویس بسته نمی‌شود */}
      {draftVoucherCount > 0 && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-5 space-y-2" role="alert">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-sm">
            <AlertTriangle className="w-5 h-5" />
            سال مالی {toPersianDigits(selectedYear)} {toPersianDigits(draftVoucherCount)} سند حسابداری پیش‌نویس دارد و تا تأیید یا حذف آن‌ها بسته نمی‌شود.
          </div>
          <p className="text-xs text-rose-700/80 dark:text-rose-300/80">
            سند پیش‌نویس در بستن حساب‌ها شمرده نمی‌شود و پس از بستن سال دیگر تأییدشدنی نیست. شماره اسناد:{' '}
            {(previewData?.draftVouchers ?? []).map(v => toPersianDigits(v.voucherNumber)).join('، ')}
            {draftVoucherCount > (previewData?.draftVouchers?.length ?? 0) ? ' و …' : ''}
          </p>
        </div>
      )}

      {/* Main Closing Steps Detailed Breakdown */}
      {previewData && (
        <div className="space-y-4">
          {/* Step 1: Closing Temporary Accounts */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-sm">
            <button
              onClick={() => toggleSection('step1')}
              className="w-full flex items-center justify-between p-5 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-900/80 transition-colors text-right"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-blue-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  ۱
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    گام اول: بستن حساب‌های موقت درآمد و هزینه
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    بدهکار کردن حساب‌های درآمد و بستانکار کردن حساب‌های هزینه به طرفیت حساب «خلاصه سود و زیان (کد ۴۳۰۱)»
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {toPersianDigits(revenuesList.length + expensesList.length)} ردیف سند
                </span>
                {expandedSections.step1 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </div>
            </button>

            {expandedSections.step1 && (
              <div className="p-5 space-y-4">
                <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="p-3 w-28">کد حساب</th>
                        <th className="p-3">عنوان حساب</th>
                        <th className="p-3 text-center">نوع</th>
                        <th className="p-3 text-center">مانده دفتر کل</th>
                        <th className="p-3 text-center">عملیات بستن</th>
                        <th className="p-3 text-left">{`مبلغ (${curLbl})`}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {/* Revenues */}
                      {revenuesList.map((rev, idx) => (
                        <tr key={rev.accountId || `rev-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">{rev.accountCode}</td>
                          <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{rev.accountTitle || rev.accountName}</td>
                          <td className="p-3 text-center">
                            <span className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              درآمد
                            </span>
                          </td>
                          <td className="p-3 text-center text-slate-500">بستانکار</td>
                          <td className="p-3 text-center font-bold text-indigo-600 dark:text-indigo-400">بدهکار در سند</td>
                          <td className="p-3 text-left font-bold text-slate-800 dark:text-slate-200">
                            {formatPersianPrice(rev.balance || rev.amount || 0)}
                          </td>
                        </tr>
                      ))}

                      {/* Expenses */}
                      {expensesList.map((exp, idx) => (
                        <tr key={exp.accountId || `exp-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">{exp.accountCode}</td>
                          <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{exp.accountTitle || exp.accountName}</td>
                          <td className="p-3 text-center">
                            <span className="bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              هزینه
                            </span>
                          </td>
                          <td className="p-3 text-center text-slate-500">بدهکار</td>
                          <td className="p-3 text-center font-bold text-amber-600 dark:text-amber-400">بستانکار در سند</td>
                          <td className="p-3 text-left font-bold text-slate-800 dark:text-slate-200">
                            {formatPersianPrice(exp.balance || exp.amount || 0)}
                          </td>
                        </tr>
                      ))}

                      {revenuesList.length === 0 && expensesList.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">
                            حساب موقت با مانده باز در این سال مالی یافت نشد (احتمالاً قبلاً بسته شده است).
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Transfer Net Profit to Retained Earnings */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-sm">
            <button
              onClick={() => toggleSection('step2')}
              className="w-full flex items-center justify-between p-5 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-900/80 transition-colors text-right"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  ۲
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    گام دوم: انتقال سود/زیان خالص به حساب سود (زیان) انباشته
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    بستن حساب خلاصه سود و زیان (۴۳۰۱) و انتقال مانده آن به حساب «سود (زیان) انباشته (کد ۴۲۰۱)»
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs font-black ${isNetProfitPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {formatPersianPrice(Math.abs(safeNetProfit), appCurrency)}
                </span>
                {expandedSections.step2 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </div>
            </button>

            {expandedSections.step2 && (
              <div className="p-5">
                <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400">شرح سند دوبل:</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      بستن حساب خلاصه سود و زیان سال مالی {toPersianDigits(selectedYear)} به سود (زیان) انباشته
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-400 block mb-1">حساب بدهکار:</span>
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {isNetProfitPositive ? '۴۳۰۱ - خلاصه سود و زیان' : '۴۲۰۱ - سود (زیان) انباشته'}
                      </span>
                    </div>
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-400 block mb-1">حساب بستانکار:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {isNetProfitPositive ? '۴۲۰۱ - سود (زیان) انباشته' : '۴۳۰۱ - خلاصه سود و زیان'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Closing Permanent Accounts (Closing Voucher) */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-sm">
            <button
              onClick={() => toggleSection('step3')}
              className="w-full flex items-center justify-between p-5 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-900/80 transition-colors text-right"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-amber-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  ۳
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    گام سوم: صدور سند اختتامیه (بستن حساب‌های دائمی)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    صفر کردن مانده تمام حساب‌های دارایی، بدهی و حقوق صاحبان سهام به طرفیت حساب تراز اختتامیه (کد ۴۴۰۱)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {toPersianDigits(assetsList.length + liabilitiesAndEquityList.length)} ردیف حساب
                </span>
                {expandedSections.step3 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </div>
            </button>

            {expandedSections.step3 && (
              <div className="p-5 space-y-4">
                <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-700/80">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="p-3 w-28">کد حساب</th>
                        <th className="p-3">عنوان حساب</th>
                        <th className="p-3 text-center">ماهیت دفتر</th>
                        <th className="p-3 text-center">ثبت در سند اختتامیه</th>
                        <th className="p-3 text-left">{`مبلغ مانده (${curLbl})`}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {/* Assets */}
                      {assetsList.map((asset, idx) => (
                        <tr key={asset.accountId || `asset-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">{asset.accountCode}</td>
                          <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{asset.accountTitle || asset.accountName}</td>
                          <td className="p-3 text-center">
                            <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              دارایی (بدهکار)
                            </span>
                          </td>
                          <td className="p-3 text-center font-bold text-amber-600 dark:text-amber-400">بستانکار در اختتامیه</td>
                          <td className="p-3 text-left font-bold text-slate-800 dark:text-slate-200">
                            {formatPersianPrice(asset.balance || asset.amount || 0)}
                          </td>
                        </tr>
                      ))}

                      {/* Liabilities & Equity */}
                      {liabilitiesAndEquityList.map((item, idx) => (
                        <tr key={item.accountId || `liab-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                          <td className="p-3 font-mono font-bold text-slate-700 dark:text-slate-300">{item.accountCode}</td>
                          <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{item.accountTitle || item.accountName}</td>
                          <td className="p-3 text-center">
                            <span className="bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              بدهی / سرمایه (بستانکار)
                            </span>
                          </td>
                          <td className="p-3 text-center font-bold text-indigo-600 dark:text-indigo-400">بدهکار در اختتامیه</td>
                          <td className="p-3 text-left font-bold text-slate-800 dark:text-slate-200">
                            {formatPersianPrice(item.balance || item.amount || 0)}
                          </td>
                        </tr>
                      ))}

                      {assetsList.length === 0 && liabilitiesAndEquityList.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-400">
                            حساب دائمی با مانده در این سال مالی ثبت نشده است.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Step 4: Opening Voucher for Next Fiscal Year */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden shadow-sm">
            <button
              onClick={() => toggleSection('step4')}
              className="w-full flex items-center justify-between p-5 bg-slate-50/70 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-900/80 transition-colors text-right"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  ۴
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    گام چهارم: صدور سند افتتاحیه سال مالی جدید ({toPersianDigits(Number(selectedYear) + 1)})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    انتقال مانده‌های دائمی سال جاری به عنوان مانده ابتدای دوره سال مالی جدید
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={createOpeningVoucher}
                    onChange={e => setCreateOpeningVoucher(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    صدور خودکار سند افتتاحیه
                  </span>
                </label>
                {expandedSections.step4 ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </div>
            </button>

            {expandedSections.step4 && (
              <div className="p-5">
                {createOpeningVoucher ? (
                  <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 rounded-xl flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <Check className="w-5 h-5 shrink-0 text-emerald-600" />
                    <span>
                      سند افتتاحیه با تاریخ {toPersianDigits(openingDateNewYear)} و با شرح «سند افتتاحیه سال مالی {toPersianDigits(Number(selectedYear) + 1)}» به عنوان سند شماره ۱ سال جدید ثبت خواهد شد.
                    </span>
                  </div>
                ) : (
                  // v9.0.163 (TD-577): بی تیک، سند اختتامیه مانده‌های دائمی را صفر می‌کند و سند افتتاحیه‌ای صادر نمی‌شود
                  <div role="alert" className="p-4 bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 rounded-xl flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                    <span>
                      {noOpeningVoucherText}. سند اختتامیه مانده حساب‌های ترازنامه‌ای را صفر می‌کند؛ مانده‌های ابتدای دوره را باید جداگانه با سند افتتاحیه ثبت کنید.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Execution Section */}
      {previewData && !executionResult && (
        <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-md">
          <div className="space-y-1">
            <h3 className="text-base font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
              آماده اجرای نهایی بستن سال مالی {toPersianDigits(selectedYear)}
            </h3>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              {createOpeningVoucher
                ? 'با تایید این مرحله، کلیه اسناد اختتامیه و افتتاحیه صادر شده و حساب‌های موقت بسته خواهند شد.'
                : 'با تایید این مرحله، اسناد اختتامیه صادر شده و حساب‌های موقت بسته خواهند شد؛ سند افتتاحیه صادر نمی‌شود.'}
              {' '}پس از بستن، هیچ سندی در این سال ثبت نمی‌شود و فقط آخرین سال بسته با «بازگشایی سال مالی» دوباره باز می‌شود؛ پیش از اجرا اسناد نهایی را بازبینی کنید.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsConfirmModalOpen(true)}
            disabled={isExecuting || closingBlocked}
            title={closingBlockedReason}
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:scale-98 text-slate-950 font-black px-6 py-3 rounded-xl text-sm transition-all shadow-lg hover:shadow-amber-500/20 shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            اجرای قطعی بستن سال مالی {toPersianDigits(selectedYear)}
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  تایید اجرای عملیات بستن سال مالی {toPersianDigits(selectedYear)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  اقدامات زیر به صورت خودکار در سیستم ثبت خواهند شد:
                </p>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 space-y-2.5 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>صدور سند بستن حساب‌های درآمد و هزینه (خلاصه سود و زیان)</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>صدور سند انتقال سود/زیان سال ({formatPersianPrice(Math.abs(safeNetProfit), appCurrency)}) به سود انباشته</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>صدور سند اختتامیه حساب‌های دائمی ترازنامه به تاریخ {toPersianDigits(closingDate)}</span>
              </div>
              {createOpeningVoucher ? (
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>صدور سند افتتاحیه سال {toPersianDigits(Number(selectedYear) + 1)} به تاریخ {toPersianDigits(openingDateNewYear)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{noOpeningVoucherText}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isExecuting}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              >
                انصراف و بازگشت
              </button>
              <button
                type="button"
                onClick={handleExecuteClosing}
                disabled={isExecuting}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-all shadow-md disabled:opacity-50 cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    در حال صدور اسناد...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    تایید و بستن قطعی سال مالی
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <FiscalYearReopenPanel
        reopenableYear={yearsInfo?.reopenableYear ?? null}
        onReopened={year => {
          setExecutionResult(null);
          if (String(year) === selectedYear) void loadPreview();
        }}
      />
    </div>
  );
}
