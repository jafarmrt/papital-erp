import { CheckCircle2, Cpu, Database, XCircle } from 'lucide-react';
import { formatMegabytes, formatMilliseconds, formatUptime } from '../../lib/system/healthText';

/**
 * v9.0.362 (TD-622، B01-42، تصمیم ت۸): کارت‌های پایگاه‌داده و حافظه صفحه سلامت، بی واژه انگلیسی و با رقم فارسی.
 * نسخه Node.js و سکو فقط در «جزئیات فنی» (`data-technical`) می‌آیند.
 */

export interface DatabaseHealthView { status: string; latencyMs: number; message: string }
export interface ServerRuntimeView {
  nodeVersion: string;
  platform: string;
  uptimeSeconds: number;
  memoryUsageMb: { heapUsed: number; heapTotal: number; rss: number };
}

export function DatabaseHealthCard({ database }: { database: DatabaseHealthView }) {
  const ok = database.status === 'ok';
  return (
    <div className={`p-4 border rounded-xl transition-all ${
      ok ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-red-50/50 border-red-200'
    }`} data-status={ok ? 'ok' : 'error'}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          <Database size={18} className={ok ? 'text-emerald-600' : 'text-red-600'} />
          <span>پایگاه‌داده</span>
        </div>
        {ok ? (
          <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 size={12} /> متصل
          </span>
        ) : (
          <span className="bg-red-100 text-red-800 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <XCircle size={12} /> قطع
          </span>
        )}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{database.message}</p>
      <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-slate-400 border-t pt-2 border-slate-200/60 dark:border-slate-700">
        <span>زمان پاسخ پایگاه‌داده:</span>
        <span className="font-bold text-slate-700 dark:text-slate-200">{formatMilliseconds(database.latencyMs)}</span>
      </div>
    </div>
  );
}

export function RuntimeHealthCard({ server }: { server: ServerRuntimeView }) {
  const memory = server.memoryUsageMb;
  return (
    <div className="p-4 border rounded-xl bg-slate-50 dark:bg-gray-900/50 border-slate-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-slate-100">
          <Cpu size={18} className="text-blue-600" />
          <span>حافظه کارساز</span>
        </div>
      </div>
      <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
        <div className="flex justify-between">
          <span>مدت کار کارساز:</span>
          <span className="font-medium">{formatUptime(server.uptimeSeconds)}</span>
        </div>
        <div className="flex justify-between">
          <span>حافظه در حال استفاده:</span>
          <span>{formatMegabytes(memory.heapUsed)} از {formatMegabytes(memory.heapTotal)}</span>
        </div>
      </div>
      <details className="mt-2 text-[11px] text-slate-500" data-technical>
        <summary className="cursor-pointer">جزئیات فنی</summary>
        <p dir="ltr" className="text-left font-mono mt-1">Node.js {server.nodeVersion} · {server.platform}</p>
      </details>
    </div>
  );
}
