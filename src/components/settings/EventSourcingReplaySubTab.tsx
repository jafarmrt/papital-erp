import React, { useState, useEffect } from 'react';
import {
  History,
  Play,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Package,
  Users,
  Landmark,
  Layers,
  GitBranch,
  ArrowDown,
  Clock,
  Code,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap
} from 'lucide-react';
import { formatPersianDate } from '../../utils';
import { fetchJson } from '../../api';

interface AggregateTypeOption {
  type: string;
  title: string;
  description: string;
  icon: string;
}

interface TimelineItem {
  id: string | number;
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: 'outbox' | 'dlq' | 'audit_log' | 'workflow';
  actor: string;
  title: string;
  description: string;
  status: string;
  payload: any;
  metadata: any;
  changes?: any;
}

export function EventSourcingReplaySubTab() {
  const [types, setTypes] = useState<AggregateTypeOption[]>([]);
  const [selectedType, setSelectedType] = useState<string>('document');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [aggregateOptions, setAggregateOptions] = useState<{ id: string; title: string }[]>([]);
  const [selectedAggregateId, setSelectedAggregateId] = useState<string>('');
  
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | number | null>(null);

  // Simulation & Replay Modal state
  const [selectedEventForReplay, setSelectedEventForReplay] = useState<TimelineItem | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchTypes = async () => {
    try {
      const data = await fetchJson<{ success?: boolean; types?: AggregateTypeOption[] }>('/events/event-sourcing/types');
      if (data?.success && Array.isArray(data.types)) {
        setTypes(data.types);
      }
    } catch (err) {
      console.error('Error fetching aggregate types:', err);
    }
  };

  const searchAggregates = async (type: string, keyword: string = '') => {
    if (!type) return;
    try {
      const params = new URLSearchParams({ type, aggregateType: type, search: keyword, limit: '25' });
      const data = await fetchJson<{ success?: boolean; data?: { id: string; title: string }[] }>(`/events/event-sourcing/aggregates?${params.toString()}`);
      if (data?.success) {
        const list = Array.isArray(data.data) ? data.data : [];
        setAggregateOptions(list);
        if (list.length > 0 && !selectedAggregateId) {
          setSelectedAggregateId(list[0].id);
        }
      }
    } catch (err) {
      console.error('Error searching aggregates:', err);
    }
  };

  const fetchTimeline = async (type: string, aggId: string) => {
    if (!type || !aggId) return;
    setIsLoadingTimeline(true);
    setTimeline([]);
    try {
      const params = new URLSearchParams({ type, aggregateType: type, id: aggId, aggregateId: aggId });
      const data = await fetchJson<{ success?: boolean; timeline?: TimelineItem[]; message?: string }>(`/events/event-sourcing/timeline?${params.toString()}`);
      if (data?.success) {
        setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
      } else {
        showToast(data?.message || 'خطا در بارگذاری خط زمان رویدادها', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در بارگذاری خط زمان', 'error');
    } finally {
      setIsLoadingTimeline(false);
    }
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  useEffect(() => {
    searchAggregates(selectedType, searchKeyword);
  }, [selectedType]);

  useEffect(() => {
    if (selectedAggregateId) {
      fetchTimeline(selectedType, selectedAggregateId);
    }
  }, [selectedType, selectedAggregateId]);

  const handleSimulateOrReplay = async (item: TimelineItem, dryRun: boolean) => {
    setIsSimulating(true);
    setSimulationResult(null);
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>('/events/event-sourcing/simulate-replay', {
        method: 'POST',
        body: JSON.stringify({
          eventId: item.eventId,
          eventType: item.eventType,
          aggregateType: selectedType,
          aggregateId: selectedAggregateId,
          payload: item.payload,
          dryRun
        })
      });
      if (data?.success) {
        setSimulationResult(data);
        showToast(data.message || 'عملیات با موفقیت انجام شد.', 'success');
        if (!dryRun) {
          fetchTimeline(selectedType, selectedAggregateId);
        }
      } else {
        showToast(data?.message || 'خطا در اجرای بازپخش', 'error');
      }
    } catch (err) {
      showToast('خطای سرور در بازپخش رویداد', 'error');
    } finally {
      setIsSimulating(false);
    }
  };

  const getAggregateIcon = (type: string) => {
    switch (type) {
      case 'document':
        return <FileText className="w-4 h-4" />;
      case 'customer':
        return <Users className="w-4 h-4" />;
      case 'item':
        return <Package className="w-4 h-4" />;
      case 'treasury':
        return <Landmark className="w-4 h-4" />;
      case 'project':
        return <Layers className="w-4 h-4" />;
      case 'workflow':
        return <GitBranch className="w-4 h-4" />;
      default:
        return <History className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6" id="event-sourcing-replay-tab">
      {/* Toast */}
      {toast && (
        <div
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

      {/* Top Banner / Explanation */}
      <div className="bg-gradient-to-r from-indigo-900/20 via-slate-900/30 to-purple-900/20 border border-indigo-200 dark:border-indigo-800/40 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-md">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>کاوشگر خط زمان و بازپخش تاریخچه رویدادها (Event Sourcing & Time-Travel)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-mono">
                Phase 14
              </span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
              بازسازی سیر تکامل هر موجودیت از اولین لحظه ایجاد تا کنون، بررسی جامع رخدادهای زنجیره‌ای Outbox و Audit، و امکان شبیه‌سازی بازپخش زمان‌بندی‌شده (Dry-Run).
            </p>
          </div>
        </div>
      </div>

      {/* Aggregate Selectors */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {types.map(t => (
            <button
              key={t.type}
              onClick={() => {
                setSelectedType(t.type);
                setSelectedAggregateId('');
              }}
              className={`p-3 rounded-xl text-right transition-all border flex flex-col justify-between gap-1.5 ${
                selectedType === t.type
                  ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 shadow-sm'
                  : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">{t.title.split(' ')[0]}</span>
                {getAggregateIcon(t.type)}
              </div>
              <span className="text-[10px] text-slate-400 line-clamp-1">{t.description}</span>
            </button>
          ))}
        </div>

        {/* Search and Specific Instance Dropdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">جستجوی موجودیت مورد نظر:</label>
            <div className="relative">
              <input
                type="text"
                placeholder="جستجو با کد یا عنوان (مثال: فاکتور، کالا، مشتری)..."
                value={searchKeyword}
                onChange={e => {
                  setSearchKeyword(e.target.value);
                  searchAggregates(selectedType, e.target.value);
                }}
                className="w-full text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl pr-9 pl-4 py-2.5 text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">انتخاب نمونه موجودیت (Aggregate Instance):</label>
            <select
              value={selectedAggregateId}
              onChange={e => setSelectedAggregateId(e.target.value)}
              className="w-full text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-4 py-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- یک نمونه را انتخاب نمایید --</option>
              {aggregateOptions.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Chronological Timeline Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-500" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              خط زمان رویدادها (Event Stream Timeline) - {selectedType} #{selectedAggregateId || '...'}
            </h4>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {timeline.length.toLocaleString('fa-IR')} رخداد ثبت‌شده
          </span>
        </div>

        {isLoadingTimeline ? (
          <div className="p-12 text-center text-slate-400">
            <RotateCcw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
            در حال بازخوانی خط زمان رویدادهای موجودیت...
          </div>
        ) : !selectedAggregateId ? (
          <div className="p-12 text-center text-slate-400">
            لطفاً از کادر بالا یک موجودیت را انتخاب کنید تا تاریخچه رویدادهای آن بارگذاری شود.
          </div>
        ) : timeline.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            هیچ رویدادی برای این موجودیت در گذرگاه ثبت نشده است.
          </div>
        ) : (
          <div className="relative pl-4 pr-6 space-y-6 before:absolute before:right-[23px] before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
            {timeline.map((item, idx) => {
              const isExpanded = expandedTimelineId === item.id;
              const isOutbox = item.source === 'outbox';
              const isDlq = item.source === 'dlq';

              return (
                <div key={item.id} className="relative flex items-start gap-4 group">
                  {/* Timeline Icon Node */}
                  <div
                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 shadow-md ${
                      isDlq
                        ? 'bg-rose-600 ring-4 ring-rose-100 dark:ring-rose-950/60'
                        : isOutbox
                        ? 'bg-indigo-600 ring-4 ring-indigo-100 dark:ring-indigo-950/60'
                        : 'bg-emerald-600 ring-4 ring-emerald-100 dark:ring-emerald-950/60'
                    }`}
                  >
                    {isDlq ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : isOutbox ? (
                      <Zap className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                  </div>

                  {/* Card Body */}
                  <div className="flex-1 bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 transition-all hover:shadow-md">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{item.title}</span>
                        <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">
                          {item.eventType}
                        </span>
                        <span className="text-[10px] text-slate-400">توسط: {item.actor}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatPersianDate(item.occurredAt)}
                        </span>

                        <button
                          onClick={() => {
                            setSelectedEventForReplay(item);
                            setSimulationResult(null);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all flex items-center gap-1"
                          title="شبیه‌سازی و بازپخش رویداد"
                        >
                          <Play className="w-3 h-3" />
                          <span>بازپخش</span>
                        </button>

                        <button
                          onClick={() => setExpandedTimelineId(isExpanded ? null : item.id)}
                          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 font-medium">
                      {item.description}
                    </p>

                    {/* Collapsible Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-700/60 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                              داده‌های رویداد (Payload):
                            </span>
                            <pre className="text-[11px] font-mono bg-slate-950 text-slate-100 p-2.5 rounded-xl overflow-x-auto max-h-40 dir-ltr text-left">
                              {JSON.stringify(item.payload, null, 2)}
                            </pre>
                          </div>

                          <div>
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                              فراداده‌ها (Metadata & Context):
                            </span>
                            <pre className="text-[11px] font-mono bg-slate-950 text-emerald-400 p-2.5 rounded-xl overflow-x-auto max-h-40 dir-ltr text-left">
                              {JSON.stringify(item.metadata, null, 2)}
                            </pre>
                          </div>
                        </div>

                        {item.changes && (
                          <div className="p-2.5 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                            <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 block mb-1">
                              تغییرات ثبت‌شده ممیزی:
                            </span>
                            <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 dir-ltr text-left">
                              {JSON.stringify(item.changes, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Simulation / Replay Modal */}
      {selectedEventForReplay && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Play className="w-4 h-4 text-indigo-500" />
                  موتور بازپخش و شبیه‌سازی رویداد (Time-Travel Replay)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  رویداد <span className="font-mono text-indigo-400">{selectedEventForReplay.eventType}</span> برای {selectedType}#{selectedAggregateId}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedEventForReplay(null);
                  setSimulationResult(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* Simulation Report */}
            {simulationResult ? (
              <div className="space-y-3">
                <div
                  className={`p-4 rounded-2xl border text-xs leading-relaxed ${
                    simulationResult.dryRun
                      ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <Sparkles className="w-4 h-4" />
                    <span>{simulationResult.message}</span>
                  </div>
                  <div>کل قوانین اکشن ارزیابی‌شده: {simulationResult.evaluatedRulesCount} قانون</div>
                  <div>قوانین منطبق‌شده جهت اجرا: {simulationResult.matchedRulesCount} قانون</div>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {simulationResult.rulesBreakdown?.map((rb: any, index: number) => (
                    <div
                      key={index}
                      className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{rb.ruleName}</span>
                          <span className="text-[10px] font-mono text-slate-400">[{rb.actionType}]</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{rb.simulatedOutcome}</p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          rb.matched
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {rb.matched ? 'منطبق شد' : 'رد شد'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-1">توضیحات عملکرد:</span>
                  <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-slate-400 text-[11px]">
                    <li>
                      <strong>شبیه‌سازی خشک (Dry-Run):</strong> بدون تغییر پایگاه‌داده، ارزیابی می‌کند که کدام قوانین اکشن خودکار فعال می‌شدند.
                    </li>
                    <li>
                      <strong>بازپخش زنده (Live Replay):</strong> رویداد را واقعاً در گذرگاه دامنه‌ای منتشر می‌کند و اکشن‌های فعال آن اجرا خواهند شد.
                    </li>
                  </ul>
                </div>

                <div>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">پیش‌نمایش داده‌های رویداد:</span>
                  <pre className="text-[11px] font-mono bg-slate-950 text-slate-100 p-3 rounded-xl overflow-x-auto max-h-40 dir-ltr text-left">
                    {JSON.stringify(selectedEventForReplay.payload, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setSelectedEventForReplay(null);
                  setSimulationResult(null);
                }}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                بستن
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSimulateOrReplay(selectedEventForReplay, true)}
                  disabled={isSimulating}
                  className="px-4 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-sm transition-all flex items-center gap-1.5"
                >
                  <ShieldCheck className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
                  <span>شبیه‌سازی آزمایشی (Dry-Run)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSimulateOrReplay(selectedEventForReplay, false)}
                  disabled={isSimulating}
                  className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all flex items-center gap-1.5"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
                  <span>بازپخش زنده رویداد</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
