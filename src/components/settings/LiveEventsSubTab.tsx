import { useState } from 'react';
import { RefreshCw, Search, Filter, Activity, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { LIVE_EVENT_BUFFER_SIZE } from '../../lib/events/liveEventBuffer';
import { formatPersianDate, formatPersianNumber, formatPersianCode, toPersianDigits } from '../../utils';
import { eventAggregateLabel, eventTypeLabel } from '../../lib/events/eventTypeCatalog';
import { DOMAIN_EVENTS_REFRESH_MS, useDomainEventsQuery } from '../../hooks/queries/useEventQueries';
import { useOpeningRead } from '../../hooks/queries/readOnEveryOpening';
import { EventSimulationPanel } from './EventSimulationPanel';
import {
  EventIcon, FILTER_SELECT_CLASS, KPI_CARD_CLASS, LIST_NOTE_CLASS, READ_FAILED_CLASS, SEARCH_INPUT_CLASS, TOOLBAR_CLASS, countOf, readFailure,
} from './eventMonitorShared';

const KPI_NOTE_CLASS = 'text-[11px] text-slate-500 mt-1';

/**
 * The live domain events bus. 10.3 package 6 (package-2 leftover): its list and counts are this opening's read only
 * (`useOpeningRead`); coming back to the tab says «در حال خواندن» until the server answers, never the events of the
 * previous visit for a moment.
 */
export function LiveEventsSubTab({ canManage }: { canManage: boolean }) {
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const eventsQuery = useDomainEventsQuery(selectedFilter);
  const eventsRead = useOpeningRead(eventsQuery, true);
  const events = Array.isArray(eventsRead.data?.events) ? eventsRead.data.events : [];
  const stats = eventsRead.data?.stats || null;
  const eventsError = readFailure(eventsRead.error, 'رویدادهای زنده خوانده نشد.');
  // the refresh button waits for this visit's first answer, not for every ten-second poll
  const reading = !eventsRead.data && eventsQuery.isFetching;

  const q = searchQuery.toLowerCase();
  const filteredEvents = !searchQuery ? events : events.filter(e => (
    (e.eventType || '').toLowerCase().includes(q) ||
    eventTypeLabel(e.eventType || '').includes(q) ||
    eventAggregateLabel(e.aggregateType).includes(q) ||
    (e.aggregateType || '').toLowerCase().includes(q) ||
    String(e.aggregateId || '').toLowerCase().includes(q) ||
    (e.metadata?.userName || '').toLowerCase().includes(q) ||
    JSON.stringify(e.payload || {}).toLowerCase().includes(q)
  ));

  return (
    <div className="space-y-6">
      {eventsError && <div role="alert" className={READ_FAILED_CLASS}>{eventsError}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className={KPI_CARD_CLASS}>
          <div className="text-xs text-slate-500 dark:text-slate-400">مجموع رویدادهای منتشرشده</div>
          <div className="text-xl font-bold text-slate-800 dark:text-white mt-1">{countOf(!!stats, stats?.totalEmitted || 0)}</div>
          <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span>گذرگاه فعال لحظه‌ای</span>
          </div>
        </div>
        <div className={KPI_CARD_CLASS}>
          <div className="text-xs text-slate-500 dark:text-slate-400">گردش موجودی و انبار</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {countOf(!!stats, (stats?.eventCounts?.['StockReceived'] || 0) + (stats?.eventCounts?.['StockIssued'] || 0))}
          </div>
          <div className={KPI_NOTE_CLASS}>ورود و خروج فیزیکی کالا</div>
        </div>
        <div className={KPI_CARD_CLASS}>
          <div className="text-xs text-slate-500 dark:text-slate-400">تغییرات فرایند و گردش کار</div>
          <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{countOf(!!stats, stats?.eventCounts?.['WorkflowTransitioned'] || 0)}</div>
          <div className={KPI_NOTE_CLASS}>پیشروی و امضای اسناد</div>
        </div>
        <div className={KPI_CARD_CLASS}>
          <div className="text-xs text-slate-500 dark:text-slate-400">رویدادهای مالی و اسناد</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {countOf(!!stats, (stats?.eventCounts?.['InvoiceApproved'] || 0) + (stats?.eventCounts?.['TreasuryTransactionApproved'] || 0))}
          </div>
          <div className={KPI_NOTE_CLASS}>فاکتورها و خزانه‌داری</div>
        </div>
      </div>

      <div className={TOOLBAR_CLASS}>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={selectedFilter} onChange={(e) => setSelectedFilter(e.target.value)} className={FILTER_SELECT_CLASS}>
              <option value="ALL">همه انواع رویدادها</option>
              <option value="WorkflowTransitioned">تغییر وضعیت گردش کار</option>
              <option value="StockReceived">ورود کالا به انبار</option>
              <option value="StockIssued">خروج کالا از انبار</option>
              <option value="InvoiceApproved">تأیید فاکتور فروش</option>
              <option value="PurchaseApproved">تأیید فاکتور خرید</option>
              <option value="TreasuryTransactionApproved">تراکنش خزانه‌داری و مالی</option>
              <option value="SimulatedTestEvent">رویدادهای آزمایشی و پایش</option>
            </select>
          </div>

          <button
            onClick={() => void eventsQuery.refetch()}
            disabled={reading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reading ? 'animate-spin' : ''}`} />
            <span>به‌روزرسانی</span>
          </button>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="جست‌وجو در شناسه، کاربر یا محتوا…"
            className={SEARCH_INPUT_CLASS}
          />
        </div>
      </div>

      {/* v9.0.430 (TD-708): a simulation with no effect replaces «انتشار رویداد آزمایشی» */}
      {canManage && <EventSimulationPanel />}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
            فهرست آخرین رویدادهای زنده سامانه ({eventsRead.data ? formatPersianNumber(filteredEvents.length) : '—'} مورد)
          </span>
          <span className="text-[11px] text-slate-400">
            گذرگاه زنده فقط {formatPersianNumber(LIVE_EVENT_BUFFER_SIZE)} رویداد آخر را نگه می‌دارد؛ همه رویدادهای ثبت‌شده در «صف ارسال رویداد» صفحه‌به‌صفحه دیده می‌شوند.
          </span>
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>به‌روزرسانی خودکار هر {toPersianDigits(DOMAIN_EVENTS_REFRESH_MS / 1000)} ثانیه</span>
          </span>
        </div>

        {filteredEvents.length === 0 ? (!eventsError && (
          <div className={LIST_NOTE_CLASS}>
            {eventsRead.data ? 'هیچ رویدادی با پالایش انتخابی یافت نشد.' : 'در حال خواندن رویدادهای زنده…'}
          </div>
        )) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {filteredEvents.map((evt) => {
              const isExpanded = expandedEventId === evt.eventId;
              return (
                <div key={evt.eventId} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                  <div onClick={() => setExpandedEventId(isExpanded ? null : evt.eventId)} className="flex items-start justify-between gap-3 cursor-pointer">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl mt-0.5">
                        <EventIcon type={evt.eventType} aggregate={evt.aggregateType} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800 dark:text-white" title={evt.eventType}>
                            {eventTypeLabel(evt.eventType)}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md">
                            {eventAggregateLabel(evt.aggregateType)} #{formatPersianCode(evt.aggregateId)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          عامل: <span className="text-slate-700 dark:text-slate-200 font-medium">{evt.metadata?.userName || 'سامانه'}</span>
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
  );
}
