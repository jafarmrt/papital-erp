import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Loader2, ShieldAlert } from 'lucide-react';
import { SectionErrorBoundary } from '../components/common';
import { useViewerAccess } from '../contexts/AuthContext';
import { canOpenPage } from '../lib/permissions/pageAccess';
import { MANAGEMENT_REPORT_TABS, managementReportPath, type ManagementReportTabId } from '../lib/reports/managementReportTabs';

const SalesReportTab = lazy(() => import('../components/reports/sales/SalesReportTab').then(m => ({ default: m.SalesReportTab })));

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): صفحه «گزارش‌های مدیریتی». فقط زبانه‌هایی دیده می‌شوند که کاربر کلید رابطشان
 * را دارد؛ نشانی زبانه‌ای که کاربر نمی‌بیند به نخستین زبانه مجاز می‌رود.
 */
const TAB_CONTENT: Record<ManagementReportTabId, ComponentType> = {
  sales: SalesReportTab,
};

export default function ManagementReportsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const viewer = useViewerAccess();
  const tabs = MANAGEMENT_REPORT_TABS.filter(t => canOpenPage(managementReportPath(t.id), viewer));
  const current = tabs.find(t => t.id === tab) ?? null;
  const fallback = tabs[0]?.id ?? null;

  useEffect(() => {
    if (!current && fallback) void navigate(managementReportPath(fallback), { replace: true });
  }, [current, fallback, navigate]);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500" dir="rtl">
        <ShieldAlert className="w-10 h-10 text-rose-400" />
        <p className="text-sm font-bold">هیچ گزارشی از این صفحه برای شما باز نیست.</p>
      </div>
    );
  }

  const Content = current ? TAB_CONTENT[current.id] : null;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-white">
          <BarChart3 className="w-6 h-6 text-indigo-600" />
          گزارش‌های مدیریتی
        </h1>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={current?.id === t.id}
              onClick={() => void navigate(managementReportPath(t.id))}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${current?.id === t.id
                ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}`}
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>
      {Content && (
        <SectionErrorBoundary>
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>}>
            <Content />
          </Suspense>
        </SectionErrorBoundary>
      )}
    </div>
  );
}
