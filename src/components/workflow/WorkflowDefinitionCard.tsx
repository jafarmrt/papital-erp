import React from 'react';
import { Archive, ArchiveRestore, Edit3, History, Power, PowerOff } from 'lucide-react';
import { formatPersianNumber } from '../../utils/persianNumber';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels';
import type { WorkflowDefinitionSummary } from '../../hooks/queries/useWorkflowLifecycle';

interface LifecycleActions {
  activate: (def: WorkflowDefinitionSummary) => Promise<void>;
  deactivate: (def: WorkflowDefinitionSummary) => Promise<void>;
  archive: (def: WorkflowDefinitionSummary) => Promise<void>;
  restore: (def: WorkflowDefinitionSummary) => Promise<void>;
  pending: boolean;
}

interface Props {
  def: WorkflowDefinitionSummary;
  /** `workflow.admin`: turns workflows on and off and archives them (decision ت۴) */
  canSwitch: boolean;
  actions: LifecycleActions;
  onHistory: () => void;
  onEdit: () => void;
}

const BUTTON = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50';

function StatusBadge({ def }: { def: WorkflowDefinitionSummary }) {
  if (Number(def.isArchived) === 1) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">بایگانی</span>;
  }
  return Number(def.isActive) === 1
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">فعال</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">غیرفعال</span>;
}

/** v10.1.5 (TD-1229, D-06 part A): one workflow definition on the workflow page, with its state and switch buttons */
export const WorkflowDefinitionCard: React.FC<Props> = ({ def, canSwitch, actions, onHistory, onEdit }) => {
  const archived = Number(def.isArchived) === 1;
  const active = Number(def.isActive) === 1;
  return (
    <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xs hover:border-indigo-300 dark:hover:border-indigo-700 transition-all space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-2 py-0.5 rounded font-bold">
              {def.code}
            </span>
            <StatusBadge def={def} />
          </div>
          <h3 className="font-bold text-base text-gray-900 dark:text-white mt-1">{def.title}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">نوع پرونده: {workflowEntityTypeLabel(def.entityType)}</p>
        </div>
        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
          نسخه {formatPersianNumber(def.version ?? 1)}
        </span>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[32px]">
        {def.description || 'بی توضیح'}
      </p>

      <div className="grid grid-cols-3 gap-2 text-center text-xs bg-gray-50 dark:bg-gray-700/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-700/60">
        <div>
          <span className="block text-gray-400 text-[10px]">گام‌ها</span>
          <span className="font-bold text-gray-800 dark:text-gray-200">{formatPersianNumber(def.stateCount ?? 0)}</span>
        </div>
        <div>
          <span className="block text-gray-400 text-[10px]">اقدام‌ها</span>
          <span className="font-bold text-gray-800 dark:text-gray-200">{formatPersianNumber(def.transitionCount ?? 0)}</span>
        </div>
        <div>
          <span className="block text-gray-400 text-[10px]">در جریان</span>
          <span className="font-bold text-indigo-600 dark:text-indigo-400">{formatPersianNumber(def.activeInstancesCount ?? 0)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        {canSwitch && !archived && active && (
          <button type="button" disabled={actions.pending} onClick={() => void actions.deactivate(def)}
            className={`${BUTTON} text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100`}>
            <PowerOff className="w-3.5 h-3.5" />
            <span>غیرفعال کردن</span>
          </button>
        )}
        {canSwitch && !archived && !active && (
          <>
            <button type="button" disabled={actions.pending} onClick={() => void actions.activate(def)}
              className={`${BUTTON} text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100`}>
              <Power className="w-3.5 h-3.5" />
              <span>فعال کردن</span>
            </button>
            <button type="button" disabled={actions.pending} onClick={() => void actions.archive(def)}
              className={`${BUTTON} text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100`}>
              <Archive className="w-3.5 h-3.5" />
              <span>بایگانی</span>
            </button>
          </>
        )}
        {canSwitch && archived && (
          <button type="button" disabled={actions.pending} onClick={() => void actions.restore(def)}
            className={`${BUTTON} text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100`}>
            <ArchiveRestore className="w-3.5 h-3.5" />
            <span>بازگرداندن از بایگانی</span>
          </button>
        )}
        <button type="button" onClick={onHistory}
          className={`${BUTTON} text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700`}>
          <History className="w-3.5 h-3.5" />
          <span>تاریخچه نسخه‌ها</span>
        </button>
        <button type="button" onClick={onEdit}
          className={`${BUTTON} text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/70`}>
          <Edit3 className="w-3.5 h-3.5" />
          <span>طراحی گرافیکی روی بوم</span>
        </button>
      </div>
    </div>
  );
};
