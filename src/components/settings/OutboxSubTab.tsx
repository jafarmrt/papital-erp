import { useState, type ReactNode } from 'react';
import { RefreshCw, Search, Filter, CheckCircle2, ChevronDown, ChevronUp, Clock, AlertTriangle, Play, RotateCcw } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { ListPager } from '../common/ListPager';
import { PillBadge, type PillBadgeVariants } from '../common/PillBadge';
import { formatPersianDate, errorMessageOf, formatPersianNumber, formatPersianCode, toPersianDigits } from '../../utils';
import { eventAggregateLabel, eventTypeLabel } from '../../lib/events/eventTypeCatalog';
import { OUTBOX_MAX_ATTEMPTS } from '../../lib/events/outboxAttempts';
import {
  EVENT_LIST_PAGE_SIZE,
  useOutboxStatsQuery,
  useOutboxEventsQuery,
  useProcessOutboxMutation,
  useRetryFailedOutboxMutation,
  useRetrySingleOutboxEventMutation,
} from '../../hooks/queries/useEventQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import {
  EventIcon, FILTER_SELECT_CLASS, KPI_CARD_CLASS, LIST_NOTE_CLASS, READ_FAILED_CLASS, SEARCH_INPUT_CLASS, TOOLBAR_CLASS, countOf, readFailure,
  type EventNotice,
} from './eventMonitorShared';

// v7.0.86 (TD-108): نشان وضعیت رویداد صندوق خروجی
const OUTBOX_BADGE_BASE = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border';
const OUTBOX_STATUS_BADGES: PillBadgeVariants = {
  completed: { label: 'پردازش‌شده', icon: CheckCircle2, iconClassName: 'w-3 h-3', className: `${OUTBOX_BADGE_BASE} bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800` },
  pending: { label: 'در صف انتظار', icon: Clock, iconClassName: 'w-3 h-3', className: `${OUTBOX_BADGE_BASE} bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800` },
  processing: { label: 'در حال پردازش', icon: RefreshCw, iconClassName: 'w-3 h-3 animate-spin', className: `${OUTBOX_BADGE_BASE} bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 animate-pulse` },
  failed: { label: 'ناموفق', icon: AlertTriangle, iconClassName: 'w-3 h-3', className: `${OUTBOX_BADGE_BASE} bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800` },
};

function KpiCard({ label, value, valueClass, children }: { label: string; value: string; valueClass: string; children: ReactNode }) {
  return (
    <div className={KPI_CARD_CLASS}>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueClass}`}>{value}</div>
      {children}
    </div>
  );
}

/**
 * The transactional outbox monitor. 10.3 package 6 (package-2 leftover): its stats and its page are this opening's
 * reads only (`useOpeningRead`); coming back to the tab shows «—» and «در حال خواندن» until the server answers, never
 * the counts and rows of the previous visit for a moment. Each visit mounts the tab again, so each is an opening.
 */
export function OutboxSubTab({ canManage, onNotice }: { canManage: boolean; onNotice: (notice: EventNotice) => void }) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // OBS-R2-86 (TD-1323): the outbox is read one page at a time and searched on the server
  const [page, setPage] = useState(1);
  const search = useDebounce(searchQuery.trim());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const statsQuery = useOutboxStatsQuery();
  const statsRead = useOpeningRead(statsQuery, true);
  const stats = statsRead.data ?? null;
  const pageQuery = useOutboxEventsQuery(statusFilter, { page, search });
  const pageRead = useOpeningRead(pageQuery, true);
  const rows = Array.isArray(pageRead.data?.events) ? pageRead.data.events : [];
  // while another page of the same list reads, the pager keeps this visit's last total (never «از ۰ مورد»)
  const listKey = `${statusFilter}\u0000${search}`;
  const [lastTotal, setLastTotal] = useState({ key: listKey, total: 0 });
  const readTotal = pageRead.data?.total;
  if (readTotal !== undefined && (lastTotal.key !== listKey || lastTotal.total !== readTotal)) setLastTotal({ key: listKey, total: readTotal });
  const total = readTotal ?? (lastTotal.key === listKey ? lastTotal.total : 0);
  const statsError = readFailure(statsRead.error, 'آمار صف ارسال رویداد خوانده نشد.');
  const listError = readFailure(pageRead.error, 'فهرست صف ارسال رویداد بارگذاری نشد.');
  // the refresh button waits for this visit's first answers, not for every ten-second poll
  const reading = (!statsRead.data && statsQuery.isFetching) || (!pageRead.data && pageQuery.isFetching);

  const processOutboxMutation = useProcessOutboxMutation();
  const retryFailedMutation = useRetryFailedOutboxMutation();
  const retrySingleMutation = useRetrySingleOutboxEventMutation();
  const [retryingEventId, setRetryingEventId] = useState<string | null>(null);
  const showNotice = (text: string, type: EventNotice['type'] = 'success') => onNotice({ text, type });

  const handleProcessNow = async () => {
    try {
      const res = await processOutboxMutation.mutateAsync();
      showNotice(res?.message || 'پردازش دسته با موفقیت انجام شد.');
    } catch (err) {
      showNotice(errorMessageOf(err) || 'پردازش صف ارسال رویداد انجام نشد.', 'error');
    }
  };

  const handleRetryAllFailed = async () => {
    try {
      const res = await retryFailedMutation.mutateAsync();
      showNotice(res?.message || 'رویدادهای ناموفق برای ارسال مجدد آماده شدند.');
    } catch (err) {
      showNotice(errorMessageOf(err) || 'خطا در تلاش مجدد رویدادهای ناموفق', 'error');
    }
  };

  const handleRetrySingle = async (eventId: string) => {
    try {
      setRetryingEventId(eventId);
      const res = await retrySingleMutation.mutateAsync(eventId);
      showNotice(res?.message || `رویداد ${eventId} بازنشانی شد.`);
    } catch (err) {
      showNotice(errorMessageOf(err) || 'خطا در تلاش مجدد', 'error');
    } finally {
      setRetryingEventId(null);
    }
  };

  return (
    <div className="space-y-6">
      {statsError && <div role="alert" className={READ_FAILED_CLASS}>{statsError}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <KpiCard label="کل رویدادهای صف ارسال" value={countOf(!!stats, stats?.total || 0)} valueClass="text-slate-800 dark:text-white">
          {/* v9.0.441 (TD-733): a stopped background processor is shown as stopped, never with the green pulse */}
          {stats && (
            <div className={`text-[11px] mt-1 flex items-center gap-1 ${stats.workerRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              <span className={`w-2 h-2 rounded-full ${stats.workerRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              <span>{stats.workerRunning ? 'پردازشگر پس‌زمینه فعال است' : 'پردازشگر پس‌زمینه متوقف است'}</span>
            </div>
          )}
        </KpiCard>
        <KpiCard label="در صف ارسال / پردازش" value={countOf(!!stats, (stats?.pending || 0) + (stats?.processing || 0))} valueClass="text-amber-600 dark:text-amber-400">
          <div className="text-[11px] text-slate-500 mt-1">تراکنش‌های آماده ارسال</div>
        </KpiCard>
        <KpiCard label="پردازش موفق و تحویل‌شده" value={countOf(!!stats, stats?.completed || 0)} valueClass="text-emerald-600 dark:text-emerald-400">
          <div className="text-[11px] text-slate-500 mt-1">تحویل به مشترکان سامانه</div>
        </KpiCard>
        <KpiCard label="ناموفق، با تلاش دوباره" value={countOf(!!stats, stats?.failed || 0)} valueClass="text-rose-600 dark:text-rose-400">
          <div className="text-[11px] text-slate-500 mt-1">قابلیت ارسال مجدد خودکار</div>
        </KpiCard>
      </div>

      <div className={TOOLBAR_CLASS}>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={FILTER_SELECT_CLASS}>
              <option value="ALL">همه وضعیت‌ها</option>
              <option value="pending">در صف انتظار پردازش</option>
              <option value="processing">در حال ارسال و پردازش</option>
              <option value="completed">با موفقیت پردازش‌شده</option>
              <option value="failed">ناموفق (خطا در پردازش)</option>
            </select>
          </div>

          <button
            onClick={() => { void statsQuery.refetch(); void pageQuery.refetch(); }}
            disabled={reading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reading ? 'animate-spin' : ''}`} />
            <span>تازه‌سازی</span>
          </button>

          {canManage && (
            <button
              onClick={handleProcessNow}
              disabled={processOutboxMutation.isPending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${processOutboxMutation.isPending ? 'animate-spin' : ''}`} />
              <span>{processOutboxMutation.isPending ? 'در حال اجرا…' : 'پردازش دستی دسته'}</span>
            </button>
          )}

          {canManage && (stats?.failed || 0) > 0 && (
            <button
              onClick={handleRetryAllFailed}
              disabled={retryFailedMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 transition-all disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${retryFailedMutation.isPending ? 'animate-spin' : ''}`} />
              <span>تلاش مجدد تمام خطاهای ارسال ({formatPersianNumber(stats?.failed ?? 0)})</span>
            </button>
          )}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="جست‌وجو در شناسه رویداد، نوع یا خطا…"
            className={SEARCH_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            رویدادهای ذخیره‌شده در صف ارسال ({pageRead.data ? formatPersianNumber(total) : '—'} مورد)
          </span>
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>پایش دوره‌ای هر ۳ ثانیه با پردازشگر پس‌زمینه</span>
          </span>
        </div>

        {listError && <div role="alert" className={`m-4 ${READ_FAILED_CLASS}`}>{listError}</div>}
        {rows.length === 0 ? (!listError && (
          <div className={LIST_NOTE_CLASS}>
            {pageRead.data ? 'هیچ رویدادی با پالایش انتخابی در صف ارسال یافت نشد.' : 'در حال خواندن صف ارسال رویداد…'}
          </div>
        )) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {rows.map((evt) => {
              const isExpanded = expandedId === evt.id;
              return (
                <div key={evt.id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                  <div onClick={() => setExpandedId(isExpanded ? null : evt.id)} className="flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl mt-0.5">
                        <EventIcon type={evt.eventType} aggregate={evt.aggregateType} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-800 dark:text-white" title={evt.eventType}>
                            {eventTypeLabel(evt.eventType)}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md">
                            {eventAggregateLabel(evt.aggregateType)} #{formatPersianCode(evt.aggregateId)}
                          </span>
                          <PillBadge variants={OUTBOX_STATUS_BADGES} value={evt.status} />
                          {evt.retryCount > 0 && (
                            <span className="text-[10px] px-2 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 rounded-md font-bold">
                              تلاش {formatPersianNumber(evt.retryCount ?? 0)} از {formatPersianNumber(OUTBOX_MAX_ATTEMPTS)}
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
                      {canManage && evt.status === 'failed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleRetrySingle(evt.eventId); }}
                          disabled={retryingEventId === evt.eventId}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 rounded-lg transition-all"
                        >
                          {retryingEventId === evt.eventId ? 'در حال ارسال…' : 'تلاش مجدد'}
                        </button>
                      )}
                      <div className="text-left dir-ltr text-[11px] text-slate-400">
                        <div>ثبت: {evt.occurredAt ? formatPersianDate(evt.occurredAt) : '-'}</div>
                        {evt.processedAt && (
                          <div className="text-emerald-600 dark:text-emerald-400">پردازش: {formatPersianDate(evt.processedAt)}</div>
                        )}
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3.5 pt-3.5 border-t border-slate-100 dark:border-slate-700 text-xs space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300 mb-2">
                        <div><span className="font-bold">شناسه ردیف در پایگاه‌داده:</span> #{toPersianDigits(evt.id)}</div>
                        <div>
                          <span className="font-bold">زمان تلاش بعدی:</span>{' '}
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
      <ListPager page={page} totalPages={Math.max(1, Math.ceil(total / EVENT_LIST_PAGE_SIZE))} total={total}
        limit={EVENT_LIST_PAGE_SIZE} onPage={setPage} disabled={pageQuery.isFetching} />
    </div>
  );
}
