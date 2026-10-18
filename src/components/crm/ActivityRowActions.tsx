import { useState } from 'react';
import { Edit3, Paperclip, Trash2 } from 'lucide-react';
import type { CRMActivity } from '../../types';
import { useHasPermission } from '../../contexts/AuthContext';
import { formatPersianNumber } from '../../utils/persianNumber';
import { CrmAttachmentsWindow } from './CrmAttachmentsWindow';

interface ActivityRowActionsProps {
  activity: CRMActivity;
  onEdit?: (act: CRMActivity) => void;
  onDelete?: (act: CRMActivity) => void;
}

/**
 * v10.1.18 (N-02 بخش ۲، ت۱ و ت۲): دکمه‌های «ویرایش» و «حذف» یک اقدام؛ فقط برای دارنده `crm.manage`، کلیدی که مسیرهای
 * `PUT` و `DELETE /crm/activities/:id` می‌خواهند. v10.2 بسته ۷ (N-02 §۳.۳): دکمه «پیوست‌ها» با شمار پیوست‌ها برای
 * دارنده `crm.view`، کلیدی که فهرست و دریافت پیوست می‌خواهد؛ افزودن و حذف درون پنجره فقط با `crm.manage` است.
 */
export function ActivityRowActions({ activity, onEdit, onDelete }: ActivityRowActionsProps) {
  const canView = useHasPermission('crm.view');
  const canManage = useHasPermission('crm.manage');
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const shownCount = count ?? activity.attachmentCount ?? 0;
  const editable = canManage && Boolean(onEdit || onDelete);
  if (!canView && !editable) return null;
  return (
    <span className="inline-flex items-center gap-1" data-testid={`activity-actions-${activity.id}`}>
      {canView && (
        <button type="button" onClick={() => setOpen(true)} title="پیوست‌ها" aria-label={`پیوست‌های اقدام (${formatPersianNumber(shownCount)})`}
          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-blue-700 cursor-pointer inline-flex items-center gap-0.5">
          <Paperclip size={12} />
          {shownCount > 0 && <span className="text-[10px] font-bold">{formatPersianNumber(shownCount)}</span>}
        </button>
      )}
      {open && (
        <CrmAttachmentsWindow owner="activity" ownerId={activity.id} title={activity.title} onClose={() => setOpen(false)} onCountChange={setCount}
          initial={activity.attachments} />
      )}
      {editable && onEdit && (
        <button type="button" onClick={() => onEdit(activity)} title="ویرایش اقدام" aria-label="ویرایش اقدام"
          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-blue-700 cursor-pointer">
          <Edit3 size={12} />
        </button>
      )}
      {editable && onDelete && (
        <button type="button" onClick={() => onDelete(activity)} title="حذف اقدام" aria-label="حذف اقدام"
          className="p-1 rounded-md bg-slate-100 text-slate-500 hover:text-rose-600 cursor-pointer">
          <Trash2 size={12} />
        </button>
      )}
    </span>
  );
}
