import { Lock, ListChecks } from 'lucide-react';
import type { WorkflowBlockedTransition, WorkflowTransition } from '../../hooks/queries/useWorkflowQueries';

/**
 * v7.0.89 (TD-085 بند ۱): پیش‌نمایش فارسی شرط‌های اقدام‌های ورکفلو.
 * اقدام‌هایی که شرط‌شان برقرار نیست غیرفعال با دلیل نشان داده می‌شوند و پیش از تایید هر اقدام شرط‌هایش دیده می‌شود.
 */
const matchHint = (match: 'AND' | 'OR', count: number) => (match === 'OR' && count > 1 ? 'دست‌کم یکی از این شرط‌ها:' : 'شرط‌ها:');

export function WorkflowBlockedActions({ blocked }: { blocked: WorkflowBlockedTransition[] }) {
  if (blocked.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5" aria-label="اقدام‌های غیرفعال">
      {blocked.map((b) => (
        <div key={b.id} className="flex items-start gap-1.5 text-[11px] text-gray-600 dark:text-gray-300 bg-white/70 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5">
          <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">«{b.title}» فعلاً ممکن نیست؛ {matchHint(b.conditionsMatch, b.conditions.length)}</span>
            <ul className="list-disc pr-4 text-gray-500 dark:text-gray-400">
              {b.unmetConditions.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkflowActionConditionList({ transition }: { transition: WorkflowTransition }) {
  const conditions = Array.isArray(transition.conditions) ? transition.conditions : [];
  if (conditions.length === 0) return null;
  return (
    <div className="mb-2 text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-lg px-2 py-1.5">
      <span className="flex items-center gap-1 font-semibold">
        <ListChecks className="w-3.5 h-3.5" />
        {transition.conditionsMatch === 'OR' && conditions.length > 1 ? 'دست‌کم یکی از شرط‌های این اقدام برقرار است:' : 'شرط‌های این اقدام برقرار است:'}
      </span>
      <ul className="list-disc pr-4">
        {conditions.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </div>
  );
}
