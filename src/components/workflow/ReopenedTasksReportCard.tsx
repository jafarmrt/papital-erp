import { RotateCcw } from 'lucide-react';
import { formatPersianDate, formatPersianNumber } from '../../utils';

export interface ReopenedTasksReport {
  reopenedCount: number;
  keptExpiredCount: number;
  rows: Array<{ taskId: number; instanceId: number; taskTitle: string; dueAt: string | null; action: string; reason: string }>;
}

/**
 * v7.0.101 (TD-085، تصمیم مالک محصول «بازگشایی با گزارش»): کارهای تاییدی که پیش از این نسخه با گذشتن مهلت خودکار
 * منقضی شده بودند؛ کار مرحله جاری فرایندهای در جریان دوباره باز شد و بقیه با دلیل منقضی ماندند.
 */
export function ReopenedTasksReportCard({ report }: { report: ReopenedTasksReport | undefined }) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  if (!report || rows.length === 0) return null;
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-amber-200 dark:border-amber-800 shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
        <RotateCcw className="w-4 h-4 text-amber-600" />
        <span>گزارش بازگشایی کارهای منقضی‌شده خودکار</span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        {formatPersianNumber(report.reopenedCount)} کار دوباره در کارتابل باز شد و {formatPersianNumber(report.keptExpiredCount)} کار منقضی ماند.
      </p>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400 text-right">
              <th className="py-1 px-2">فرایند</th>
              <th className="py-1 px-2">کار</th>
              <th className="py-1 px-2">مهلت</th>
              <th className="py-1 px-2">نتیجه</th>
              <th className="py-1 px-2">دلیل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.taskId} className="border-t border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200">
                <td className="py-1 px-2 font-mono">#{formatPersianNumber(r.instanceId)}</td>
                <td className="py-1 px-2">{r.taskTitle}</td>
                <td className="py-1 px-2">{r.dueAt ? formatPersianDate(r.dueAt) : '—'}</td>
                <td className="py-1 px-2">{r.action === 'reopened' ? 'بازگشایی شد' : 'منقضی ماند'}</td>
                <td className="py-1 px-2">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
