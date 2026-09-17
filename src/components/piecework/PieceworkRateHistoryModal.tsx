import React, { useState, useEffect, useMemo } from 'react';
import { X, History, TrendingUp, TrendingDown, Clock, User, Search, FileSpreadsheet, RotateCcw, CheckCircle2, Trash2, Filter, RefreshCw } from 'lucide-react';
import { PieceworkTask, PieceworkTaskRateHistory } from '../../types';
import { formatPersianPrice } from '../../utils';
import { fetchJson } from '../../api';
import { toast as hotToast } from 'react-hot-toast';

interface PieceworkRateHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTask?: PieceworkTask | null;
  onTaskRestored?: () => void;
}

export const PieceworkRateHistoryModal: React.FC<PieceworkRateHistoryModalProps> = ({
  isOpen,
  onClose,
  selectedTask,
  onTaskRestored
}) => {
  const [historyList, setHistoryList] = useState<PieceworkTaskRateHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('all');

  const fetchHistory = async () => {
    setLoading(true);
    try {
      if (selectedTask?.id) {
        const res = await fetchJson<PieceworkTaskRateHistory[]>(`/piecework/tasks/${selectedTask.id}/history`);
        setHistoryList(Array.isArray(res) ? res : []);
      } else {
        const res = await fetchJson<PieceworkTaskRateHistory[]>('/piecework/tasks-history');
        setHistoryList(Array.isArray(res) ? res : []);
      }
    } catch (err: any) {
      console.error('Error fetching rate history:', err);
      hotToast.error(err?.message || 'خطا در دریافت تاریخچه تغییرات نرخ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setFilterType('all');
      fetchHistory();
    }
  }, [isOpen, selectedTask]);

  const filteredHistory = useMemo(() => {
    let list = Array.isArray(historyList) ? historyList : [];

    if (filterType !== 'all') {
      list = list.filter(item => item.changeType === filterType);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        item =>
          item.taskTitle?.toLowerCase().includes(q) ||
          item.taskCode?.toLowerCase().includes(q) ||
          item.reason?.toLowerCase().includes(q) ||
          item.changedByUsername?.toLowerCase().includes(q) ||
          item.effectiveDate?.includes(q)
      );
    }

    return list;
  }, [historyList, filterType, searchQuery]);

  if (!isOpen) return null;

  const getChangeTypeBadge = (type: string) => {
    switch (type) {
      case 'create':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/50">
            <CheckCircle2 className="w-3 h-3" />
            تعریف اولیه
          </span>
        );
      case 'rate_change':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50">
            <TrendingUp className="w-3 h-3" />
            تغییر نرخ
          </span>
        );
      case 'excel_import':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/50">
            <FileSpreadsheet className="w-3 h-3" />
            ورود از اکسل
          </span>
        );
      case 'title_change':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50">
            ویرایش عنوان
          </span>
        );
      case 'archived':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/50">
            <Trash2 className="w-3 h-3" />
            حذف / بایگانی
          </span>
        );
      case 'restored':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/50">
            <RotateCcw className="w-3 h-3" />
            بازیابی
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {type}
          </span>
        );
    }
  };

  return (
    <div
      id="rate-history-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="rate-history-modal-container"
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-right"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                {selectedTask ? (
                  <>
                    <span>تاریخچه تغییرات و نرخ‌های عنوان کاری:</span>
                    <span className="text-amber-600 dark:text-amber-400 font-extrabold">
                      «{selectedTask.title}»
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-200/70 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-300 font-mono">
                      {selectedTask.code}
                    </span>
                  </>
                ) : (
                  'گاه‌شمار کامل تغییرات نرخ‌ها و عناوین پرکیسی'
                )}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {selectedTask
                  ? 'مشاهده تمام نرخ‌های قبلی، تغییرات ثبت‌شده، زمان اعمال و کاربر ویرایش‌کننده'
                  : 'مشاهده تاریخچه جامع تمام اصلاحات، تغییر مبالغ، حذف‌ها و ورودی‌های فایل اکسل'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchHistory}
              disabled={loading}
              title="بارگذاری مجدد"
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 text-gray-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="جستجو در عنوان، کد، توضیحات، تاریخ یا کاربر..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-3 pr-9 py-2 text-sm bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-gray-800 dark:text-gray-100 placeholder-gray-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="py-2 px-3 text-xs bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 text-gray-700 dark:text-gray-200"
            >
              <option value="all">همه انواع رویدادها</option>
              <option value="rate_change">فقط تغییر نرخ</option>
              <option value="create">تعریف اولیه</option>
              <option value="excel_import">واردات اکسل</option>
              <option value="archived">حذف و بایگانی</option>
              <option value="restored">بازیابی شده</option>
            </select>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mb-3" />
              <p className="text-sm">در حال بارگذاری تاریخچه نرخ‌ها...</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                <Clock className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                هیچ رکوردی در تاریخچه تغییرات یافت نشد
              </p>
              <p className="text-xs text-gray-500 mt-1 max-w-sm text-center">
                با هر بار ایجاد، ویرایش، تغییر نرخ در اکسل یا حذف عنوان، تاریخچه آن به صورت خودکار در این بخش ثبت می‌شود.
              </p>
            </div>
          ) : (
            <div className="relative pl-2 pr-4 border-r-2 border-amber-200 dark:border-amber-900/60 mr-4 space-y-6">
              {filteredHistory.map((item, idx) => {
                const oldRate = Number(item.oldRate || 0);
                const newRate = Number(item.newRate || 0);
                const hasRateDiff = oldRate > 0 && newRate !== oldRate;
                const isIncrease = newRate > oldRate;
                const diffAmount = Math.abs(newRate - oldRate);
                const pctChange = oldRate > 0 ? Math.round(((newRate - oldRate) / oldRate) * 100) : 0;

                return (
                  <div key={item.id || idx} className="relative group">
                    {/* Timeline Node Dot */}
                    <div className="absolute -right-[23px] top-1.5 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-gray-800 shadow-xs" />

                    <div className="bg-gray-50/80 dark:bg-gray-900/40 rounded-xl p-4 border border-gray-200/80 dark:border-gray-700/70 hover:border-amber-300 dark:hover:border-amber-700 transition shadow-2xs">
                      {/* Top Row: Meta and Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2">
                          {getChangeTypeBadge(item.changeType)}
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                            {item.effectiveDate || 'تاریخ نامشخص'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-gray-400" />
                            {item.changedByUsername || 'سیستم'}
                          </span>
                        </div>
                      </div>

                      {/* Task Info (if in global view) */}
                      {!selectedTask && (
                        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                          <span>{item.taskTitle}</span>
                          {item.taskCode && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                              {item.taskCode}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Rate Comparison Box */}
                      <div className="flex flex-wrap items-center gap-3 my-2.5 p-2.5 rounded-lg bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50">
                        {item.changeType === 'create' ? (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500 dark:text-gray-400 text-xs">نرخ پایه اولیه:</span>
                            <span className="font-bold text-gray-900 dark:text-white font-mono">
                              {formatPersianPrice(newRate)}
                            </span>
                          </div>
                        ) : hasRateDiff ? (
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-gray-400 line-through text-xs font-mono">
                              {formatPersianPrice(oldRate)}
                            </span>
                            <span className="text-gray-400">←</span>
                            <span className="font-bold text-gray-900 dark:text-white font-mono">
                              {formatPersianPrice(newRate)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-semibold ${
                                isIncrease
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                              }`}
                            >
                              {isIncrease ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              <span>{pctChange > 0 ? `+${pctChange}%` : `${pctChange}%`}</span>
                              <span className="text-[10px] opacity-75">
                                ({formatPersianPrice(diffAmount)})
                              </span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500 dark:text-gray-400 text-xs">نرخ ثبت‌شده:</span>
                            <span className="font-bold text-gray-800 dark:text-gray-200 font-mono">
                              {formatPersianPrice(newRate)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Reason / Notes */}
                      {item.reason && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 flex items-start gap-1.5">
                          <span className="text-gray-400 font-medium">توضیح:</span>
                          <span>{item.reason}</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/80">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            تعداد رکوردهای ثبت‌شده: <strong className="text-gray-800 dark:text-gray-200 font-mono">{filteredHistory.length}</strong> مورد
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};
