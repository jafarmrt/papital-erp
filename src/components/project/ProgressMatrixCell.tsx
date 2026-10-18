import { Ban, CheckCircle2, Circle, Clock } from 'lucide-react';
import { PROGRESS_CELL_LABELS, cellWorkLabel, type ProgressCellStatus, type ProgressCellWork } from '../../lib/projects/progressTicks';

const STATUS_STYLE: Record<ProgressCellStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200',
  in_progress: 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200',
  blocked: 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200',
  pending: 'bg-slate-100 text-slate-300 border border-slate-200 hover:bg-slate-200',
};

function StatusIcon({ status }: { status: ProgressCellStatus }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4" aria-hidden="true" />;
  if (status === 'in_progress') return <Clock className="w-4 h-4" aria-hidden="true" />;
  if (status === 'blocked') return <Ban className="w-4 h-4" aria-hidden="true" />;
  return <Circle className="w-4 h-4" aria-hidden="true" />;
}

/**
 * 10.2 package 12 (D6, owner decision ت۴۲ الف): one cell of the desktop progress matrix: the manager's «تمام» tick and,
 * under it, the done work of the cell's workshop schedule rows («۶۰ از ۱۰۰»). The tick is off without `projects.edit`
 * and while a save is under way (backlog: ticks made during a save were dropped when it returned).
 */
export function ProgressMatrixCell({ stageTitle, optional, status, edited, work, disabled, onToggle }: {
  stageTitle: string;
  optional: boolean;
  status: ProgressCellStatus;
  edited: boolean;
  work: ProgressCellWork | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const workText = work ? `کار ثبت‌شدهٔ کارگاه: ${cellWorkLabel(work)}` : '';
  const title = [`${stageTitle}${optional ? ' (اختیاری)' : ''} — ${PROGRESS_CELL_LABELS[status]}`, workText].filter(Boolean).join('، ');
  return (
    <td className={`p-1 text-center ${optional ? 'bg-amber-50/30' : ''} ${edited ? 'bg-blue-100/50' : ''}`}>
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={title}
          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default ${STATUS_STYLE[status]}`}
          title={`${title} (کلیک: تغییر تمام/ناتمام)`}
        >
          <StatusIcon status={status} />
        </button>
        {work && <span className="text-[9px] text-slate-500 whitespace-nowrap">{cellWorkLabel(work, true)}</span>}
      </div>
    </td>
  );
}

export default ProgressMatrixCell;
