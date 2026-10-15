import React from 'react';
import { WORKFLOW_ENTITY_TYPES, workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels';
import { workflowEntityTypeChangeRefusal } from '../../lib/workflow/workflowLifecycle';

interface Props {
  value: string;
  onChange: (entityType: string) => void;
  /** the stored definition: whether it is active and how many records it started */
  isActive?: number | null;
  startedCount?: number | null;
}

/**
 * v10.1.5 (TD-1229, OBS-PR-15, decision ت۲۷): the record type of a workflow in the designer. Only an inactive workflow
 * that no record ever entered takes another type (the server's rule); otherwise the field is locked and says why.
 */
export const WorkflowEntityTypeField: React.FC<Props> = ({ value, onChange, isActive, startedCount }) => {
  const refusal = workflowEntityTypeChangeRefusal({ isActive, startedCount });
  const options = WORKFLOW_ENTITY_TYPES.some(t => t.id === value) || !value
    ? WORKFLOW_ENTITY_TYPES
    : [...WORKFLOW_ENTITY_TYPES, { id: value, label: workflowEntityTypeLabel(value) }];
  return (
    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mt-1" title={refusal ?? undefined}>
      <span>نوع پرونده:</span>
      <select
        aria-label="نوع پرونده"
        value={value}
        disabled={Boolean(refusal)}
        onChange={e => onChange(e.target.value)}
        className="px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
      >
        {options.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {refusal && <span className="text-[11px] text-amber-600 dark:text-amber-400">{refusal}</span>}
    </label>
  );
};
