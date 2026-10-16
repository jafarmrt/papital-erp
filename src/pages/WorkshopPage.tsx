import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Hammer, Loader2 } from 'lucide-react';
import { WorkshopTaskList } from '../components/workshop/WorkshopTaskList';
import { WorkshopDeliveryList } from '../components/workshop/WorkshopDeliveryList';
import { WorkshopReviewList } from '../components/workshop/WorkshopReviewList';
import { useHasPermission } from '../contexts/AuthContext';
import { useMyWorkshopDeliveriesQuery, useMyWorkshopTasksQuery, useWorkshopReviewQuery } from '../hooks/queries/useWorkshopQueries';
import { WORKSHOP_REVIEW_PERMISSION, WORKSHOP_SELF_PERMISSION } from '../lib/permissions/workshopPermissions';
import { PHONE_TAP_TARGET } from '../lib/pwa/phoneLayout';
import {
  highlightedRowKey, WORKSHOP_TAB_LABELS, workshopTabOf, workshopTabPath, workshopTabsFor, type WorkshopTab,
} from '../lib/workshop/workshopView';
import { getErrorMessage } from '../utils/formatters';
import { formatPersianNumber } from '../utils/persianNumber';

/**
 * v10.1.40 (N-01 part 3, mobile workshop plan §4.3): the workshop cartable, on a phone and on a computer alike. A worker
 * (`workshop.self`) sees «کارهای من» and «حواله‌های من» at `/workshop`; a project manager (`workshop.review`) sees
 * «بررسی گزارش‌ها» at `/workshop/review`. Nothing is kept for offline use (decision ت۱۰ الف).
 */
export default function WorkshopPage(): React.ReactElement {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const tabs = workshopTabsFor({ self: useHasPermission(WORKSHOP_SELF_PERMISSION), review: useHasPermission(WORKSHOP_REVIEW_PERMISSION) });
  const tab = workshopTabOf(pathname, search, tabs);

  const tasks = useMyWorkshopTasksQuery(tab === 'tasks');
  const deliveries = useMyWorkshopDeliveriesQuery(tab === 'deliveries');
  const review = useWorkshopReviewQuery(tab === 'review');
  const reviewCount = Array.isArray(review.data) ? review.data.length : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24 md:pb-12 font-farsi text-right">
      <header className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
          <Hammer className="w-6 h-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">کارتابل کارگاه</h1>
          {tasks.data?.personnel && <p className="text-sm text-gray-500">{tasks.data.personnel.fullName}</p>}
        </div>
      </header>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="بخش‌های کارتابل" className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {tabs.map((t: WorkshopTab) => (
            <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => navigate(workshopTabPath(t))}
              className={`${PHONE_TAP_TARGET} flex-1 rounded-lg px-3 py-2 text-sm font-bold ${
                t === tab ? 'bg-white dark:bg-gray-700 text-blue-700 shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>
              {WORKSHOP_TAB_LABELS[t]}
              {t === 'review' && reviewCount > 0 && <span className="mr-1 text-xs">({formatPersianNumber(reviewCount)})</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'tasks' && (
        <QueryState loading={tasks.isLoading} error={tasks.error}>
          {tasks.data && <WorkshopTaskList data={tasks.data} highlighted={highlightedRowKey(search)} />}
        </QueryState>
      )}
      {tab === 'deliveries' && (
        <QueryState loading={deliveries.isLoading} error={deliveries.error}>
          {deliveries.data && <WorkshopDeliveryList data={deliveries.data} />}
        </QueryState>
      )}
      {tab === 'review' && (
        <QueryState loading={review.isLoading} error={review.error}>
          <WorkshopReviewList items={review.data ?? []} />
        </QueryState>
      )}
    </div>
  );
}

function QueryState({ loading, error, children }: { loading: boolean; error: unknown; children: React.ReactNode }): React.ReactElement {
  if (loading) {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-sm text-gray-500 py-10">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> در حال بارگذاری…
      </p>
    );
  }
  if (error) return <p role="alert" className="text-sm bg-rose-50 text-rose-700 border border-rose-200 rounded-xl p-4">{getErrorMessage(error)}</p>;
  return <>{children}</>;
}
