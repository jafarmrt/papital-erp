import React, { useState } from 'react';
import { Archive, Boxes, Plus } from 'lucide-react';
import { useHasPermission } from '../../contexts/AuthContext';
import { formatPersianNumber } from '../../utils/persianNumber';
import { WORKFLOW_SWITCH_PERMISSION } from '../../lib/permissions/workflowPermissions';
import type { WorkflowDefinitionSummary } from '../../hooks/queries/useWorkflowLifecycle';
import { WorkflowDefinitionCard } from './WorkflowDefinitionCard';
import { useWorkflowLifecycleActions } from './useWorkflowLifecycleActions';

interface Props {
  definitions: WorkflowDefinitionSummary[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (id: number) => void;
  onHistory: (def: { id: number; title: string }) => void;
}

/**
 * v10.1.6 (TD-1229, D-06 part A): the workflow definitions of the workflow page. Archived definitions leave the main
 * list and are shown only under «بایگانی»; the switch buttons follow `workflow.admin`, the key their routes ask.
 */
export const WorkflowDefinitionList: React.FC<Props> = ({ definitions, isLoading, onCreate, onEdit, onHistory }) => {
  const canSwitch = useHasPermission(WORKFLOW_SWITCH_PERMISSION);
  const actions = useWorkflowLifecycleActions();
  const [showArchived, setShowArchived] = useState(false);
  const safe = Array.isArray(definitions) ? definitions : [];
  const archived = safe.filter(d => Number(d.isArchived) === 1);
  const shown = showArchived ? archived : safe.filter(d => Number(d.isArchived) !== 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-bold text-base text-gray-900 dark:text-white flex items-center gap-2">
          <Boxes className="w-5 h-5 text-indigo-600" />
          <span>{showArchived ? 'گردش کارهای بایگانی‌شده' : 'گردش کارهای تعریف‌شده سامانه'}</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/60 hover:bg-gray-200 rounded-xl transition-colors"
          >
            <Archive className="w-4 h-4" />
            <span>{showArchived ? 'بازگشت به فهرست اصلی' : `بایگانی (${formatPersianNumber(archived.length)})`}</span>
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف الگوی جدید گردش کار</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-gray-500">در حال دریافت الگوها...</div>
      ) : shown.length === 0 ? (
        <div className="p-12 text-center text-gray-500">{showArchived ? 'گردش کار بایگانی‌شده‌ای نیست.' : 'گردش کاری تعریف نشده است.'}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map(def => (
            <WorkflowDefinitionCard
              key={def.id}
              def={def}
              canSwitch={canSwitch}
              actions={actions}
              onHistory={() => onHistory({ id: def.id, title: def.title })}
              onEdit={() => onEdit(def.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
