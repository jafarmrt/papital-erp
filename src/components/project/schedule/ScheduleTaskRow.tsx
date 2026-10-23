import { Users, Trash2, RefreshCw, CheckCircle2, Coins } from 'lucide-react';
import type { PieceworkTask, TaskAssignmentItem } from '../../../types';
import { SearchableSelect } from '../../SearchableSelect';
import { DecimalInput } from '../../common/DecimalInput';
import { useRialDisplay } from '../../../hooks/useAppCurrency';
import { isScheduleRowLogged } from '../../../lib/projects/scheduleWorkLog';
import type { SchedulePlan } from './useSchedulePlan';
import type { ScheduleLogging } from './useScheduleLogging';

interface ScheduleTaskRowProps {
  stageId: number;
  productId: string;
  taskIdx: number;
  task: TaskAssignmentItem;
  plan: SchedulePlan;
  logging: ScheduleLogging;
  pieceworkTasksList: PieceworkTask[];
  canEdit: boolean;
  canLog: boolean;
  onPickPersonnel: () => void;
}

/** one row of a product's plan in a stage: the piecework title, the personnel, the quantity, the cost and «ثبت کارمزد» */
export function ScheduleTaskRow({ stageId, productId, taskIdx, task, plan, logging, pieceworkTasksList, canEdit, canLog, onPickPersonnel }: ScheduleTaskRowProps) {
  const rial = useRialDisplay();
  const rowKey = task.id || `${stageId}-${productId}-${taskIdx}`;
  const update = (field: Parameters<SchedulePlan['handleUpdateTask']>[3], value: string | number | null) =>
    plan.handleUpdateTask(stageId, productId, taskIdx, field, value);

  return (
    <div className="p-2.5 bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2 items-center shadow-2xs hover:border-slate-300 transition-colors">
      {/* Piecework Task Select / Custom Input */}
      <div className="sm:col-span-4 flex items-center gap-1">
        {/* v9.0.423 (TD-767): فهرست جست‌وجوپذیر به جای select بومی روی همه عناوین کارمزدی */}
        <SearchableSelect
          className="w-full"
          disabled={!canEdit}
          value={task.taskId ? String(task.taskId) : ''}
          onChange={(value) => update('taskId', value)}
          options={pieceworkTasksList.map((pt) => ({ value: pt.id, label: pt.title }))}
          placeholder="انتخاب از عناوین کارمزدی"
        />
        {!task.taskId && (
          <input
            type="text"
            disabled={!canEdit}
            value={task.taskTitle || ''}
            onChange={(e) => update('taskTitle', e.target.value)}
            placeholder="یا عنوان دستی..."
            className="w-full px-2 py-1 border border-slate-300 rounded-lg text-xs"
          />
        )}
      </div>

      {/* Personnel Selection Button (Triggers Rich Personnel List Modal) */}
      <div className="sm:col-span-3">
        <button
          type="button"
          disabled={!canEdit}
          onClick={onPickPersonnel}
          className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
            task.assignedPersonnelId
              ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
              : 'bg-slate-50 border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
          }`}
        >
          <span className="truncate flex items-center gap-1.5">
            <Users size={13} className={task.assignedPersonnelId ? 'text-amber-600' : 'text-slate-400'} />
            {task.assignedPersonnelName || 'انتخاب مسئول / مجری...'}
          </span>
          <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
            تغییر
          </span>
        </button>
      </div>

      {/* Qty & Rate */}
      <div className="sm:col-span-2 flex items-center gap-1">
        <DecimalInput
          min="1"
          disabled={!canEdit}
          value={task.quantity}
          onValueChange={(v) => update('quantity', Number(v) || 0)}
          placeholder="تعداد"
          className="w-full px-1.5 py-1 border border-slate-300 rounded text-center font-mono text-xs"
        />
        <span className="text-[10px] text-slate-500 shrink-0">{task.unit || 'عدد'}</span>
      </div>

      {/* Estimated Cost & Piecework Action */}
      <div className="sm:col-span-2 flex items-center justify-between gap-1">
        <span className="font-mono font-bold text-emerald-700 text-xs">
          {rial.amount(task.estimatedCost || 0)}
        </span>

        {isScheduleRowLogged(task) ? (
          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold flex items-center gap-0.5" title="در کارکرد کارمزدی ثبت شده است">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>ثبت‌شده</span>
          </span>
        ) : canLog && (
          <button
            type="button"
            disabled={!task.assignedPersonnelId || !task.taskId || logging.busy}
            onClick={() => void logging.handleLogSingleTaskToPiecework(stageId, productId, taskIdx, task)}
            className="px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 disabled:opacity-30 rounded text-[10px] font-bold flex items-center gap-0.5 transition-colors cursor-pointer"
            title={task.assignedPersonnelId ? 'ثبت این قلم در کارتابل کارمزد پرسنل' : 'ابتدا پرسنل را انتخاب کنید'}
          >
            {logging.loggingTaskId === rowKey ? (
              <RefreshCw className="w-3 h-3 animate-spin text-amber-700" />
            ) : (
              <Coins className="w-3 h-3 text-amber-700" />
            )}
            <span>ثبت کارمزد</span>
          </button>
        )}
      </div>

      {/* Delete (v9.0.282، TD-736: ردیف ثبت‌شده حذف نمی‌شود تا پیوند کارکردش نماند) */}
      <div className="sm:col-span-1 text-center">
        {canEdit && !isScheduleRowLogged(task) && <button
          type="button"
          onClick={() => plan.handleRemoveTask(stageId, productId, taskIdx)}
          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
          title="حذف این وظیفه"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>}
      </div>
    </div>
  );
}
