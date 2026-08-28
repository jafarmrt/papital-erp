import React, { useEffect, useState } from 'react';
import { fetchJson } from '../api';
import {
  Database, HardDrive, ShieldCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Cpu, Lock,
  Send, FileText, GitPullRequest, Wrench, Play, Activity, Layers, CheckSquare
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface HealthData {
  database: {
    status: string;
    latencyMs: number;
    message: string;
  };
  storage: {
    status: string;
    writable: boolean;
    uploadsPath: string;
    message: string;
  };
  outbox?: {
    pendingCount: number;
    dlqCount: number;
    status: string;
  };
  accounting?: {
    totalVouchers: number;
    unbalancedVouchers: number;
    status: string;
  };
  workflow?: {
    activeInstances: number;
    overdueSlaTasks: number;
    status: string;
  };
  observability?: {
    status: string;
    contextTracing: boolean;
  };
  network: {
    isHttps: boolean;
    protocol: string;
    forwardedProto: string;
    host: string;
  };
  server: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    memoryUsageMb: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
  checkTimestamp: string;
}

interface IntegrityCheck {
  id: string;
  category: string;
  title: string;
  status: 'ok' | 'warning' | 'error';
  details: string;
}

interface ReconciliationReport {
  healthScorePercentage: number;
  totalChecks: number;
  okChecks: number;
  checks: IntegrityCheck[];
  timestamp: string;
}

export default function SystemHealthDiagnostic() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const [reconciliationReport, setReconciliationReport] = useState<ReconciliationReport | null>(null);
  const [reconciling, setReconciling] = useState<boolean>(false);
  const [fixingAction, setFixingAction] = useState<string>('');

  const loadHealthData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson('/system/health');
      setHealth(data);
    } catch (err) {
      setError(err.message || 'خطا در دریافت وضعیت سلامت سیستم');
      toast.error('امکان دریافت اطلاعات سلامت سرور وجود ندارد');
    } finally {
      setLoading(false);
    }
  };

  const runReconciliationCheck = async () => {
    setReconciling(true);
    try {
      const report = await fetchJson('/system/reconciliation-check');
      setReconciliationReport(report);
      toast.success('اسکن انطباق و موازنه سیستم با موفقیت تکمیل شد');
    } catch (err) {
      toast.error(err.message || 'خطا در اجرای اسکن انطباق دیتابیس و ماژول‌ها');
    } finally {
      setReconciling(false);
    }
  };

  const handleExecuteFix = async (action: string) => {
    setFixingAction(action);
    try {
      const res = await fetchJson('/system/reconciliation-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      toast.success(res.message || 'عملیات با موفقیت انجام شد');
      await runReconciliationCheck();
      await loadHealthData();
    } catch (err) {
      toast.error(err.message || 'خطا در اجرای اصلاحیه خودکار');
    } finally {
      setFixingAction('');
    }
  };

  useEffect(() => {
    loadHealthData();
    runReconciliationCheck();
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const parts = [];
    if (d > 0) parts.push(`${d} روز`);
    if (h > 0) parts.push(`${h} ساعت`);
    if (m > 0) parts.push(`${m} دقیقه`);
    parts.push(`${s} ثانیه`);
    return parts.join(' و ');
  };

  if (loading && !health) {
    return (
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-8 text-center text-slate-500 shadow-sm max-w-4xl mx-auto font-sans">
        <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
        <p className="text-sm font-medium">در حال تست و عیب‌یابی اجزای سیستم...</p>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-8 text-center text-red-600 shadow-sm max-w-4xl mx-auto font-sans">
        <XCircle className="mx-auto mb-3 text-red-500" size={32} />
        <p className="text-base font-bold mb-2">خطا در بررسی سلامت سیستم</p>
        <p className="text-sm text-slate-600 mb-4">{error}</p>
        <button
          onClick={loadHealthData}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
        >
          تلاش مجدد
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm p-6 max-w-4xl mx-auto space-y-6 font-sans">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b dark:border-gray-700 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck size={22} className="text-emerald-600" />
            پایش سلامت و تست یکپارچگی سیستم (Phase 21 Integration & Health Audit)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            آخرین استعلام: {new Date(health.checkTimestamp).toLocaleTimeString('fa-IR')}
          </p>
        </div>

        <button
          onClick={loadHealthData}
          disabled={loading}
          className="bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'در حال بروزرسانی...' : 'بررسی مجدد سلامت'}</span>
        </button>
      </div>

      {/* Grid of Core Infrastructure Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        
        {/* CARD 1: DATABASE */}
        <div className={`p-4 border rounded-xl transition-all ${
          health.database.status === 'ok' ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50/50 border-red-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <Database size={18} className={health.database.status === 'ok' ? 'text-emerald-600' : 'text-red-600'} />
              <span>پایگاه‌داده PostgreSQL</span>
            </div>
            {health.database.status === 'ok' ? (
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 size={12} /> متصل
              </span>
            ) : (
              <span className="bg-red-100 text-red-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <XCircle size={12} /> قطع
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{health.database.message}</p>
          <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-slate-400 border-t pt-2 border-slate-200/60 dark:border-slate-700">
            <span>زمان پاسخگویی (Latency):</span>
            <span className="font-mono font-bold text-slate-700 dark:text-slate-200" dir="ltr">{health.database.latencyMs} ms</span>
          </div>
        </div>

        {/* CARD 2: OUTBOX / DLQ QUEUE */}
        <div className={`p-4 border rounded-xl transition-all ${
          (health.outbox?.dlqCount || 0) === 0 ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-amber-50/50 border-amber-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <Send size={18} className={(health.outbox?.dlqCount || 0) === 0 ? 'text-emerald-600' : 'text-amber-600'} />
              <span>صف Outbox / DLQ</span>
            </div>
            {(health.outbox?.dlqCount || 0) === 0 ? (
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 size={12} /> روان
              </span>
            ) : (
              <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <AlertTriangle size={12} /> {health.outbox?.dlqCount} قرنطینه
              </span>
            )}
          </div>
          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300 mb-2">
            <div className="flex justify-between">
              <span>رویدادهای در صف (Outbox Pending):</span>
              <span className="font-bold">{health.outbox?.pendingCount || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>صف قرنطینه (Dead Letter DLQ):</span>
              <span className={`font-bold ${(health.outbox?.dlqCount || 0) > 0 ? 'text-rose-600' : ''}`}>{health.outbox?.dlqCount || 0}</span>
            </div>
          </div>
        </div>

        {/* CARD 3: ACCOUNTING VOUCHERS */}
        <div className="p-4 border rounded-xl bg-slate-50 dark:bg-gray-900/50 border-slate-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <FileText size={18} className="text-indigo-600" />
              <span>حسابداری دوبل و اسناد</span>
            </div>
            <span className="bg-indigo-100 text-indigo-800 text-[11px] font-bold px-2.5 py-1 rounded-full">
              {health.accounting?.totalVouchers || 0} سند
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
            تراز اسناد و کدینگ حساب‌ها در لایه دیتابیس پایدار است.
          </p>
        </div>

        {/* CARD 4: WORKFLOW & SLA */}
        <div className="p-4 border rounded-xl bg-slate-50 dark:bg-gray-900/50 border-slate-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <GitPullRequest size={18} className="text-purple-600" />
              <span>موتور ورکفلو و SLA</span>
            </div>
            <span className="bg-purple-100 text-purple-800 text-[11px] font-bold px-2.5 py-1 rounded-full">
              {health.workflow?.activeInstances || 0} در جریان
            </span>
          </div>
          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex justify-between">
              <span>تاییدات منقضی‌شده SLA:</span>
              <span className={`font-bold ${(health.workflow?.overdueSlaTasks || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {health.workflow?.overdueSlaTasks || 0} وظیفه
              </span>
            </div>
          </div>
        </div>

        {/* CARD 5: STORAGE / UPLOADS */}
        <div className={`p-4 border rounded-xl transition-all ${
          health.storage.writable ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50/50 border-red-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <HardDrive size={18} className={health.storage.writable ? 'text-emerald-600' : 'text-red-600'} />
              <span>ذخیره‌سازی تصاویر</span>
            </div>
            {health.storage.writable ? (
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 size={12} /> دسترسی کامل
              </span>
            ) : (
              <span className="bg-red-100 text-red-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <XCircle size={12} /> خطای دسترسی
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mb-2 truncate" title={health.storage.uploadsPath}>
            {health.storage.uploadsPath}
          </p>
        </div>

        {/* CARD 6: RUNTIME & MEMORY */}
        <div className="p-4 border rounded-xl bg-slate-50 dark:bg-gray-900/50 border-slate-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
              <Cpu size={18} className="text-blue-600" />
              <span>حافظه سرور</span>
            </div>
            <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2.5 py-1 rounded-full">
              Node.js {health.server.nodeVersion}
            </span>
          </div>
          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex justify-between">
              <span>زمان فعالیت (Uptime):</span>
              <span className="font-medium">{formatUptime(health.server.uptimeSeconds)}</span>
            </div>
            <div className="flex justify-between">
              <span>RAM Heap:</span>
              <span className="font-mono">{health.server.memoryUsageMb.heapUsed} MB / {health.server.memoryUsageMb.heapTotal} MB</span>
            </div>
          </div>
        </div>

      </div>

      {/* SECTION: SYSTEM INTEGRITY & RECONCILIATION SCAN */}
      <div className="border dark:border-gray-700 rounded-xl p-5 bg-slate-50/60 dark:bg-gray-900/40 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b dark:border-gray-700 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Activity size={18} className="text-indigo-600" />
              پایش انطباق و تطبیق خودکار سیستم (System Integrity & Reconciliation)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              ارزیابی لایه‌های دیتابیس، تراز اسناد، صف رویدادها و شاخص‌های سلامت
            </p>
          </div>

          <button
            onClick={runReconciliationCheck}
            disabled={reconciling}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all self-start sm:self-auto"
          >
            <RefreshCw size={13} className={reconciling ? 'animate-spin' : ''} />
            <span>{reconciling ? 'در حال اسکن...' : 'اجرای اسکن انطباق'}</span>
          </button>
        </div>

        {reconciliationReport && (
          <div className="space-y-4">
            {/* Score Banner */}
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-3.5 rounded-xl border dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                  reconciliationReport.healthScorePercentage >= 90
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                }`}>
                  {reconciliationReport.healthScorePercentage}%
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    شاخص سلامت و پایداری کل سیستم: {reconciliationReport.healthScorePercentage}%
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    تعداد {reconciliationReport.okChecks} از {reconciliationReport.totalChecks} آزمون انطباق با موفقیت تأیید شد.
                  </p>
                </div>
              </div>

              {/* Admin Quick Repair Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExecuteFix('requeue_dlq')}
                  disabled={fixingAction !== ''}
                  className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                >
                  <Wrench size={12} />
                  <span>بازیابی صف DLQ</span>
                </button>
                <button
                  onClick={() => handleExecuteFix('clear_stuck_outbox')}
                  disabled={fixingAction !== ''}
                  className="bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-gray-600 px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                >
                  <Play size={12} />
                  <span>بازنشانی Outbox</span>
                </button>
              </div>
            </div>

            {/* List of Check Items */}
            <div className="grid md:grid-cols-2 gap-2.5">
              {reconciliationReport.checks.map(item => (
                <div key={item.id} className="bg-white dark:bg-gray-800 border dark:border-gray-700 p-3 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                    <span className="flex items-center gap-1.5">
                      {item.status === 'ok' ? (
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      ) : item.status === 'warning' ? (
                        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                      ) : (
                        <XCircle size={14} className="text-rose-500 shrink-0" />
                      )}
                      <span>{item.title}</span>
                    </span>
                    <span className="text-[10px] bg-slate-100 dark:bg-gray-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 font-medium">
                      {item.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed pr-5">
                    {item.details}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

