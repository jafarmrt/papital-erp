import React, { useState, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import { 
  Zap, 
  Plus, 
  RefreshCw, 
  Search, 
  Filter, 
  Globe, 
  Bell, 
  Smartphone, 
  GitBranch, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Play, 
  Edit3, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Clock, 
  Activity, 
  Layers, 
  ArrowUpRight, 
  Code,
  FileText,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { formatPersianDate } from '../../utils';
import { fetchJson } from '../../api';
import { RuleEditorModal, RuleFormData } from './RuleEditorModal';

interface ActionRule {
  id: number;
  name: string;
  description: string;
  eventType: string;
  conditionsJson: any[];
  actionType: 'webhook' | 'in_app_notification' | 'workflow_trigger' | 'sms_simulation' | 'audit_log';
  actionConfigJson: any;
  isActive: number;
  executionCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ActionLog {
  id: number;
  ruleId: number;
  eventId: string;
  eventType: string;
  actionType: string;
  status: 'success' | 'failed' | 'condition_unmatched' | 'skipped';
  requestPayloadJson: any;
  responsePayloadJson: any;
  errorMessage?: string;
  durationMs: number;
  executedAt: string;
}

interface ActionStats {
  totalRules: number;
  activeRules: number;
  totalLogs: number;
  successLogs: number;
  failedLogs: number;
  unmatchedLogs: number;
  successRate: number;
  avgDurationMs: number;
}

export function AutoActionsSubTab() {
  const [rules, setRules] = useState<ActionRule[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [stats, setStats] = useState<ActionStats | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('ALL');
  
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<RuleFormData | null>(null);
  
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<'rules' | 'logs'>('rules');
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4500);
  };

  const fetchStats = async () => {
    try {
      const data = await fetchJson<{ success?: boolean; stats?: ActionStats }>('/events/action-rules/stats');
      if (data?.success && data.stats) {
        setStats(data.stats);
      }
    } catch {
      // Ignore background stats errors
    }
  };

  const fetchRules = async () => {
    try {
      setIsLoading(true);
      const data = await fetchJson<{ success?: boolean; data?: ActionRule[] }>('/events/action-rules');
      if (data?.success && Array.isArray(data.data)) {
        setRules(data.data);
      }
    } catch (err) {
      showNotification('خطا در دریافت لیست قوانین اکشن', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const data = await fetchJson<{ success?: boolean; logs?: ActionLog[] }>('/events/action-logs?limit=50');
      if (data?.success && Array.isArray(data.logs)) {
        setLogs(data.logs);
      }
    } catch {
      // Ignore silent background log errors
    }
  };

  const reloadAll = async () => {
    await Promise.all([fetchStats(), fetchRules(), fetchLogs()]);
  };

  useEffect(() => {
    reloadAll();
    let interval: ReturnType<typeof setInterval> | null = null;

    // V9 Phase 4.2: توقف polling وقتی تب مرورگر نامرئی است — جلوگیری از ترافیک بی‌مصرف هر ۱۲ ثانیه
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      if (!interval) {
        interval = setInterval(reloadAll, 12000);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
        // بروزرسانی فوری داده‌ها پس از بازگشت به تب
        reloadAll();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleToggleRule = async (id: number) => {
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>(`/events/action-rules/${id}/toggle`, {
        method: 'POST'
      });
      if (data?.success) {
        showNotification(data.message || 'وضعیت قانون به‌روز شد.');
        fetchRules();
        fetchStats();
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در تغییر وضعیت قانون', 'error');
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!(await confirmAction({ title: 'حذف قانون اکشن', message: 'آیا از حذف این قانون اکشن اطمینان دارید؟' }))) return;

    try {
      await fetchJson(`/events/action-rules/${id}`, {
        method: 'DELETE'
      });
      showNotification('قانون با موفقیت حذف گردید.');
      fetchRules();
      fetchStats();
    } catch (err) {
      showNotification(err?.message || 'خطا در حذف قانون', 'error');
    }
  };

  const handleTestRule = async (rule: ActionRule) => {
    try {
      const data = await fetchJson<{ success?: boolean; status?: string; durationMs?: number }>(`/events/action-rules/${rule.id}/test`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (data?.success) {
        showNotification(`تست قانون اجرا شد: وضعیت [${data.status}] (${data.durationMs}ms)`);
        fetchLogs();
        fetchStats();
      } else {
        showNotification('خطا در اجرای تست قانون', 'error');
      }
    } catch (err) {
      showNotification(err?.message || 'خطا در ارتباط با سرور', 'error');
    }
  };

  const handleSaveRule = async (formData: RuleFormData) => {
    const isEdit = !!formData.id;
    const url = isEdit ? `/events/action-rules/${formData.id}` : '/events/action-rules';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>(url, {
        method,
        body: JSON.stringify(formData)
      });

      showNotification(data?.message || 'قانون با موفقیت ذخیره گردید.');
      fetchRules();
      fetchStats();
    } catch (err) {
      showNotification(err?.message || 'خطا در ذخیره‌سازی قانون', 'error');
      throw err;
    }
  };

  const getActionBadge = (actionType: string) => {
    switch (actionType) {
      case 'webhook':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Globe className="w-3 h-3" />
            <span>وب‌هوک</span>
          </span>
        );
      case 'in_app_notification':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            <Bell className="w-3 h-3" />
            <span>اعلان سیستم</span>
          </span>
        );
      case 'sms_simulation':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Smartphone className="w-3 h-3" />
            <span>پیامک خودکار</span>
          </span>
        );
      case 'workflow_trigger':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <GitBranch className="w-3 h-3" />
            <span>تحریک گردش کار</span>
          </span>
        );
      case 'audit_log':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <ShieldCheck className="w-3 h-3" />
            <span>ممیزی ویژه</span>
          </span>
        );
    }
  };

  const filteredRules = rules.filter(r => {
    if (statusFilter === 'ACTIVE' && r.isActive !== 1) return false;
    if (statusFilter === 'INACTIVE' && r.isActive === 1) return false;
    if (actionTypeFilter !== 'ALL' && r.actionType !== actionTypeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.name?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.eventType?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      
      {/* Toast Notification */}
      {notification && (
        <div className={`p-4 rounded-2xl border text-xs font-medium flex items-center justify-between transition-all shadow-sm ${
          notification.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' 
            : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
            <span>{notification.text}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Rules */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">قوانین فعال / کل قوانین</span>
            <div className="text-xl font-bold text-slate-800 dark:text-white mt-1">
              <span className="text-indigo-600 dark:text-indigo-400">{(stats?.activeRules ?? 0).toLocaleString('fa-IR')}</span>
              <span className="text-xs text-slate-400 font-normal mr-1">از {(stats?.totalRules ?? 0).toLocaleString('fa-IR')}</span>
            </div>
          </div>
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        {/* Total Executions */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">مجموع اجراهای خودکار</span>
            <div className="text-xl font-bold text-slate-800 dark:text-white mt-1">
              {(stats?.totalLogs ?? 0).toLocaleString('fa-IR')} <span className="text-xs text-slate-400 font-normal">مرتبه</span>
            </div>
          </div>
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        {/* Success Rate */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">نرخ موفقیت عملیات</span>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {stats?.successRate !== undefined ? stats.successRate : 100}%
            </div>
          </div>
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        {/* Avg Latency */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">میانگین تأخیر پاسخ</span>
            <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
              {(stats?.avgDurationMs ?? 0).toLocaleString('fa-IR')} <span className="text-xs text-slate-400 font-normal">میلی‌ثانیه</span>
            </div>
          </div>
          <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Main Container */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        
        {/* Action Bar & Sub-Navigation */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl">
              <button
                onClick={() => setActiveView('rules')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeView === 'rules'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>قوانین فعال ({rules.length.toLocaleString('fa-IR')})</span>
              </button>

              <button
                onClick={() => setActiveView('logs')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeView === 'logs'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>لاگ‌های اجرا ({logs.length.toLocaleString('fa-IR')})</span>
              </button>
            </div>

            <button
              onClick={reloadAll}
              disabled={isLoading}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
              title="تازه‌سازی"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                setSelectedRule(null);
                setIsEditorOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>افزودن قانون اکشن جدید</span>
            </button>
          </div>

        </div>

        {/* VIEW 1: RULES LIST */}
        {activeView === 'rules' && (
          <div>
            {/* Filter Bar */}
            <div className="p-4 bg-slate-50/60 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو در نام قانون، رویداد یا توضیحات..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300"
                >
                  <option value="ALL">همه وضعیت‌ها</option>
                  <option value="ACTIVE">فقط فعال</option>
                  <option value="INACTIVE">فقط غیرفعال</option>
                </select>

                <select
                  value={actionTypeFilter}
                  onChange={(e) => setActionTypeFilter(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300"
                >
                  <option value="ALL">همه انواع اقدام</option>
                  <option value="webhook">وب‌هوک</option>
                  <option value="in_app_notification">اعلان سیستم</option>
                  <option value="sms_simulation">پیامک خودکار</option>
                  <option value="workflow_trigger">تحریک گردش کار</option>
                  <option value="audit_log">ممیزی ویژه</option>
                </select>
              </div>
            </div>

            {/* Rules Table / Cards */}
            {filteredRules.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                {isLoading ? 'در حال بارگذاری قوانین...' : 'هیچ قانونی با شرایط انتخابی یافت نشد.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {filteredRules.map((rule) => {
                  const conditionCount = Array.isArray(rule.conditionsJson) ? rule.conditionsJson.length : 0;
                  return (
                    <div key={rule.id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                      
                      {/* Left: Info */}
                      <div className="flex items-start gap-3.5">
                        <div className="mt-1">
                          <button
                            onClick={() => handleToggleRule(rule.id)}
                            className="text-slate-400 hover:text-indigo-600 transition-colors"
                            title={rule.isActive === 1 ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                          >
                            {rule.isActive === 1 ? (
                              <ToggleRight className="w-7 h-7 text-indigo-600" />
                            ) : (
                              <ToggleLeft className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                            )}
                          </button>
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-white">
                              {rule.name}
                            </span>
                            {getActionBadge(rule.actionType)}
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md">
                              {rule.eventType}
                            </span>
                          </div>

                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                            {rule.description || 'بدون توضیحات'}
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400 mt-2">
                            <span>
                              شروط: <span className="font-bold text-slate-600 dark:text-slate-300">{conditionCount === 0 ? 'بدون شرط (همه)' : `${conditionCount} شرط`}</span>
                            </span>
                            <span>•</span>
                            <span>
                              دفعات اجرا: <span className="font-bold text-slate-600 dark:text-slate-300">{(rule.executionCount || 0).toLocaleString('fa-IR')}</span>
                            </span>
                            <span>•</span>
                            <span>
                              آخرین اجرا: {rule.lastExecutedAt ? formatPersianDate(rule.lastExecutedAt) : 'هنوز اجرا نشده'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-end md:self-center">
                        <button
                          onClick={() => handleTestRule(rule)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-medium transition-colors"
                          title="تست آنلاین با رویداد پیش‌فرض"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>تست</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedRule(rule);
                            setIsEditorOpen(true);
                          }}
                          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                          title="ویرایش قانون"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors"
                          title="حذف قانون"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: EXECUTION LOGS */}
        {activeView === 'logs' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {logs.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                هنوز هیچ لاگ اجرایی برای اکشن‌های خودکار ثبت نشده است.
              </div>
            ) : (
              logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const isSuccess = log.status === 'success';
                return (
                  <div key={log.id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors">
                    
                    <div 
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="flex items-start justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-xl mt-0.5 ${
                          isSuccess 
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600' 
                            : log.status === 'condition_unmatched'
                              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600'
                              : 'bg-rose-50 dark:bg-rose-950/50 text-rose-600'
                        }`}>
                          {isSuccess ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-white">
                              قانون #{log.ruleId} ➔ {log.eventType}
                            </span>
                            {getActionBadge(log.actionType)}
                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                              isSuccess 
                                ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' 
                                : log.status === 'condition_unmatched'
                                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                  : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                            }`}>
                              {log.status === 'success' ? 'موفق' : log.status === 'condition_unmatched' ? 'شرط عدم تطابق' : 'خطا'}
                            </span>
                          </div>

                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            شناسه رویداد: <span className="font-mono text-[11px]">{log.eventId}</span>
                            {' '}| مدت اجرا: <span className="font-bold">{log.durationMs}ms</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400 font-farsi">
                          {log.executedAt ? formatPersianDate(log.executedAt) : 'هم‌اکنون'}
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3.5 pt-3.5 border-t border-slate-100 dark:border-slate-700 text-xs space-y-2">
                        {log.errorMessage && (
                          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-rose-700 dark:text-rose-300 text-xs">
                            <span className="font-bold">خطای اجرا:</span> {log.errorMessage}
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                          <div>
                            <span className="text-slate-500 font-sans text-xs font-bold block mb-1">داده‌های ارسالی رویداد:</span>
                            <div className="bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto text-left dir-ltr">
                              <pre>{JSON.stringify(log.requestPayloadJson, null, 2)}</pre>
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500 font-sans text-xs font-bold block mb-1">پاسخ / خروجی اقدام:</span>
                            <div className="bg-slate-900 text-slate-100 p-3 rounded-xl overflow-x-auto text-left dir-ltr">
                              <pre>{JSON.stringify(log.responsePayloadJson, null, 2)}</pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                );
              })
            )}
          </div>
        )}

      </div>

      {/* Modal */}
      <RuleEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveRule}
        initialRule={selectedRule}
      />

    </div>
  );
}
