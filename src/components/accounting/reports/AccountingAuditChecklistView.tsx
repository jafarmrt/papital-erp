import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
  Zap,
  BookOpen,
  FileText,
  Package,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import { fetchJson } from '../../../api.js';
import type { FinancialHealthReport, HealthCheckTestResult } from '../../../types.js';
import { formatPersianPrice, toPersianDigits } from '../../../utils.js';

export function AccountingAuditChecklistView() {
  const [report, setReport] = useState<FinancialHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTestIds, setExpandedTestIds] = useState<Record<string, boolean>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isSyncingVouchers, setIsSyncingVouchers] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showStandards, setShowStandards] = useState(false);

  const loadHealthReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJson<FinancialHealthReport>('/api/accounting/reports/health-check');
      setReport(data);

      // به‌طور پیش‌فرض آزمون‌های دارای خطا یا هشدار را باز نگه می‌داریم
      const initialExpanded: Record<string, boolean> = {};
      data?.tests?.forEach((t) => {
        if (t.status !== 'healthy') {
          initialExpanded[t.id] = true;
        }
      });
      setExpandedTestIds(initialExpanded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'خطا در اسکن سلامت دفاتر حسابداری');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealthReport();
  }, [loadHealthReport]);

  const toggleExpand = (id: string) => {
    setExpandedTestIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleQuickSyncVouchers = async () => {
    try {
      setIsSyncingVouchers(true);
      setSyncMessage(null);
      const res = await fetchJson<{ success: boolean; message: string; syncedCount: number }>(
        '/api/accounting/quick-fix/sync-all-vouchers',
        { method: 'POST' }
      );
      setSyncMessage(res.message || 'اسناد دوبل فاکتورها با موفقیت صادر شدند.');
      await loadHealthReport();
    } catch (err: unknown) {
      setSyncMessage(err instanceof Error ? err.message : 'خطا در صدور خودکار اسناد');
    } finally {
      setIsSyncingVouchers(false);
    }
  };

  const filteredTests = (report?.tests || []).filter((test) => {
    if (selectedCategory === 'all') return true;
    return test.category === selectedCategory;
  });

  const getScoreColorClass = (score: number) => {
    if (score >= 90) return 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 75) return 'text-sky-600 dark:text-sky-400 border-sky-500/40 bg-sky-500/10';
    if (score >= 50) return 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10';
    return 'text-rose-600 dark:text-rose-400 border-rose-500/40 bg-rose-500/10';
  };

  const getStatusBadge = (status: HealthCheckTestResult['status']) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            منطبق و تراز
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            نیازمند بازبینی
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            مغایرت بحرانی
          </span>
        );
    }
  };

  const getCategoryIcon = (cat: HealthCheckTestResult['category']) => {
    switch (cat) {
      case 'vouchers':
        return <BookOpen className="w-4 h-4 text-indigo-500" />;
      case 'accounts':
        return <Layers className="w-4 h-4 text-sky-500" />;
      case 'inventory':
        return <Package className="w-4 h-4 text-amber-500" />;
      case 'documents':
        return <FileText className="w-4 h-4 text-emerald-500" />;
      case 'treasury':
        return <CreditCard className="w-4 h-4 text-purple-500" />;
      default:
        return <ShieldCheck className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card: Health Score & Execution Metadata */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600 dark:text-indigo-400">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-slate-900 dark:text-white text-lg">
                  بازرس هوشمند سلامت مالی و ممیزی دفاتر
                </h3>
                <span className="text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-md">
                  پایش خودکار
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                پایش زنده و لحظه‌ای تراز اسناد دوبل، مانده خلاف ماهیت، انطباق ارزش کاردکس انبار و وضعیت چک‌ها
              </p>
            </div>
          </div>

          <button
            onClick={loadHealthReport}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-all shadow-sm shadow-indigo-500/20 active:scale-98"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>اسکن مجدد زنده دفاتر</span>
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Health Score and Metrics Grid */}
        {report && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
            {/* Health Score Widget */}
            <div className={`p-4 rounded-xl border flex items-center gap-4 ${getScoreColorClass(report.overallScore)}`}>
              <div className="w-16 h-16 rounded-full border-4 border-current flex items-center justify-center shrink-0">
                <span className="text-xl font-black">{toPersianDigits(report.overallScore)}٪</span>
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                  امتیاز جامع سلامت دفاتر
                </span>
                <span className="text-sm font-bold truncate block mt-0.5 text-slate-900 dark:text-white">
                  {report.healthGrade}
                </span>
              </div>
            </div>

            {/* Test Stats Widget */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-750/70 flex flex-col justify-center">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">وضعیت آزمون‌های ممیزی</span>
              <div className="flex items-center gap-3 mt-1.5 text-xs font-bold">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {toPersianDigits(report.summary.healthyTestsCount)} سالم
                </span>
                {report.summary.warningTestsCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {toPersianDigits(report.summary.warningTestsCount)} هشدار
                  </span>
                )}
                {report.summary.errorTestsCount > 0 && (
                  <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertOctagon className="w-3.5 h-3.5" />
                    {toPersianDigits(report.summary.errorTestsCount)} خطا
                  </span>
                )}
              </div>
            </div>

            {/* Scanned Database Records Widget */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-750/70 flex flex-col justify-center">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">حجم رکوردهای پایش‌شده</span>
              <div className="text-xs text-slate-800 dark:text-slate-200 font-semibold mt-1 space-y-0.5">
                <div>
                  {toPersianDigits(report.scannedStats.totalVouchers)} سند ({toPersianDigits(report.scannedStats.totalVoucherItems)} ردیف)
                </div>
                <div className="text-[10px] text-slate-500">
                  {toPersianDigits(report.scannedStats.totalDocuments)} فاکتور | {toPersianDigits(report.scannedStats.totalCheques)} چک | {toPersianDigits(report.scannedStats.totalItems)} کالا
                </div>
              </div>
            </div>

            {/* Timing & Performance Widget */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-750/70 flex flex-col justify-center">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                زمان‌سنجی اسکن
              </span>
              <div className="text-xs text-slate-800 dark:text-slate-200 font-semibold mt-1">
                تاریخ: {toPersianDigits(report.scannedAtJalali)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                سرعت اسکن: {toPersianDigits(report.scanDurationMs)} میلی‌ثانیه
              </div>
            </div>
          </div>
        )}

        {/* Quick-Fix Notification if Invoices need Voucher Auto-Sync */}
        {report && (
          (() => {
            const docTest = report.tests.find((t) => t.id === 'commercial_docs_unlinked');
            const unlinkedCount = Number(docTest?.metrics?.unlinkedFinalDocs || 0);
            if (unlinkedCount > 0) {
              return (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white block">
                        اقدام سریع پیشنهادی: {toPersianDigits(unlinkedCount)} فاکتور نهایی فاقد سند دوبل
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400 block mt-0.5">
                        می‌توانید با یک کلیک تمام اسناد حسابداری معوق را به‌صورت خودکار صادر نمایید.
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleQuickSyncVouchers}
                    disabled={isSyncingVouchers}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-all shadow-sm shrink-0"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isSyncingVouchers ? 'animate-spin' : ''}`} />
                    <span>{isSyncingVouchers ? 'در حال صدور اسناد...' : 'صدور خودکار اسناد فاکتورها'}</span>
                  </button>
                </div>
              );
            }
            return null;
          })()
        )}

        {syncMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        )}
      </div>

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-700 pb-2 overflow-x-auto text-xs font-medium">
        {[
          { key: 'all', label: 'همه آزمون‌ها' },
          { key: 'vouchers', label: 'تراز اسناد دوبل' },
          { key: 'accounts', label: 'ماهیت حساب‌ها' },
          { key: 'inventory', label: 'انبار و کاردکس' },
          { key: 'documents', label: 'فاکتورها و اسناد تجاری' },
          { key: 'treasury', label: 'خزانه‌داری و چک‌ها' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSelectedCategory(tab.key)}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              selectedCategory === tab.key
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Test Results List */}
      <div className="space-y-3">
        {loading && !report && (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            <span>در حال اسکن جامع جداول مالی، اسناد دوبل و کاردکس انبار...</span>
          </div>
        )}

        {filteredTests.map((test) => {
          const isExpanded = !!expandedTestIds[test.id];
          const hasItems = test.items && test.items.length > 0;

          return (
            <div
              key={test.id}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/90 dark:border-slate-700/90 shadow-sm overflow-hidden transition-all"
            >
              <div
                onClick={() => hasItems && toggleExpand(test.id)}
                className={`p-4 flex items-start justify-between gap-3 ${
                  hasItems ? 'cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-750/70' : ''
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700/80 mt-0.5 shrink-0">
                    {getCategoryIcon(test.category)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                        {test.title}
                      </h4>
                      {getStatusBadge(test.status)}
                      {test.scoreImpact < 0 && (
                        <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950 px-1.5 py-0.5 rounded">
                          {toPersianDigits(test.scoreImpact)} امتیاز
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {test.description}
                    </p>
                    <div className="text-xs font-semibold mt-1.5 text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{test.message}</span>
                    </div>

                    {test.quickFixHint && (
                      <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 font-medium flex items-center gap-1">
                        <Zap className="w-3 h-3 shrink-0" />
                        <span>راهکار اصلاحی: {test.quickFixHint}</span>
                      </div>
                    )}
                  </div>
                </div>

                {hasItems && (
                  <button
                    type="button"
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                    aria-label="نمایش جزئیات"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Collapsible Issue Details Table */}
              {isExpanded && hasItems && (
                <div className="border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-750/30 p-4 space-y-2">
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 pb-1 flex items-center justify-between">
                    <span>موارد شناسایی‌شده جهت اصلاح ({toPersianDigits(test.items?.length || 0)} مورد)</span>
                  </div>

                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {test.items?.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/70 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {item.code && (
                              <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 font-semibold">
                                {item.code}
                              </span>
                            )}
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {item.title}
                            </span>
                          </div>
                          {item.subtitle && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {item.subtitle}
                            </p>
                          )}
                          {item.details && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {item.details}
                            </p>
                          )}
                        </div>

                        {item.amount !== undefined && item.amount > 0 && (
                          <div className="text-left shrink-0">
                            <span className="text-[10px] text-slate-400 block">مبلغ / اختلاف</span>
                            <span className="font-bold text-xs text-slate-900 dark:text-white font-mono">
                              {formatPersianPrice(item.amount)} ریال
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Accepted Accounting Standards & Institutional Reference Section */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
        <button
          onClick={() => setShowStandards(!showStandards)}
          className="w-full flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 hover:text-indigo-600 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>چک‌لیست استانداردهای پذیرفته‌شده حسابداری و امکانات قانونی سامانه</span>
          </div>
          {showStandards ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showStandards && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
            <div className="border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-750/50 space-y-2">
              <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                <span>۱. کدینگ و اسناد دوبل حسابداری</span>
                <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-[10px]">۱۰۰٪ استاندارد</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  کدینگ استاندارد ۴ سطحی (گروه، کل، معین، تفصیلی)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  اسناد دوبل با اعتبارسنجی تراز بودن بدهکار و بستانکار
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  صدور خودکار سند برای فاکتور فروش، خرید، انبار، تولید و حقوق
                </li>
              </ul>
            </div>

            <div className="border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-750/50 space-y-2">
              <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                <span>۲. صورت‌های مالی و گزارشات ممیزی</span>
                <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-[10px]">۱۰۰٪ استاندارد</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  تراز آزمایشی ۲، ۴، ۶ و ۸ ستونی در هر ۴ سطح کدینگ
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  دفتر روزنامه قانونی، دفتر کل و دفاتر معین با گردش متوالی
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  صورت سود و زیان دوره‌ای، ترازنامه اساسی و نسبت‌های مالی
                </li>
              </ul>
            </div>

            <div className="border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-750/50 space-y-2">
              <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                <span>۳. خزانه‌داری و مغایرت‌گیری بانکی</span>
                <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-[10px]">۱۰۰٪ استاندارد</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  مدیریت چرخه صیادی (وصول، خرج، برگشت، واخواست)
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  موتور مغایرت‌گیری هوشمند ۳ سطحی صورتحساب بانکی (Bank Reconciliation)
                </li>
              </ul>
            </div>

            <div className="border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3.5 bg-slate-50/50 dark:bg-slate-750/50 space-y-2">
              <div className="flex items-center justify-between font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                <span>۴. بستن سال مالی و انتقال دوره‌ها</span>
                <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-[10px]">۱۰۰٪ استاندارد</span>
              </div>
              <ul className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  بستن خودکار حساب‌های موقت به سود و زیان انباشته
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  صدور سند اختتامیه و افتتاحیه سال مالی جدید
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
