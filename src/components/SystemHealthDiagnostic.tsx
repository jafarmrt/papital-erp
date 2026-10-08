import { useEffect, useState } from 'react';
import { fetchJson } from '../api';
import { getDisplayTimezoneClient, errorMessageOf } from '../utils';
import { ShieldCheck, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { SubsystemHealthCards } from './system/SubsystemHealthCards';
import { EventQueueActions, type EventQueueAction } from './system/EventQueueActions';
import { StorageHealthCard } from './system/StorageHealthCard';
import { DatabaseHealthCard, RuntimeHealthCard, type DatabaseHealthView, type ServerRuntimeView } from './system/CoreHealthCards';
import { IntegrityCheckPanel, type IntegrityReportView } from './system/IntegrityCheckPanel';
import type { AccountingHealth, OutboxHealth, WorkflowHealth } from '../lib/system/subsystemHealth';
import type { StorageHealth } from '../lib/system/storageHealth';

/**
 * صفحه سلامت سامانه (فقط مدیر سامانه). v9.0.388 تا v9.0.392 (TD-593، TD-619، TD-623، TD-622): هر بخش کارت خودش را دارد
 * (`src/components/system/`)؛ متن‌ها فارسی و عددها با رقم فارسی‌اند.
 */
interface HealthData {
  database: DatabaseHealthView;
  storage?: StorageHealth;
  outbox?: OutboxHealth;
  accounting?: AccountingHealth;
  workflow?: WorkflowHealth;
  server: ServerRuntimeView;
  checkTimestamp: string;
}

export default function SystemHealthDiagnostic() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const [integrityReport, setIntegrityReport] = useState<IntegrityReportView | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState<boolean>(false);
  const [fixingAction, setFixingAction] = useState<string>('');

  const loadHealthData = async () => {
    setLoading(true);
    setError('');
    try {
      setHealth(await fetchJson('/system/health'));
    } catch (err) {
      setError(errorMessageOf(err) || 'وضعیت سلامت سامانه دریافت نشد. دوباره تلاش کنید.');
      toast.error('وضعیت سلامت کارساز دریافت نشد.');
    } finally {
      setLoading(false);
    }
  };

  const runIntegrityCheck = async () => {
    setCheckingIntegrity(true);
    try {
      setIntegrityReport(await fetchJson('/system/reconciliation-check'));
      toast.success('بررسی یکپارچگی سامانه انجام شد.');
    } catch (err) {
      toast.error(errorMessageOf(err) || 'بررسی یکپارچگی سامانه انجام نشد. دوباره تلاش کنید.');
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleExecuteFix = async (action: EventQueueAction) => {
    setFixingAction(action);
    try {
      const res = await fetchJson('/system/reconciliation-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      toast.success(res.message || 'انجام شد.');
      await runIntegrityCheck();
      await loadHealthData();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'اجرای دوباره رویدادها انجام نشد. دوباره تلاش کنید.');
    } finally {
      setFixingAction('');
    }
  };

  useEffect(() => {
    void loadHealthData();
    void runIntegrityCheck();
  }, []);

  if (loading && !health) {
    return (
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-8 text-center text-slate-500 shadow-sm max-w-4xl mx-auto font-sans">
        <RefreshCw className="animate-spin mx-auto mb-3 text-blue-600" size={28} />
        <p className="text-sm font-medium">در حال بررسی اجزای سامانه…</p>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-8 text-center text-red-600 shadow-sm max-w-4xl mx-auto font-sans">
        <XCircle className="mx-auto mb-3 text-red-500" size={32} />
        <p className="text-base font-bold mb-2">سلامت سامانه بررسی نشد</p>
        <p className="text-sm text-slate-600 mb-4">{error}</p>
        <button
          type="button"
          onClick={loadHealthData}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
        >
          تلاش دوباره
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm p-6 max-w-4xl mx-auto space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b dark:border-gray-700 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck size={22} className="text-emerald-600" />
            سلامت سامانه و بررسی یکپارچگی
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            آخرین بررسی: {new Date(health.checkTimestamp).toLocaleTimeString('fa-IR', { timeZone: getDisplayTimezoneClient() })}
          </p>
        </div>
        <button
          type="button"
          onClick={loadHealthData}
          disabled={loading}
          className="bg-slate-100 hover:bg-slate-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'در حال به‌روزرسانی…' : 'بررسی دوباره سلامت'}</span>
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <DatabaseHealthCard database={health.database} />
        <SubsystemHealthCards
          outbox={health.outbox} accounting={health.accounting} workflow={health.workflow}
          outboxActions={<EventQueueActions outbox={health.outbox} busy={fixingAction !== ''} onRun={handleExecuteFix} />}
        />
        <StorageHealthCard storage={health.storage} />
        <RuntimeHealthCard server={health.server} />
      </div>

      <IntegrityCheckPanel report={integrityReport} running={checkingIntegrity} onRun={() => void runIntegrityCheck()} />
    </div>
  );
}
