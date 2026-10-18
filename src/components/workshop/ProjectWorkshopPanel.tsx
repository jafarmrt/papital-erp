import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { WorkshopReviewList } from './WorkshopReviewList';
import { useHasAnyPermission } from '../../contexts/AuthContext';
import { useProjectWorkshopReportsQuery } from '../../hooks/queries/useWorkshopQueries';
import { WORKSHOP_REVIEW_PERMISSION } from '../../lib/permissions/workshopPermissions';
import { formatPersianNumber } from '../../utils/persianNumber';

const READERS = ['projects.view', WORKSHOP_REVIEW_PERMISSION] as const;

/**
 * v10.1.40 (N-01 part 3, plan §4.3 «پیشرفت»): in a project's workshop schedule, each stage's approved quantity against
 * its planned rows and the end-of-task reports still waiting; a manager of the project reviews them here too.
 * 10.2 package 12 (D6): the done work is the progress matrix's rule (`scheduleWorkProgress.ts`); a stage whose rows have
 * several units shows only its percent.
 */
export function ProjectWorkshopPanel({ projectId, stages }: {
  projectId: number;
  stages: ReadonlyArray<{ id: number; title: string }>;
}): React.ReactElement | null {
  const canRead = useHasAnyPermission(READERS);
  const { data } = useProjectWorkshopReportsQuery(projectId, canRead);
  if (!data) return null;
  const pending = Array.isArray(data.pending) ? data.pending : [];
  const progress = (Array.isArray(data.stageProgress) ? data.stageProgress : []).filter(s => s.plannedQuantity === null || s.plannedQuantity > 0);
  if (pending.length === 0 && progress.length === 0) return null;
  const titleOf = (stageId: number) => stages.find(s => s.id === stageId)?.title ?? `مرحله ${formatPersianNumber(stageId)}`;

  return (
    <section aria-label="گزارش‌های کارگاه" className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 text-sm">
      <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
        <ClipboardCheck className="w-4 h-4 text-blue-600" aria-hidden="true" /> گزارش‌های پایان کار کارگاه
      </h3>
      {progress.length > 0 && (
        <ul className="space-y-2">
          {progress.map(stage => (
            <li key={stage.stageId}>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span className="font-bold">{titleOf(stage.stageId)}</span>
                <span>
                  {stage.unit && stage.approvedQuantity !== null && stage.plannedQuantity !== null
                    ? <>{formatPersianNumber(stage.approvedQuantity, 4)} از {formatPersianNumber(stage.plannedQuantity, 4)} {stage.unit} · </>
                    : null}
                  {formatPersianNumber(stage.percent, 0)}٪
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={titleOf(stage.stageId)}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.percent)}>
                <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, stage.percent))}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && data.canReview && <WorkshopReviewList items={pending} />}
    </section>
  );
}

export default ProjectWorkshopPanel;
