import { useState } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';
import { projectStatusActions } from '../../lib/projects/projectStatusActions';

interface ProjectStatusActionsProps {
  projectId: number;
  status: string | null | undefined;
  version: number | undefined;
  onSaved: (response: unknown) => void;
}

/**
 * v10.0.41 (TD-1141): توقف، ادامه و لغو پروژه از پنجره جزئیات، با `PUT /projects/:id` و نسخه پروژه (TD-742). فراخواننده
 * آن را فقط برای دارنده `projects.edit` نشان می‌دهد؛ پیام رد سرور (مثلاً تخصیص مواد باز هنگام لغو) همان‌طور نشان داده می‌شود.
 */
export function ProjectStatusActions({ projectId, status, version, onSaved }: ProjectStatusActionsProps) {
  const [saving, setSaving] = useState(false);
  const actions = projectStatusActions(status);
  if (actions.length === 0) return null;

  const run = async (action: (typeof actions)[number]) => {
    if (saving) return;
    if (!(await confirmAction({ title: action.confirmTitle, message: action.confirmMessage, confirmText: action.label }))) return;
    setSaving(true);
    try {
      const res = await fetchJson(`/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action.target, version }),
      });
      toast.success('وضعیت پروژه ذخیره شد');
      onSaved(res);
    } catch (err) {
      toast.error(errorMessageOf(err) || 'وضعیت پروژه ذخیره نشد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {actions.map(action => (
        <button
          key={action.target}
          type="button"
          disabled={saving}
          onClick={() => void run(action)}
          className={`px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition-colors border border-slate-700 cursor-pointer disabled:opacity-50 ${action.danger ? 'text-rose-300 hover:text-rose-200' : 'text-slate-200 hover:text-white'}`}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}
