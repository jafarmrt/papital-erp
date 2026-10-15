import { Edit3, Trash2 } from 'lucide-react';
import type { CRMActivity } from '../../types';
import { useHasPermission } from '../../contexts/AuthContext';

interface ActivityRowActionsProps {
  activity: CRMActivity;
  onEdit?: (act: CRMActivity) => void;
  onDelete?: (act: CRMActivity) => void;
}

/**
 * v10.1.17 (N-02 بخش ۲، ت۱ و ت۲): دکمه‌های «ویرایش» و «حذف» یک اقدام؛ فقط برای دارنده `crm.manage`، کلیدی که مسیرهای
 * `PUT` و `DELETE /crm/activities/:id` می‌خواهند.
 */
export function ActivityRowActions({ activity, onEdit, onDelete }: ActivityRowActionsProps) {
  const canManage = useHasPermission('crm.manage');
  if (!canManage || (!onEdit && !onDelete)) return null;
  return (
    <span className="inline-flex items-center gap-1" data-testid={`activity-actions-${activity.id}`}>
      {onEdit && (
        <button type="button" onClick={() => onEdit(activity)} title="ویرایش اقدام" aria-label="ویرایش اقدام"
          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-blue-700 cursor-pointer">
          <Edit3 size={12} />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={() => onDelete(activity)} title="حذف اقدام" aria-label="حذف اقدام"
          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-rose-600 cursor-pointer">
          <Trash2 size={12} />
        </button>
      )}
    </span>
  );
}
