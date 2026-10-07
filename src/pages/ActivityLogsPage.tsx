import React, { useState } from 'react';
import { 
  ShieldAlert, History, Search, Filter, RefreshCw, Calendar, Eye, X, 
  ChevronLeft, ChevronRight, PlusCircle, Edit3, Trash2, KeyRound, Settings as SettingsIcon,
  Download, UserCheck, CheckCircle2, Clock, ArrowRightLeft, FileCode, AlertCircle, LogOut,
  Printer, FileSpreadsheet, Layers, ShieldCheck, DollarSign, Package, Laptop
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { ActivityLog } from '../types';
import { formatPersianNumber, formatPersianDateTime, extractDateString, errorMessageOf } from '../utils';
import { useSearch } from '../SearchContext';
import toast from 'react-hot-toast';
import {
  useActivityLogsQuery,
  useActivityLogFilterOptionsQuery,
  fetchAuditReportRows,
  type AuditReportRows
} from '../hooks/queries';
import { DeviceBadge } from '../components/audit/DeviceBadge';
import { AuditDiffViewer } from '../components/audit/AuditDiffViewer';
import { AuditPrintModal } from '../components/audit/AuditPrintModal';
import { exportAuditLogsToExcel } from '../components/audit/auditExportUtils';
import { parseUserAgent } from '../utils/userAgentParser';
import { permissionDefinition } from '../lib/permissions/permissionCatalog';
import { auditActionLabel, auditActionOptions } from '../lib/audit/auditActionLabels';

/** v9.0.156 (TD-537): خطای خواندن سجل، با پیام فارسی ۴۰۳ به‌جای «هیچ رکوردی یافت نشد» */
function logsLoadErrorMessage(error: unknown): string {
  if ((error as { status?: unknown } | null)?.status === 403) {
    return `برای دیدن سجل رویدادها مجوز «${permissionDefinition('audit_logs.view')?.title ?? 'مشاهده سجل رویدادها'}» لازم است.`;
  }
  return `سجل رویدادها بارگذاری نشد: ${errorMessageOf(error)}`;
}

type LogCategory = 'all' | 'auth_security' | 'financial_docs' | 'inventory_items' | 'settings_system';

const DEFAULT_ACTION_BADGE = { className: 'bg-slate-100 text-slate-700 border-slate-200', icon: History };
const ACTION_BADGE_STYLES: Record<string, { className: string; icon: typeof History }> = {
  CREATE: { className: 'bg-blue-50 text-blue-700 border-blue-200', icon: PlusCircle },
  UPDATE: { className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Edit3 },
  DELETE: { className: 'bg-rose-50 text-rose-700 border-rose-200', icon: Trash2 },
  LOGIN: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: KeyRound },
  LOGIN_FAILED: { className: 'bg-rose-50 text-rose-700 border-rose-300', icon: AlertCircle },
  LOGOUT: { className: 'bg-slate-100 text-slate-700 border-slate-300', icon: LogOut },
  SETTING_CHANGE: { className: 'bg-purple-50 text-purple-700 border-purple-200', icon: SettingsIcon },
  PURGE: { className: 'bg-orange-50 text-orange-700 border-orange-300', icon: Trash2 },
  AUDIT_APPLY: { className: 'bg-teal-50 text-teal-700 border-teal-200', icon: ShieldCheck },
  RECONCILIATION_EXECUTE: { className: 'bg-teal-50 text-teal-700 border-teal-200', icon: ShieldCheck },
  SEED: { className: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: Layers },
  IMPORT: { className: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: Layers },
  EXPORT: { className: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Download },
  RESTORE: { className: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Download },
};

export default function ActivityLogsPage() {
  const limit = 25;

  // Filters
  // v9.0.156 (TD-537): درخواست با جست‌وجوی تأخیری فرستاده می‌شود و صفحه هر بار که جست‌وجو عوض شود از ۱ شروع می‌شود
  const { searchQuery: search, debouncedSearchQuery, setSearchQuery: setSearch } = useSearch();
  const [pageOfSearch, setPageOfSearch] = useState<{ page: number; search: string }>({ page: 1, search: '' });
  const page = pageOfSearch.search === debouncedSearchQuery ? pageOfSearch.page : 1;
  const setPage = (next: number | ((current: number) => number)) =>
    setPageOfSearch({ page: typeof next === 'function' ? next(page) : next, search: debouncedSearchQuery });
  const [categoryFilter, setCategoryFilter] = useState<LogCategory>('all');
  const [userFilter, setUserFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<any>('');
  const [endDate, setEndDate] = useState<any>('');

  // Modals
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [modalTab, setModalTab] = useState<'visual' | 'json'>('visual');
  const [printReport, setPrintReport] = useState<AuditReportRows | null>(null);
  const [preparingReport, setPreparingReport] = useState<'print' | 'excel' | null>(null);

  const formatToGregorian = (d: any): string => {
    return extractDateString(d);
  };

  const filterOptionsQuery = useActivityLogFilterOptionsQuery();
  const filterOptions = filterOptionsQuery.data ?? { users: [], actions: [], entities: [] };

  const reportFilters = {
    search: debouncedSearchQuery,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    user: userFilter || undefined,
    action: actionFilter || undefined,
    entity: entityFilter || undefined,
    startDate: formatToGregorian(startDate) || undefined,
    endDate: formatToGregorian(endDate) || undefined,
  };
  const logsQuery = useActivityLogsQuery({ page, limit, ...reportFilters });

  const loadError = logsQuery.isError ? logsLoadErrorMessage(logsQuery.error) : null;
  const logs = loadError ? [] : (logsQuery.data?.logs ?? []);
  const totalCount = loadError ? 0 : (logsQuery.data?.total ?? 0);
  const totalPages = loadError ? 1 : (logsQuery.data?.totalPages ?? 1);
  const loading = logsQuery.isLoading;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setUserFilter('');
    setActionFilter('');
    setEntityFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  // v9.0.157 (TD-527): چاپ و Excel همه ردیف‌های پالایه را از یک درخواست سروری می‌گیرند، نه ۲۵ ردیف صفحه جاری
  const prepareReport = async (kind: 'print' | 'excel'): Promise<AuditReportRows | null> => {
    try {
      setPreparingReport(kind);
      return await fetchAuditReportRows(reportFilters);
    } catch (error) {
      toast.error(logsLoadErrorMessage(error));
      return null;
    } finally {
      setPreparingReport(null);
    }
  };

  const handlePrintPreview = async () => {
    const report = await prepareReport('print');
    if (report) setPrintReport(report);
  };

  const handleExportExcel = async () => {
    const report = await prepareReport('excel');
    if (report) await exportAuditLogsToExcel(report.rows, report.total);
  };

  // v9.0.158 (TD-538): متن نشان از جدول مشترک برچسب اقدام؛ رنگ و نماد به ازای اقدام
  const getActionBadge = (action: string) => {
    const style = ACTION_BADGE_STYLES[action] ?? DEFAULT_ACTION_BADGE;
    const Icon = style.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${style.className}`}>
        <Icon className="w-3.5 h-3.5" />
        {auditActionLabel(action)}
      </span>
    );
  };

  const categories: { id: LogCategory; label: string; icon: any; countNote?: string }[] = [
    { id: 'all', label: 'همه رویدادها', icon: Layers },
    { id: 'auth_security', label: 'امنیت و دسترسی', icon: ShieldCheck },
    { id: 'financial_docs', label: 'مالی و اسناد', icon: DollarSign },
    { id: 'inventory_items', label: 'انبارداری و کالا', icon: Package },
    { id: 'settings_system', label: 'تنظیمات و سیستم', icon: SettingsIcon },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center shadow-md">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">سجل تغییرات و رویدادهای کاربران</h1>
            <p className="text-xs text-slate-500 mt-1">
              ثبت جامع و ممیزی امنیتی از تمامی ورود و خروج‌ها، تغییرات اسناد مالی، انبار و تنظیمات مالکیتی
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { void filterOptionsQuery.refetch(); void logsQuery.refetch(); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="بروزرسانی داده‌ها"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            بروزرسانی
          </button>
          <button
            onClick={() => { void handleExportExcel(); }}
            disabled={preparingReport !== null || logs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
            title="دریافت فایل اکسل"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            {preparingReport === 'excel' ? 'در حال آماده‌سازی…' : 'خروجی اکسل'}
          </button>
          <button
            onClick={() => { void handlePrintPreview(); }}
            disabled={preparingReport !== null || logs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors shadow-xs disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            {preparingReport === 'print' ? 'در حال آماده‌سازی…' : 'پیش‌نمایش چاپ امنیتی'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">کل رویدادهای ثبت‌شده</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{formatPersianNumber(totalCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <History className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">تعداد کاربران ثبت‌شده</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{formatPersianNumber(filterOptions.users.length)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">بخش‌های تحت پوشش ممیزی</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{formatPersianNumber(filterOptions.entities.length)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">پایش بلادرنگ و فعال</p>
            <p className="text-sm font-bold text-emerald-600 mt-2 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
              سامانه در حال ثبت فعال
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Quick Category Filter Chips */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-700">
          <Layers className="w-4 h-4 text-blue-600" />
          <span>دسته‌بندی موضوعی رویدادها (فیلتر سریع):</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => { setCategoryFilter(cat.id); setPage(1); }}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900 ring-offset-1'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-slate-500'}`} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced Filters Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <input
              type="text"
              placeholder="جستجو در شرح لاگ، نام کاربر یا نام بخش..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">همه کاربران</option>
              {filterOptions.users.map((u: any, idx: number) => (
                <option key={`${u.username}-${idx}`} value={u.username}>
                  {u.fullName ? `${u.fullName} (${u.username})` : u.username}
                </option>
              ))}
            </select>

            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">همه اقدامات</option>
              {auditActionOptions(filterOptions.actions).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">همه بخش‌ها / موجودیت‌ها</option>
              {filterOptions.entities.map((e: any) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>

            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 text-white font-semibold text-xs rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
            >
              <Filter className="w-3.5 h-3.5" />
              اعمال فیلتر
            </button>
          </div>
        </form>

        {/* Date Filter & Active Badges */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500 font-medium">بازه زمانی:</span>
            <DatePicker 
              value={startDate} 
              onChange={(val: any) => { setStartDate(extractDateString(val)); setPage(1); }} 
              calendar={persian} 
              locale={persian_fa} 
              calendarPosition="bottom-right"
              inputClass="px-2 py-1 border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-blue-500 w-28" 
              containerClassName="inline-block"
            />
            <span className="text-slate-400">تا</span>
            <DatePicker 
              value={endDate} 
              onChange={(val: any) => { setEndDate(extractDateString(val)); setPage(1); }} 
              calendar={persian} 
              locale={persian_fa} 
              calendarPosition="bottom-right"
              inputClass="px-2 py-1 border border-slate-200 rounded text-xs outline-none focus:ring-1 focus:ring-blue-500 w-28" 
              containerClassName="inline-block"
            />
          </div>

          {(search || categoryFilter !== 'all' || userFilter || actionFilter || entityFilter || startDate || endDate) && (
            <button
              onClick={handleResetFilters}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              پاکسازی همه فیلترها
            </button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3 px-4">شناسه</th>
                <th className="py-3 px-4">تاریخ و زمان</th>
                <th className="py-3 px-4">کاربر مجری</th>
                <th className="py-3 px-4">نوع اقدام</th>
                <th className="py-3 px-4">بخش / موجودیت</th>
                <th className="py-3 px-4">شرح کامل فعالیت</th>
                <th className="py-3 px-4 text-center">دستگاه و نشانی IP</th>
                <th className="py-3 px-4 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                    در حال بارگذاری رویدادهای سجل…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={8} role="alert" className="py-12 text-center text-rose-700 font-medium">
                    {loadError}
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    هیچ رکوردی مطابق با فیلترهای انتخابی یافت نشد.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400 text-2xs">
                      #{log.id}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                      {formatPersianDateTime(log.timestamp)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-2xs">
                          {(log.userFullName || log.username || '?').charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{log.userFullName || log.username}</p>
                          <p className="text-2xs text-slate-400 font-mono">@{log.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-2xs">
                        {log.entity}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-800 leading-relaxed max-w-md">
                      {log.description}
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <DeviceBadge userAgent={log.details?.userAgent} ipAddress={log.ipAddress} />
                        <span className="font-mono text-3xs text-slate-400">
                          {log.ipAddress || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <button
                        onClick={() => setSelectedLog(log as any)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        مشاهده جزئیات
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-slate-50/50">
          <span className="text-slate-500">
            نمایش صفحه {formatPersianNumber(page)} از {formatPersianNumber(totalPages)} (مجموع {formatPersianNumber(totalCount)} رکورد ثبت‌شده)
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 border border-slate-300 rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="px-3 font-bold text-slate-700">
              {formatPersianNumber(page)} / {formatPersianNumber(totalPages)}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 border border-slate-300 rounded hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Details Modal with Diff Viewer & Device Analysis */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden relative">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-2xs">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">جزئیات و ممیزی لاگ امنیتی #{selectedLog.id}</h3>
                  <p className="text-xs text-slate-500">{formatPersianDateTime(selectedLog.timestamp)}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block mb-0.5">کاربر مجری:</span>
                  <span className="font-bold text-slate-900">{selectedLog.userFullName || selectedLog.username}</span>
                  <span className="text-slate-500 block text-2xs font-mono">@{selectedLog.username}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">نوع اقدام:</span>
                  <div>{getActionBadge(selectedLog.action)}</div>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">بخش / موجودیت:</span>
                  <span className="font-bold text-slate-800">{selectedLog.entity} {selectedLog.entityId ? `(#${selectedLog.entityId})` : ''}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">نشانی IP:</span>
                  <span className="font-mono font-bold text-slate-700 bg-slate-200/60 px-2 py-0.5 rounded text-2xs inline-block">
                    {selectedLog.ipAddress || '127.0.0.1 (محلی)'}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-slate-500 font-bold block mb-1">شرح کامل رویداد:</span>
                <p className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl text-slate-800 leading-relaxed font-medium">
                  {selectedLog.description}
                </p>
              </div>

              {/* Device and Client Environment Card */}
              {selectedLog.details?.userAgent && (() => {
                const ua = parseUserAgent(selectedLog.details.userAgent);
                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
                      <Laptop className="w-4 h-4 text-indigo-600" />
                      <span>مشخصات دستگاه کاربر، سیستم‌عامل و مرورگر:</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-2xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block mb-0.5">نوع دستگاه:</span>
                        <span className="font-bold text-slate-800">{ua.deviceLabel}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block mb-0.5">سیستم‌عامل:</span>
                        <span className="font-bold text-slate-800">{ua.os}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block mb-0.5">مرورگر وب:</span>
                        <span className="font-bold text-slate-800">{ua.browser}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 sm:col-span-3">
                        <span className="text-slate-400 block mb-1">شناسه خام مرورگر:</span>
                        <span className="font-mono text-3xs text-slate-600 break-all block ltr text-left bg-slate-50 p-2 rounded border border-slate-100">
                          {selectedLog.details.userAgent}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* View Mode Switcher */}
              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModalTab('visual')}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
                          modalTab === 'visual'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        نمایش تفاوت‌ها و تغییرات
                      </button>
                      <button
                        onClick={() => setModalTab('json')}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold text-xs transition-colors ${
                          modalTab === 'json'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5" />
                        داده خام رویداد
                      </button>
                    </div>
                  </div>

                  {modalTab === 'visual' ? (
                    <div className="space-y-4">
                      {/* Auth Event Details (LOGIN, LOGIN_FAILED, LOGOUT) */}
                      {(selectedLog.action === 'LOGIN' || selectedLog.action === 'LOGIN_FAILED' || selectedLog.action === 'LOGOUT') && (
                        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                          <div className="flex items-center gap-2 font-bold text-slate-800 text-xs">
                            {selectedLog.action === 'LOGIN' && <KeyRound className="w-4 h-4 text-emerald-600" />}
                            {selectedLog.action === 'LOGIN_FAILED' && <AlertCircle className="w-4 h-4 text-rose-600" />}
                            {selectedLog.action === 'LOGOUT' && <LogOut className="w-4 h-4 text-slate-600" />}
                            <span>جزئیات نشست و احراز هویت کاربر</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                            <div className="bg-white p-3 rounded-lg border border-slate-200">
                              <span className="text-slate-400 block mb-0.5 text-2xs">وضعیت رویداد:</span>
                              <span className={`font-bold ${
                                selectedLog.action === 'LOGIN' ? 'text-emerald-700' :
                                selectedLog.action === 'LOGIN_FAILED' ? 'text-rose-700' : 'text-slate-700'
                              }`}>
                                {selectedLog.action === 'LOGIN' ? 'ورود موفق به سامانه' :
                                 selectedLog.action === 'LOGIN_FAILED' ? 'تلاش ناموفق برای ورود' : 'خروج از حساب کاربری'}
                              </span>
                            </div>

                            {selectedLog.details.reason && (
                              <div className="bg-white p-3 rounded-lg border border-rose-100 bg-rose-50/30">
                                <span className="text-rose-400 block mb-0.5 text-2xs">علت عدم موفقیت:</span>
                                <span className="font-bold text-rose-700">{selectedLog.details.reason}</span>
                              </div>
                            )}

                            {selectedLog.details.method && (
                              <div className="bg-white p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-400 block mb-0.5 text-2xs">شیوه احراز هویت:</span>
                                <span className="font-semibold text-slate-800">{selectedLog.details.method}</span>
                              </div>
                            )}

                            {selectedLog.details.remainingAttempts !== undefined && (
                              <div className="bg-white p-3 rounded-lg border border-amber-200 bg-amber-50/30">
                                <span className="text-amber-600 block mb-0.5 text-2xs">فرصت‌های باقیمانده ورود:</span>
                                <span className="font-mono font-bold text-amber-800">{formatPersianNumber(selectedLog.details.remainingAttempts)} بار دیگر</span>
                              </div>
                            )}

                            {selectedLog.details.lockoutMinutes && (
                              <div className="bg-white p-3 rounded-lg border border-rose-200 bg-rose-50/30">
                                <span className="text-rose-500 block mb-0.5 text-2xs">مدت قفل حساب:</span>
                                <span className="font-mono font-bold text-rose-800">{formatPersianNumber(selectedLog.details.lockoutMinutes)} دقیقه</span>
                              </div>
                            )}

                            {selectedLog.details.role && (
                              <div className="bg-white p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-400 block mb-0.5 text-2xs">نقش کاربری در زمان ورود:</span>
                                <span className="font-semibold text-slate-800">{selectedLog.details.roleName || selectedLog.details.role}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Visual Diff Component (Changes, Permissions, Before/After Snapshots) */}
                      <AuditDiffViewer details={selectedLog.details} action={selectedLog.action} />
                    </div>
                  ) : (
                    <div>
                      <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-2xs font-mono ltr text-left max-h-72">
                        {JSON.stringify(selectedLog.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2 bg-slate-900 text-white font-semibold text-xs rounded-xl hover:bg-slate-800 transition-colors"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Print Preview Modal */}
      {printReport && (
        <AuditPrintModal
          logs={printReport.rows}
          total={printReport.total}
          onClose={() => setPrintReport(null)}
          filterSummary={{
            categoryLabel: categories.find(c => c.id === categoryFilter)?.label,
            userFilter,
            actionFilter: actionFilter ? auditActionLabel(actionFilter) : '',
            entityFilter,
            searchText: debouncedSearchQuery.trim(),
            startDate,
            endDate
          }}
        />
      )}
    </div>
  );
}
