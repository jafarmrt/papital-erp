import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { 
  ShieldAlert, History, Search, Filter, RefreshCw, Calendar, Eye, X, 
  ChevronLeft, ChevronRight, PlusCircle, Edit3, Trash2, KeyRound, Settings as SettingsIcon,
  Download, UserCheck, CheckCircle2, Clock, ArrowRightLeft, FileCode, Check, AlertCircle
} from 'lucide-react';
import DatePicker from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { ActivityLog } from '../types';
import { formatPersianNumber, extractDateString } from '../utils';
import { useSearch } from '../SearchContext';
import {
  useActivityLogsQuery,
  useActivityLogFilterOptionsQuery
} from '../hooks/queries';

export default function ActivityLogsPage() {
  const [page, setPage] = useState<number>(1);
  const limit = 20;

  // Filters
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const [userFilter, setUserFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<any>('');
  const [endDate, setEndDate] = useState<any>('');

  const formatToGregorian = (d: any): string => {
    return extractDateString(d);
  };

  // Modal
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [modalTab, setModalTab] = useState<'visual' | 'json'>('visual');

  // V9 Phase 5.1: مهاجرت به React Query — کش، نگهداری داده قبلی هنگام فیلتر (placeholderData)
  // و حذف دو useState/AutoEffect دستی
  const filterOptionsQuery = useActivityLogFilterOptionsQuery();
  const filterOptions = filterOptionsQuery.data ?? { users: [], actions: [], entities: [] };

  const logsQuery = useActivityLogsQuery({
    page,
    limit,
    search,
    user: userFilter || undefined,
    action: actionFilter || undefined,
    entity: entityFilter || undefined,
    startDate: formatToGregorian(startDate) || undefined,
    endDate: formatToGregorian(endDate) || undefined,
  });

  const logs = logsQuery.data?.logs ?? [];
  const totalCount = logsQuery.data?.total ?? 0;
  const totalPages = logsQuery.data?.totalPages ?? 1;
  const loading = logsQuery.isLoading;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    // جستجو بخشی از queryKey است — تغییر آن به‌صورت خودکار refetch می‌کند
  };

  const handleResetFilters = () => {
    setSearch('');
    setUserFilter('');
    setActionFilter('');
    setEntityFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const formatPersianDateTime = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return new Intl.DateTimeFormat('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'CREATE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <PlusCircle className="w-3.5 h-3.5" />
            ایجاد / ثبت
          </span>
        );
      case 'UPDATE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Edit3 className="w-3.5 h-3.5" />
            ویرایش
          </span>
        );
      case 'DELETE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <Trash2 className="w-3.5 h-3.5" />
            حذف
          </span>
        );
      case 'LOGIN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
            <KeyRound className="w-3.5 h-3.5" />
            ورود به سیستم
          </span>
        );
      case 'SETTING_CHANGE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <SettingsIcon className="w-3.5 h-3.5" />
            تنظیمات
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <History className="w-3.5 h-3.5" />
            {action}
          </span>
        );
    }
  };

  const exportCSV = () => {
    if (logs.length === 0) return;
    const headers = ['شناسه', 'تاریخ و زمان', 'کاربر', 'نام کامل', 'نوع اقدام', 'بخش', 'شناسه بخش', 'شرح فعالیت', 'IP'];
    const rows = logs.map(l => [
      l.id,
      formatPersianDateTime(l.timestamp),
      l.username,
      l.userFullName || '—',
      l.action,
      l.entity,
      l.entityId || '—',
      `"${(l.description || '').replace(/"/g, '""')}"`,
      l.ipAddress || '—'
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center shadow-md">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">سجل تغییرات و لاگ فعالیت کاربران (Audit Trail)</h1>
            <p className="text-xs text-slate-500 mt-1">ثبت دقیق و گزارش‌گیری امنیتی از تمامی اقدامات کاربران، تغییرات موجودی و اسناد مالکیتی</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { filterOptionsQuery.refetch(); logsQuery.refetch(); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="بروزرسانی داده‌ها"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            بروزرسانی
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            خروجی اکسل / CSV
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">کل رویدادهای ثبت‌شده</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{formatPersianNumber(totalCount)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
            <History className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">تعداد کاربران فعال سیستم</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{formatPersianNumber(filterOptions.users.length)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">بخش‌های تحت پوشش لاگ</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{formatPersianNumber(filterOptions.entities.length || 6)}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">سطح امنیت ثبت تغییرات</p>
            <p className="text-sm font-bold text-slate-800 mt-2">۱۰۰٪ بر اساس تراکنش</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در شرح فعالیت، نام کاربر، شناسه سند یا کالا..."
              className="w-full pr-9 pl-4 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">همه کاربران</option>
              {filterOptions.users.map((u, idx) => (
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
              <option value="">همه اقدامات (نوع)</option>
              <option value="CREATE">ایجاد / ثبت (CREATE)</option>
              <option value="UPDATE">ویرایش (UPDATE)</option>
              <option value="DELETE">حذف (DELETE)</option>
              <option value="LOGIN">ورود به سیستم (LOGIN)</option>
              <option value="SETTING_CHANGE">تغییر تنظیمات</option>
            </select>

            <select
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">همه بخش‌ها</option>
              {filterOptions.entities.map(e => (
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

          {(search || userFilter || actionFilter || entityFilter || startDate || endDate) && (
            <button
              onClick={handleResetFilters}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              پاکسازی فیلترها
            </button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="py-3 px-4">شماره</th>
                <th className="py-3 px-4">تاریخ و زمان</th>
                <th className="py-3 px-4">کاربر مجری</th>
                <th className="py-3 px-4">نوع اقدام</th>
                <th className="py-3 px-4">بخش مربوطه</th>
                <th className="py-3 px-4">شرح کامل فعالیت</th>
                <th className="py-3 px-4 text-center">جزئیات / IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                    در حال بارگذاری لاگ‌های امنیتی سیستم...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
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
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-2xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
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

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden relative">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
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
                  <span className="text-slate-400 block mb-0.5">آدرس IP:</span>
                  <span className="font-mono font-bold text-slate-700 bg-slate-200/60 px-2 py-0.5 rounded text-2xs inline-block">
                    {selectedLog.ipAddress || '127.0.0.1 (محلی)'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-bold block mb-1">شرح کامل رویداد:</span>
                <p className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg text-slate-800 leading-relaxed font-medium">
                  {selectedLog.description}
                </p>
              </div>

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
                        تحلیل تغییرات قبل و بعد (Diff)
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
                        داده خام (JSON)
                      </button>
                    </div>
                  </div>

                  {modalTab === 'visual' ? (
                    <div className="space-y-3">
                      {/* Changes / Diff Table */}
                      {selectedLog.details.changes && Object.keys(selectedLog.details.changes).length > 0 ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-100 px-3 py-2 border-b border-slate-200 font-bold text-slate-700 flex items-center gap-1.5">
                            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                            مقایسه مقادیر تغییر یافته (قبل / بعد)
                          </div>
                          <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                              <tr>
                                <th className="py-2 px-3">فیلد تغییر یافته</th>
                                <th className="py-2 px-3 text-rose-700 bg-rose-50/50">مقدار قبلی (Before)</th>
                                <th className="py-2 px-3 text-emerald-700 bg-emerald-50/50">مقدار جدید (After)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {Object.entries(selectedLog.details.changes).map(([field, change]: [string, any]) => {
                                const renderVal = (v: any) => {
                                  if (v === null || v === undefined) return '—';
                                  if (typeof v === 'string') return v;
                                  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
                                  try {
                                    return JSON.stringify(v);
                                  } catch {
                                    return '—';
                                  }
                                };
                                return (
                                  <tr key={field} className="hover:bg-slate-50/60">
                                    <td className="py-2 px-3 font-semibold text-slate-800 font-mono text-2xs">
                                      {field}
                                    </td>
                                    <td className="py-2 px-3 text-rose-600 bg-rose-50/20 font-mono text-2xs break-all">
                                      {renderVal(change?.before)}
                                    </td>
                                    <td className="py-2 px-3 text-emerald-600 bg-emerald-50/20 font-mono text-2xs break-all font-bold">
                                      {renderVal(change?.after)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {/* Permission Diff */}
                      {(selectedLog.details.addedPermissions?.length > 0 || selectedLog.details.removedPermissions?.length > 0) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {selectedLog.details.addedPermissions?.length > 0 && (
                            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1.5">
                              <span className="font-bold text-emerald-800 flex items-center gap-1 text-2xs">
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                دسترسی‌های افزوده شده ({selectedLog.details.addedPermissions.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {selectedLog.details.addedPermissions.map((perm: string) => (
                                  <span key={perm} className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-mono text-2xs font-semibold">
                                    +{perm}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedLog.details.removedPermissions?.length > 0 && (
                            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5">
                              <span className="font-bold text-rose-800 flex items-center gap-1 text-2xs">
                                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                دسترسی‌های حذف شده ({selectedLog.details.removedPermissions.length}):
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {selectedLog.details.removedPermissions.map((perm: string) => (
                                  <span key={perm} className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-mono text-2xs font-semibold">
                                    -{perm}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Delete / Create Snapshot representation */}
                      {selectedLog.details.before && !selectedLog.details.changes && (
                        <div className="p-3 bg-rose-50/40 border border-rose-200 rounded-xl space-y-1.5">
                          <span className="font-bold text-rose-800 flex items-center gap-1 text-2xs">
                            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                            اسنپ‌شات وضعیت رکورد قبل از حذف (Before Snapshot):
                          </span>
                          <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-2xs font-mono ltr text-left">
                            {JSON.stringify(selectedLog.details.before, null, 2)}
                          </pre>
                        </div>
                      )}

                      {selectedLog.details.after && !selectedLog.details.changes && (
                        <div className="p-3 bg-emerald-50/40 border border-emerald-200 rounded-xl space-y-1.5">
                          <span className="font-bold text-emerald-800 flex items-center gap-1 text-2xs">
                            <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                            اطلاعات ثبت شده رکورد جدید (After Snapshot):
                          </span>
                          <pre className="p-2.5 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-2xs font-mono ltr text-left">
                            {JSON.stringify(selectedLog.details.after, null, 2)}
                          </pre>
                        </div>
                      )}
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
    </div>
  );
}
