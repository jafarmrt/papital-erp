import { useState, useEffect } from 'react';
import { Zap, RefreshCw, Search, Filter, CheckCircle2, Send, Activity, Package, FileText, GitBranch, CreditCard, ChevronDown, ChevronUp, Clock, Inbox, AlertTriangle, Play, RotateCcw, Database, Sliders, AlertOctagon, History, Globe } from 'lucide-react';
import { formatPersianDate } from '../../utils';
import { fetchJson } from '../../api';
import toast from 'react-hot-toast';
import { AutoActionsSubTab } from './AutoActionsSubTab';
import { DeadLetterQueueSubTab } from './DeadLetterQueueSubTab';
import { EventSourcingReplaySubTab } from './EventSourcingReplaySubTab';
import { WebhookManagementSubTab } from './WebhookManagementSubTab';

interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
  metadata: {
    userId?: number;
    userName?: string;
    correlationId?: string;
    timestamp: string;
  };
  occurredAt: string;
}

interface DomainEventStats {
  totalEmitted: number;
  eventCounts: Record<string, number>;
  recentCount: number;
}

interface OutboxEvent {
  id: number;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: any;
  metadata: any;
  retryCount: number;
  nextRetryAt?: string;
  lastError?: string;
  occurredAt: string;
  processedAt?: string;
}

interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  workerRunning: boolean;
}

export function DomainEventsTab() {
  const [activeSubTab, setActiveSubTab] = useState<'rules' | 'outbox' | 'dlq' | 'replay' | 'webhooks' | 'events'>('rules');
  
  // Live Domain Events state
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [stats, setStats] = useState<DomainEventStats | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Outbox state
  const [outboxEventsList, setOutboxEventsList] = useState<OutboxEvent[]>([]);
  const [outboxStats, setOutboxStats] = useState<OutboxStats | null>(null);
  const [isLoadingOutbox, setIsLoadingOutbox] = useState(false);
  const [outboxStatusFilter, setOutboxStatusFilter] = useState<string>('ALL');
  const [outboxSearchQuery, setOutboxSearchQuery] = useState<string>('');
  const [expandedOutboxId, setExpandedOutboxId] = useState<number | null>(null);
  const [isProcessingNow, setIsProcessingNow] = useState(false);
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);

  const [notificationMessage, setNotificationMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setNotificationMessage({ text, type });
    setTimeout(() => setNotificationMessage(null), 4500);
  };

  const fetchEvents = async (signal?: AbortSignal) => {
    try {
      setIsLoadingEvents(true);
      const json = await fetchJson<{ events?: DomainEvent[]; stats?: DomainEventStats }>(
        `/events/domain-events?limit=100&filter=${selectedFilter}`,
        { signal }
      );
      if (json) {
        setEvents(Array.isArray(json.events) ? json.events : []);
        setStats(json.stats || null);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching domain events:', err);
      toast.error('خطا در دریافت رویدادهای دامنه');
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const fetchOutbox = async (signal?: AbortSignal) => {
    try {
      setIsLoadingOutbox(true);
      const [statsJson, listJson] = await Promise.all([
        fetchJson<{ success?: boolean; stats?: OutboxStats }>('/events/outbox/stats', { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load outbox stats:', err);
          return null;
        }),
        fetchJson<{ success?: boolean; events?: OutboxEvent[] }>(`/events/outbox?limit=100&status=${outboxStatusFilter}`, { signal }).catch((err) => {
          if (err?.name === 'AbortError') throw err;
          console.error('Failed to load outbox events list:', err);
          return null;
        })
      ]);

      if (statsJson?.stats) {
        setOutboxStats(statsJson.stats);
      }
      setOutboxEventsList(Array.isArray(listJson?.events) ? listJson.events : []);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching outbox data:', err);
      toast.error('خطا در دریافت صف رویدادهای Outbox');
    } finally {
      setIsLoadingOutbox(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (activeSubTab === 'events') {
      fetchEvents(controller.signal);
    } else if (activeSubTab === 'outbox') {
      fetchOutbox(controller.signal);
    }
    return () => controller.abort();
  }, [activeSubTab, selectedFilter, outboxStatusFilter]);

  // Periodic polling for freshness
  useEffect(() => {
    if (activeSubTab !== 'events' && activeSubTab !== 'outbox') return;

    const interval = setInterval(() => {
      if (activeSubTab === 'events') {
        fetchEvents();
      } else if (activeSubTab === 'outbox') {
        fetchOutbox();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSubTab, selectedFilter, outboxStatusFilter]);

  const handleSimulateTestEvent = async () => {
    try {
      setIsSimulating(true);
      const res = await fetchJson<{ success?: boolean; message?: string }>('/events/domain-events/simulate', {
        method: 'POST',
        body: JSON.stringify({
          eventType: 'SimulatedTestEvent',
          aggregateType: 'System',
          aggregateId: `TEST_${Math.floor(Math.random() * 9000 + 1000)}`,
          payload: {
            description: 'ارزیابی و تست عملکردی خط لوله انتشار رویدادهای سازمانی (Event Pipeline)',
            timestamp: new Date().toISOString()
          }
        })
      });

      if (res?.success) {
        showNotification('رویداد آزمایشی با موفقیت در گذرگاه منتشر شد.');
        await fetchEvents();
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در انتشار رویداد آزمایشی', 'error');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleProcessOutboxNow = async () => {
    try {
      setIsProcessingNow(true);
      const json = await fetchJson<{ success?: boolean; message?: string }>('/events/outbox/process-now', {
        method: 'POST',
        body: JSON.stringify({ batchSize: 50 })
      });
      if (json?.success) {
        showNotification(json.message || 'پردازش دسته با موفقیت انجام شد.');
        await fetchOutbox();
      } else {
        showNotification(json?.message || 'خطا در پردازش فوری صندوق خروجی', 'error');
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در پردازش صندوق خروجی', 'error');
    } finally {
      setIsProcessingNow(false);
    }
  };

  const handleRetryAllFailed = async () => {
    try {
      setIsRetryingAll(true);
      const json = await fetchJson<{ success?: boolean; message?: string }>('/events/outbox/retry-failed', {
        method: 'POST'
      });
      if (json?.success) {
        showNotification(json.message || 'رویدادهای ناموفق برای ارسال مجدد آماده شدند.');
        await fetchOutbox();
      } else {
        showNotification(json?.message || 'خطا در بازنشانی رویدادهای ناموفق', 'error');
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در تلاش مجدد رویدادهای ناموفق', 'error');
    } finally {
      setIsRetryingAll(false);
    }
  };

  const handleRetrySingle = async (eventId: string) => {
    try {
      setRetryingEventId(eventId);
      const json = await fetchJson<{ success?: boolean; message?: string }>(`/events/outbox/${eventId}/retry`, {
        method: 'POST'
      });
      if (json?.success) {
        showNotification(json.message || `رویداد ${eventId} بازنشانی شد.`);
        await fetchOutbox();
      } else {
        showNotification(json?.message || 'خطا در تلاش مجدد رویداد', 'error');
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در تلاش مجدد', 'error');
    } finally {
      setRetryingEventId(null);
    }
  };

  const safeEvents = Array.isArray(events) ? events : [];
  const filteredEvents = safeEvents.filter(e => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (e.eventType || '').toLowerCase().includes(q) ||
      (e.aggregateType || '').toLowerCase().includes(q) ||
      String(e.aggregateId || '').toLowerCase().includes(q) ||
      (e.metadata?.userName || '').toLowerCase().includes(q) ||
      JSON.stringify(e.payload || {}).toLowerCase().includes(q)
    );
  });

  const safeOutboxEventsList = Array.isArray(outboxEventsList) ? outboxEventsList : [];
  const filteredOutbox = safeOutboxEventsList.filter(e => {
    if (!outboxSearchQuery) return true;
    const q = outboxSearchQuery.toLowerCase();
    return (
      (e.eventId || '').toLowerCase().includes(q) ||
      (e.eventType || '').toLowerCase().includes(q) ||
      (e.aggregateType || '').toLowerCase().includes(q) ||
      String(e.aggregateId || '').toLowerCase().includes(q) ||
      (e.lastError || '').toLowerCase().includes(q) ||
      JSON.stringify(e.payload || {}).toLowerCase().includes(q)
    );
  });

  const getEventIcon = (type: string, agg: string) => {
    if (agg === 'Document' || type.includes('Invoice') || type.includes('Purchase')) {
      return <FileText className="w-4 h-4 text-blue-500" />;
    }
    if (agg === 'Item' || type.includes('Stock')) {
      return <Package className="w-4 h-4 text-emerald-500" />;
    }
    if (agg === 'Workflow' || type.includes('Workflow')) {
      return <GitBranch className="w-4 h-4 text-indigo-500" />;
    }
    if (agg === 'Treasury' || type.includes('Payment') || type.includes('Cheque')) {
      return <CreditCard className="w-4 h-4 text-amber-500" />;
    }
    return <Zap className="w-4 h-4 text-purple-500" />;
  };

  const getStatusBadge = (status: OutboxEvent['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" />
            <span>پردازش‌شده</span>
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Clock className="w-3 h-3" />
            <span>در صف انتظار</span>
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>در حال پردازش</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <AlertTriangle className="w-3 h-3" />
            <span>ناموفق</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-tab Switcher */}
      <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                معماری رویدادها، اکشن‌های خودکار و صندوق خروجی (Events & Automation)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                مدیریت قوانین هوشمند واکنش به رخدادها، تضمین اتمیک بودن تراکنش‌ها و گذرگاه رویدادهای زنده دامنه‌ای
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher Toggle */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/60 p-1.5 rounded-xl border border-slate-200 dark:border-slate-600 flex-wrap">
          <button
            onClick={() => setActiveSubTab('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'rules'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>عملیات و قوانین خودکار</span>
          </button>

          <button
            onClick={() => setActiveSubTab('outbox')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'outbox'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>صندوق ارسال رویدادها</span>
          </button>

          <button
            onClick={() => setActiveSubTab('dlq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'dlq'
                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5 text-rose-500" />
            <span>صف خطاهای قرنطینه</span>
          </button>

          <button
            onClick={() => setActiveSubTab('replay')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'replay'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5 text-indigo-500" />
            <span>خط زمان و بازپخش رویدادها</span>
          </button>

          <button
            onClick={() => setActiveSubTab('webhooks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'webhooks'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-purple-500" />
            <span>اشتراک‌ها و وب‌هوک‌ها</span>
          </button>

          <button
            onClick={() => setActiveSubTab('events')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'events'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>گذرگاه رویدادهای زنده</span>
          </button>
        </div>
      </div>

      {notificationMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            notificationMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          {notificationMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{notificationMessage.text}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 1: AUTO ACTIONS & RULES (Phase 13) */}
      {/* ========================================================================= */}
      {activeSubTab === 'rules' && (
        <AutoActionsSubTab />
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 1: TRANSACTIONAL OUTBOX MONITOR */}
      {/* ========================================================================= */}
      {activeSubTab === 'outbox' && (
        <div className="space-y-6">
          {/* Outbox KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">کل رکوردهای صندوق خروجی</div>
              <div className="text-xl font-bold text-slate-800 dark:text-white mt-1">
                {outboxStats?.total ? outboxStats.total.toLocaleString('fa-IR') : '۰'}
              </div>
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{outboxStats?.workerRunning ? 'ورکر پس‌زمینه فعال' : 'ورکر در حال پایش'}</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">در صف ارسال / پردازش</div>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {((outboxStats?.pending || 0) + (outboxStats?.processing || 0)).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">تراکنش‌های آماده ارسال</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">پردازش موفق و تحویل‌شده</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {(outboxStats?.completed || 0).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">تحویل به مشترکین سیستم</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">ناموفق با تلاش مجدد (Backoff)</div>
              <div className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                {(outboxStats?.failed || 0).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">قابلیت ارسال مجدد خودکار</div>
            </div>
          </div>

          {/* Action Bar & Filters */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={outboxStatusFilter}
                  onChange={(e) => setOutboxStatusFilter(e.target.value)}
                  className="text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="ALL">همه وضعیت‌ها</option>
                  <option value="pending">در صف انتظار پردازش</option>
                  <option value="processing">در حال ارسال و پردازش</option>
                  <option value="completed">با موفقیت پردازش‌شده</option>
                  <option value="failed">ناموفق (خطا در پردازش)</option>
                </select>
              </div>

              <button
                onClick={() => fetchOutbox()}
                disabled={isLoadingOutbox}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOutbox ? 'animate-spin' : ''}`} />
                <span>تازه‌سازی</span>
              </button>

              <button
                onClick={handleProcessOutboxNow}
                disabled={isProcessingNow}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all disabled:opacity-50"
              >
                <Play className={`w-3.5 h-3.5 ${isProcessingNow ? 'animate-spin' : ''}`} />
                <span>{isProcessingNow ? 'در حال اجرا...' : 'پردازش دستی دسته'}</span>
              </button>

              {(outboxStats?.failed || 0) > 0 && (
                <button
                  onClick={handleRetryAllFailed}
                  disabled={isRetryingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 transition-all disabled:opacity-50"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isRetryingAll ? 'animate-spin' : ''}`} />
                  <span>تلاش مجدد تمام خطاهای ارسال ({outboxStats?.failed})</span>
                </button>
              )}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={outboxSearchQuery}
                onChange={(e) => setOutboxSearchQuery(e.target.value)}
                placeholder="جستجو در EventId، نوع، خطا..."
                className="w-full text-xs pr-8 pl-3 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none"
              />
            </div>
          </div>

          {/* Outbox Events Table / List */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                رویدادهای ذخیره‌شده در جدول outbox_events ({filteredOutbox.length.toLocaleString('fa-IR')} مورد)
              </span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>پایش دوره‌ای هر ۳ ثانیه توسط ورکر پس‌زمینه</span>
              </span>
            </div>

            {filteredOutbox.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                هیچ رویدادی با فیلتر انتخابی در صندوق خروجی یافت نشد.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredOutbox.map((evt) => {
                  const isExpanded = expandedOutboxId === evt.id;
                  return (
                    <div key={evt.id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                      <div 
                        onClick={() => setExpandedOutboxId(isExpanded ? null : evt.id)}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl mt-0.5">
                            {getEventIcon(evt.eventType, evt.aggregateType)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-slate-800 dark:text-white">
                                {evt.eventType}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md font-mono">
                                {evt.aggregateType}#{evt.aggregateId}
                              </span>
                              {getStatusBadge(evt.status)}
                              {evt.retryCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-md font-bold">
                                  تلاش {evt.retryCount}/۵
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              شناسه رویداد: <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{evt.eventId}</span>
                              {evt.lastError && (
                                <span className="text-rose-600 dark:text-rose-400 font-medium mr-2">
                                  | خطای آخرین تلاش: {evt.lastError}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end md:self-auto">
                          {evt.status === 'failed' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetrySingle(evt.eventId);
                              }}
                              disabled={retryingEventId === evt.eventId}
                              className="px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 rounded-lg transition-all"
                            >
                              {retryingEventId === evt.eventId ? 'در حال ارسال...' : 'تلاش مجدد'}
                            </button>
                          )}
                          <div className="text-left dir-ltr text-[11px] text-slate-400">
                            <div>ثبت: {evt.occurredAt ? formatPersianDate(evt.occurredAt) : '-'}</div>
                            {evt.processedAt && (
                              <div className="text-emerald-600 dark:text-emerald-400">
                                پردازش: {formatPersianDate(evt.processedAt)}
                              </div>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3.5 pt-3.5 border-t border-slate-100 dark:border-slate-700 text-xs space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 mb-2">
                            <div>
                              <span className="font-bold">شناسه دیتابیس (Primary Key):</span> #{evt.id}
                            </div>
                            <div>
                              <span className="font-bold">زمان تلاش بعدی (Backoff Time):</span>{' '}
                              {evt.nextRetryAt ? formatPersianDate(evt.nextRetryAt) : 'بلافاصله یا موفق'}
                            </div>
                          </div>
                          <div className="bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-[11px] overflow-x-auto text-left dir-ltr">
                            <pre>{JSON.stringify({ payload: evt.payload, metadata: evt.metadata, lastError: evt.lastError }, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: LIVE DOMAIN EVENTS BUS */}
      {/* ========================================================================= */}
      {activeSubTab === 'events' && (
        <div className="space-y-6">
          {/* KPI Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">مجموع رویدادهای منتشرشده</div>
              <div className="text-xl font-bold text-slate-800 dark:text-white mt-1">
                {stats?.totalEmitted ? stats.totalEmitted.toLocaleString('fa-IR') : '۰'}
              </div>
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1">
                <Activity className="w-3 h-3" />
                <span>گذرگاه فعال لحظه‌ای</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">گردش موجودی و انبار</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {((stats?.eventCounts?.['StockReceived'] || 0) + (stats?.eventCounts?.['StockIssued'] || 0)).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">ورود و خروج فیزیکی کالا</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">تغییرات فرآیند و ورکفلو</div>
              <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                {(stats?.eventCounts?.['WorkflowTransitioned'] || 0).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">پیشروی و امضای اسناد</div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="text-xs text-slate-500 dark:text-slate-400">رویدادهای مالی و اسناد</div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {((stats?.eventCounts?.['InvoiceApproved'] || 0) + (stats?.eventCounts?.['TreasuryTransactionApproved'] || 0)).toLocaleString('fa-IR')}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">فاکتورها و خزانه‌داری</div>
            </div>
          </div>

          {/* Filters, Search & Simulate Button */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={selectedFilter}
                  onChange={(e) => setSelectedFilter(e.target.value)}
                  className="text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="ALL">همه انواع رویدادها</option>
                  <option value="WorkflowTransitioned">تغییر وضعیت گردش‌کار</option>
                  <option value="StockReceived">ورود کالا به انبار</option>
                  <option value="StockIssued">خروج کالا از انبار</option>
                  <option value="InvoiceApproved">تایید فاکتور فروش</option>
                  <option value="PurchaseApproved">تایید فاکتور خرید</option>
                  <option value="TreasuryTransactionApproved">تراکنش خزانه‌داری و مالی</option>
                  <option value="SimulatedTestEvent">رویدادهای تستی و پایش</option>
                </select>
              </div>

              <button
                onClick={() => fetchEvents()}
                disabled={isLoadingEvents}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingEvents ? 'animate-spin' : ''}`} />
                <span>به‌روزرسانی</span>
              </button>

              <button
                onClick={handleSimulateTestEvent}
                disabled={isSimulating}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSimulating ? 'در حال انتشار...' : 'انتشار رویداد آزمایشی'}</span>
              </button>
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو در شناسه، کاربر یا محتوا..."
                className="w-full text-xs pr-8 pl-3 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none"
              />
            </div>
          </div>

          {/* Events List */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                فهرست آخرین رویدادهای زنده سیستم ({filteredEvents.length.toLocaleString('fa-IR')} مورد)
              </span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>به‌روزرسانی خودکار هر ۸ ثانیه</span>
              </span>
            </div>

            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                هیچ رویدادی با فیلترهای انتخابی یافت نشد.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredEvents.map((evt) => {
                  const isExpanded = expandedEventId === evt.eventId;
                  return (
                    <div key={evt.eventId} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                      <div 
                        onClick={() => setExpandedEventId(isExpanded ? null : evt.eventId)}
                        className="flex items-start justify-between gap-3 cursor-pointer"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl mt-0.5">
                            {getEventIcon(evt.eventType, evt.aggregateType)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800 dark:text-white">
                                {evt.eventType}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md font-mono">
                                {evt.aggregateType}#{evt.aggregateId}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              عامل: <span className="text-slate-700 dark:text-slate-200 font-medium">{evt.metadata?.userName || 'سیستم'}</span>
                              {' '}| شناسه رویداد: <span className="font-mono text-[11px]">{evt.eventId}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-slate-400 font-farsi">
                            {evt.occurredAt ? formatPersianDate(evt.occurredAt) : 'هم‌اکنون'}
                          </span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3.5 pt-3.5 border-t border-slate-100 dark:border-slate-700 text-xs space-y-2">
                          <div className="bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-[11px] overflow-x-auto text-left dir-ltr">
                            <pre>{JSON.stringify({ payload: evt.payload, metadata: evt.metadata }, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* SUB-TAB: DEAD LETTER QUEUE (Phase 14) */}
      {/* ========================================================================= */}
      {activeSubTab === 'dlq' && (
        <DeadLetterQueueSubTab />
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB: EVENT SOURCING & TIMELINE REPLAY (Phase 14) */}
      {/* ========================================================================= */}
      {activeSubTab === 'replay' && (
        <EventSourcingReplaySubTab />
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB: WEBHOOK SUBSCRIPTIONS & HMAC (Phase 14) */}
      {/* ========================================================================= */}
      {activeSubTab === 'webhooks' && (
        <WebhookManagementSubTab />
      )}
    </div>
  );
}

