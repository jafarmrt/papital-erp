import React, { useState, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import {
  AlertOctagon,
  RefreshCw,
  Search,
  Filter,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Edit3,
  Eye,
  AlertTriangle,
  Play,
  Layers,
  ChevronDown,
  ChevronUp,
  Sliders,
  CheckSquare,
  Square
} from 'lucide-react';
import { formatPersianDate } from '../../utils';
import { fetchJson } from '../../api';

interface DeadLetterItem {
  id: number;
  originalEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  source: string;
  payload: any;
  metadata: any;
  failureReason: string;
  errorStack?: string;
  retryCount: number;
  status: 'quarantined' | 'replayed' | 'dismissed';
  quarantinedAt: string;
  resolvedAt?: string;
  resolvedBy?: number;
  resolutionNotes?: string;
}

interface DLQStats {
  total: number;
  quarantined: number;
  replayed: number;
  dismissed: number;
  byEventType: Record<string, number>;
  bySource: Record<string, number>;
}

export function DeadLetterQueueSubTab() {
  const [items, setItems] = useState<DeadLetterItem[]>([]);
  const [stats, setStats] = useState<DLQStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Action Loading states
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [isBatchReplaying, setIsBatchReplaying] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Edit Payload Modal state
  const [editingItem, setEditingItem] = useState<DeadLetterItem | null>(null);
  const [editedPayloadJson, setEditedPayloadJson] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSavingPayload, setIsSavingPayload] = useState(false);

  // Notification
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchStats = async () => {
    try {
      const data = await fetchJson<{ success?: boolean; stats?: DLQStats }>('/events/dlq/stats');
      if (data?.success && data.stats) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching DLQ stats:', err);
    }
  };

  const fetchEvents = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (sourceFilter !== 'all') params.append('source', sourceFilter);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      params.append('limit', '100');

      const data = await fetchJson<{ success?: boolean; data?: DeadLetterItem[]; message?: string }>(`/events/dlq?${params.toString()}`);
      if (data?.success) {
        setItems(Array.isArray(data.data) ? data.data : []);
      } else {
        showToast(data?.message || 'خطا در دریافت لیست DLQ', 'error');
      }
    } catch (err) {
      showToast('خطا در ارتباط با سرور', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchEvents();
  }, [statusFilter, sourceFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEvents();
  };

  const handleReplaySingle = async (id: number) => {
    setActionLoadingId(id);
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>(`/events/dlq/${id}/replay`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (data?.success) {
        showToast('رویداد با موفقیت بازپخش و در گذرگاه پردازش شد.', 'success');
        fetchStats();
        fetchEvents();
      } else {
        showToast(data?.message || 'خطا در بازپخش رویداد', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در بازپخش رویداد', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDismissSingle = async (id: number) => {
    setActionLoadingId(id);
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>(`/events/dlq/${id}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'نادیده‌گرفته‌شده توسط کاربر مدیر' })
      });
      if (data?.success) {
        showToast('رویداد از صف فعال کنار گذاشته شد.', 'success');
        fetchStats();
        fetchEvents();
      } else {
        showToast(data?.message || 'خطا در نادیده‌گرفتن رویداد', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در نادیده‌گرفتن رویداد', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleBatchReplay = async () => {
    if (selectedIds.length === 0) return;
    setIsBatchReplaying(true);
    try {
      const data = await fetchJson<{ success?: boolean; succeeded?: number; total?: number; message?: string }>('/events/dlq/replay-batch', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds })
      });
      if (data?.success) {
        showToast(`بازپخش موفق: ${data.succeeded} از ${data.total} رویداد با موفقیت بازپخش شد.`, 'success');
        setSelectedIds([]);
        fetchStats();
        fetchEvents();
      } else {
        showToast(data?.message || 'خطا در بازپخش دسته‌ای', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در بازپخش دسته‌ای', 'error');
    } finally {
      setIsBatchReplaying(false);
    }
  };

  const handlePurgeResolved = async () => {
    if (!(await confirmAction({ title: 'پاکسازی صف پیام‌های مرده', message: 'آیا از پاکسازی تمام رکوردهای حل‌شده یا نادیده‌گرفته‌شده اطمینان دارید؟' }))) return;
    setIsPurging(true);
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>('/events/dlq/purge', {
        method: 'POST'
      });
      if (data?.success) {
        showToast(data.message || 'پاکسازی با موفقیت انجام شد.', 'success');
        fetchStats();
        fetchEvents();
      } else {
        showToast(data?.message || 'خطا در پاکسازی', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در پاکسازی', 'error');
    } finally {
      setIsPurging(false);
    }
  };

  const openEditModal = (item: DeadLetterItem) => {
    setEditingItem(item);
    setEditedPayloadJson(JSON.stringify(item.payload || {}, null, 2));
    setJsonError(null);
  };

  const saveEditedPayloadAndReplay = async (andReplay: boolean = false) => {
    if (!editingItem) return;
    try {
      const parsed = JSON.parse(editedPayloadJson);
      setIsSavingPayload(true);

      const data = await fetchJson<{ success?: boolean; message?: string }>(`/events/dlq/${editingItem.id}/payload`, {
        method: 'PUT',
        body: JSON.stringify({ payload: parsed })
      });

      if (!data?.success) {
        showToast(data?.message || 'خطا در ذخیره تغییرات بدنه', 'error');
        setIsSavingPayload(false);
        return;
      }

      if (andReplay) {
        await handleReplaySingle(editingItem.id);
      } else {
        showToast('بدنه رویداد با موفقیت به‌روزرسانی شد.', 'success');
        fetchEvents();
      }

      setEditingItem(null);
    } catch (err) {
      setJsonError('فرمت JSON وارد شده نامعتبر است: ' + err.message);
    } finally {
      setIsSavingPayload(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map(i => i.id));
    }
  };

  const toggleSelectOne = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-6" id="dead-letter-queue-tab">
      {/* Toast Notification */}
      {toast && (
        <div
          id="dlq-toast"
          className={`p-4 rounded-xl shadow-lg border flex items-center justify-between text-sm transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800/50 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="font-medium">{toast.text}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">
            بستن
          </button>
        </div>
      )}

      {/* Header Info & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">در قرنطینه (Quarantined)</span>
            <div className="p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl">
              <AlertOctagon className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.quarantined.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">رویدادهای نیازمند بازبینی و بازپخش</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">بازپخش موفق (Replayed)</span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.replayed.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">رویدادهای بازیابی‌شده در گذرگاه</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">صرف‌نظر شده (Dismissed)</span>
            <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.dismissed.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">رویدادهای نادیده‌گرفته توسط مدیر</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">کل خطاهای ماندگار (Total DLQ)</span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.total.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">نرخ بقا و ذخیره امن رویدادها</p>
        </div>
      </div>

      {/* Control Bar: Filters & Batch Actions */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="quarantined">فقط در قرنطینه</option>
              <option value="replayed">بازپخش‌شده</option>
              <option value="dismissed">صرف‌نظرشده</option>
            </select>
          </div>

          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <span className="text-xs text-slate-400">منبع:</span>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="all">تمام منابع</option>
              <option value="outbox">صندوق برون‌رو (Outbox)</option>
              <option value="action_engine">موتور اکشن‌ها (Action Engine)</option>
              <option value="webhook">وب‌هوک‌ها (Webhooks)</option>
            </select>
          </div>

          <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="جستجو در شناسه، نوع رویداد یا متن خطا..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl pr-9 pl-4 py-2 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          </form>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {selectedIds.length > 0 && (
            <button
              onClick={handleBatchReplay}
              disabled={isBatchReplaying}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isBatchReplaying ? 'animate-spin' : ''}`} />
              <span>بازپخش {selectedIds.length} مورد</span>
            </button>
          )}

          <button
            onClick={handlePurgeResolved}
            disabled={isPurging}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-all"
            title="پاکسازی رکوردهای حل‌شده یا رد‌شده"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-500" />
            <span>پاکسازی حل‌شده‌ها</span>
          </button>

          <button
            onClick={() => {
              fetchStats();
              fetchEvents();
            }}
            disabled={isLoading}
            className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all"
            title="به‌روزرسانی جدول"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3 w-10 text-center">
                  <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    {selectedIds.length === items.length && items.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="p-3 font-semibold">شناسه رویداد / نوع</th>
                <th className="p-3 font-semibold">موجودیت (Aggregate)</th>
                <th className="p-3 font-semibold">منبع و تلاش</th>
                <th className="p-3 font-semibold">علت شکست و قرنطینه</th>
                <th className="p-3 font-semibold">وضعیت</th>
                <th className="p-3 font-semibold">تاریخ قرنطینه</th>
                <th className="p-3 font-semibold text-center w-36">عملیات بازیابی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    در حال دریافت داده‌های صف Dead Letter...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    هیچ رویدادی در صف قرنطینه وجود ندارد. تمام جریان‌های دامنه‌ای پایدار و سلامت هستند.
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const isSelected = selectedIds.includes(item.id);
                  const isExpanded = expandedId === item.id;
                  const isActing = actionLoadingId === item.id;

                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                          isSelected ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''
                        }`}
                      >
                        <td className="p-3 text-center">
                          <button onClick={() => toggleSelectOne(item.id)}>
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                        </td>

                        <td className="p-3">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{item.eventType}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5" title={item.originalEventId}>
                            {item.originalEventId.substring(0, 18)}...
                          </div>
                        </td>

                        <td className="p-3">
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {item.aggregateType} #{item.aggregateId}
                          </span>
                        </td>

                        <td className="p-3">
                          <div className="text-slate-700 dark:text-slate-300 font-medium">
                            {item.source === 'outbox'
                              ? 'صندوق Outbox'
                              : item.source === 'action_engine'
                              ? 'موتور اکشن‌ها'
                              : item.source === 'webhook'
                              ? 'وب‌هوک مقصد'
                              : item.source}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">تعداد تلاش: {item.retryCount} بار</div>
                        </td>

                        <td className="p-3 max-w-xs">
                          <div className="text-rose-600 dark:text-rose-400 line-clamp-2" title={item.failureReason}>
                            {item.failureReason}
                          </div>
                        </td>

                        <td className="p-3">
                          {item.status === 'quarantined' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                              در قرنطینه
                            </span>
                          ) : item.status === 'replayed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" />
                              بازپخش‌شده
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              صرف‌نظرشده
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-slate-500 dark:text-slate-400">
                          {formatPersianDate(item.quarantinedAt)}
                        </td>

                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleReplaySingle(item.id)}
                              disabled={isActing}
                              className="p-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg transition-all"
                              title="بازپخش فوری رویداد"
                            >
                              <RotateCcw className={`w-3.5 h-3.5 ${isActing ? 'animate-spin' : ''}`} />
                            </button>

                            <button
                              onClick={() => openEditModal(item)}
                              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg transition-all"
                              title="اصلاح داده و بازپخش"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {item.status === 'quarantined' && (
                              <button
                                onClick={() => handleDismissSingle(item.id)}
                                disabled={isActing}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-lg transition-all"
                                title="صرف‌نظر و نادیده‌گرفتن"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                              title="مشاهده جزئیات Payload"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded View */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
                          <td colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                                  <span>بدنه رویداد (Payload):</span>
                                  <button
                                    onClick={() => openEditModal(item)}
                                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                                  >
                                    <Edit3 className="w-3 h-3" /> ویرایش Payload
                                  </button>
                                </div>
                                <pre className="text-[11px] font-mono bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto max-h-56 dir-ltr text-left">
                                  {JSON.stringify(item.payload, null, 2)}
                                </pre>
                              </div>

                              <div>
                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">ردیابی خطا (Error Stack Trace):</div>
                                <div className="text-[11px] font-mono bg-rose-950/20 border border-rose-900/40 text-rose-300 p-3 rounded-xl overflow-x-auto max-h-56 dir-ltr text-left">
                                  {item.errorStack || item.failureReason || 'ردیابی ذخیره نشده است.'}
                                </div>
                              </div>
                            </div>

                            {item.resolvedAt && (
                              <div className="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>حل‌شده در تاریخ {formatPersianDate(item.resolvedAt)}: {item.resolutionNotes}</span>
                              </div>
                            )}
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

      {/* Edit Payload Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full shadow-2xl space-y-4 p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-indigo-500" />
                  اصلاح بدنه رویداد #{editingItem.id} ({editingItem.eventType})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  مقادیر معیوب را اصلاح کنید و سپس رویداد را در گذرگاه دامنه‌ای بازپخش نمایید.
                </p>
              </div>
              <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                ✕
              </button>
            </div>

            {jsonError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300">
                {jsonError}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">محتوای JSON بدنه (Payload):</label>
              <textarea
                rows={12}
                value={editedPayloadJson}
                onChange={e => {
                  setEditedPayloadJson(e.target.value);
                  setJsonError(null);
                }}
                className="w-full font-mono text-xs p-3 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 dir-ltr text-left"
              />
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                انصراف
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveEditedPayloadAndReplay(false)}
                  disabled={isSavingPayload}
                  className="px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl transition-all"
                >
                  صرفاً ذخیره تغییرات
                </button>
                <button
                  type="button"
                  onClick={() => saveEditedPayloadAndReplay(true)}
                  disabled={isSavingPayload}
                  className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all flex items-center gap-1.5"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isSavingPayload ? 'animate-spin' : ''}`} />
                  <span>ذخیره و بازپخش فوری</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
