import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { confirmAction } from '../ConfirmDialogHost';

/**
 * v10.0.42 (TD-1140): افزودن و حذف مرحله پس از ثبت پروژه، با مسیرهای `POST` و `DELETE /projects/:id/stages` (کلید
 * `projects.edit`). پیش‌تر پنجره پروژه فقط ویرایش مرحله داشت و فرم ویرایش پروژه مراحل را فقط‌خواندنی نشان می‌داد (TD-740)،
 * پس مرحله‌ای که در ثبت جا افتاده بود هرگز اضافه یا حذف نمی‌شد. شماره مرحله تازه را سرور می‌دهد (`nextStageOrder`، TD-737)
 * و وضعیت آن در پروژه دارای ماتریس پیشرفت از ماتریس خوانده می‌شود (TD-758).
 */
export function AddStageForm({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const trimmed = title.trim();

  const add = async () => {
    if (saving || !trimmed) return;
    setSaving(true);
    try {
      await fetchJson(`/projects/${projectId}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      toast.success('مرحله افزوده شد');
      setTitle('');
      onChanged();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'مرحله افزوده نشد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
        placeholder="عنوان مرحله تازه"
        aria-label="عنوان مرحله تازه"
        className="flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      />
      <button
        type="button"
        disabled={saving || !trimmed}
        onClick={() => void add()}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>افزودن مرحله</span>
      </button>
    </div>
  );
}

export function DeleteStageButton({ projectId, stage, onChanged }: { projectId: number; stage: { id: number; title: string }; onChanged: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (deleting) return;
    const ok = await confirmAction({
      title: 'حذف مرحله',
      message: `مرحله «${stage.title}» و پیشرفت ثبت‌شده آن در ماتریس حذف می‌شود.`,
      confirmText: 'حذف مرحله',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await fetchJson(`/projects/${projectId}/stages/${stage.id}`, { method: 'DELETE' });
      toast.success('مرحله حذف شد');
      onChanged();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'مرحله حذف نشد');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      type="button"
      disabled={deleting}
      onClick={() => void remove()}
      title={`حذف مرحله «${stage.title}»`}
      aria-label={`حذف مرحله «${stage.title}»`}
      className="p-1.5 bg-white border border-slate-300 hover:border-rose-500 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}
