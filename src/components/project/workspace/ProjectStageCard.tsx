import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Edit3, RefreshCw, Sparkles, X } from 'lucide-react';
import type { Personnel, ProjectStage } from '../../../types';
import { fetchJson } from '../../../api';
import { errorMessageOf, formatPersianDate, formatPersianNumber, toPersianDigits, toStorageDate } from '../../../utils';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { StageStatusField } from '../StageStatusField';
import { DeleteStageButton } from '../ProjectStageActions';
import { StagePersonnelPicker } from './StagePersonnelPicker';

const STAGE_STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'در انتظار شروع', bg: 'bg-slate-100', text: 'text-slate-700' },
  in_progress: { label: 'در حال انجام', bg: 'bg-amber-100', text: 'text-amber-800' },
  completed: { label: 'تکمیل‌شده', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  blocked: { label: 'متوقف / مانع', bg: 'bg-rose-100', text: 'text-rose-800' },
};

interface ProjectStageCardProps {
  projectId: number;
  stage: ProjectStage;
  personnel: readonly Personnel[];
  /** v9.0.366 (TD-758): in a project with a progress matrix the stage's status and percent come only from the matrix */
  stagesFromMatrix: boolean;
  canEdit: boolean;
  onChanged: () => void;
  /** told while this stage's form is open, so the page warns before its changes are thrown away */
  onEditingChange: (stageId: number, editing: boolean) => void;
}

interface StageDraft {
  title: string;
  status: string;
  progress: number;
  startDate: string;
  endDate: string;
  personnel: string[];
  notes: string;
}

const draftOf = (stage: ProjectStage): StageDraft => ({
  title: stage.title,
  status: stage.status,
  progress: stage.progress_percent || 0,
  // v9.0.419 (TD-763): تاریخ مرحله در فرم ISO است و با تقویم شمسی انتخاب می‌شود
  startDate: toStorageDate(stage.start_date || '') || '',
  endDate: toStorageDate(stage.end_date || '') || '',
  personnel: Array.isArray(stage.assigned_personnel) ? stage.assigned_personnel.map(String).filter(Boolean) : [],
  notes: stage.notes || '',
});

export function ProjectStageCard({ projectId, stage, personnel, stagesFromMatrix, canEdit, onChanged, onEditingChange }: ProjectStageCardProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState<StageDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const statusInfo = STAGE_STATUS_STYLES[stage.status] || { label: stage.status, bg: 'bg-slate-100', text: 'text-slate-700' };
  const completedSkus = stage.completed_skus_count ?? stage.completedSkusCount;
  const applicableSkus = stage.applicable_skus_count ?? stage.applicableSkusCount;
  const progress = Math.min(100, Math.max(0, stage.progress_percent || 0));

  useEffect(() => { onEditingChange(stage.id, editing); }, [editing, onEditingChange, stage.id]);
  useEffect(() => () => onEditingChange(stage.id, false), [onEditingChange, stage.id]);

  const update = (patch: Partial<StageDraft>) => setDraft(prev => (prev ? { ...prev, ...patch } : prev));

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await fetchJson(`/projects/${projectId}/stages/${stage.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          ...(stagesFromMatrix ? {} : { status: draft.status, progress_percent: draft.progress }),
          start_date: draft.startDate,
          end_date: draft.endDate,
          assigned_personnel: draft.personnel,
          required_resources: Array.isArray(stage.required_resources) ? stage.required_resources : [],
          notes: draft.notes,
        }),
      });
      toast.success('مرحله ذخیره شد');
      setDraft(null);
      onChanged();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'مرحله ذخیره نشد');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-xs shrink-0">
            {toPersianDigits(stage.stage_order || stage.id)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 text-xs">{stage.title}</span>
              <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${statusInfo.bg} ${statusInfo.text}`}>{statusInfo.label}</span>
              {applicableSkus !== undefined && applicableSkus > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-100 font-semibold text-[10px]">
                  {formatPersianNumber(completedSkus || 0)} از {formatPersianNumber(applicableSkus)} قلم کالا تکمیل شد
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
              {stage.assigned_personnel && stage.assigned_personnel.length > 0 && <span>پرسنل: {stage.assigned_personnel.join('، ')}</span>}
              {stage.start_date && <span>• شروع: {formatPersianDate(stage.start_date)}</span>}
              {stage.end_date && <span>• پایان: {formatPersianDate(stage.end_date)}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
          <div className="flex items-center gap-1.5 min-w-[70px]">
            <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
              <div className={`h-full ${progress >= 100 ? 'bg-emerald-500' : progress > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${progress}%` }} />
            </div>
            <span className="font-bold text-slate-700 text-xs">{formatPersianNumber(stage.progress_percent || 0)}٪</span>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setDraft(draftOf(stage))}
              className="px-3 py-1.5 bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-blue-700 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ویرایش زمان‌بندی و پرسنل</span>
            </button>
          )}
          {canEdit && <DeleteStageButton projectId={projectId} stage={stage} onChanged={onChanged} />}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-400 bg-blue-50/40 p-4 ring-2 ring-blue-100 space-y-3">
      <div className="flex items-center justify-between border-b border-blue-200 pb-2">
        <span className="font-bold text-slate-900 text-xs">ویرایش مرحله: {stage.title}</span>
        <button type="button" onClick={() => setDraft(null)} disabled={saving} className="text-slate-400 hover:text-slate-600 p-1" aria-label="انصراف از ویرایش مرحله">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${fieldId}-title`} className="block text-[11px] font-bold text-slate-700 mb-1">عنوان مرحله</label>
          <input id={`${fieldId}-title`} type="text" value={draft.title} onChange={(e) => update({ title: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white" />
        </div>
        {!stagesFromMatrix ? (
          <StageStatusField status={draft.status} progress={draft.progress} onStatusChange={status => update({ status })} onProgressChange={value => update({ progress: value })} />
        ) : (
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-2.5 space-y-1 sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">وضعیت و درصد پیشرفت مرحله</span>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-blue-600" aria-hidden="true" />
                از پیشرفت هر کالا خوانده می‌شود
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusInfo.bg} ${statusInfo.text}`}>{statusInfo.label}</span>
              <span className="font-bold text-slate-900 text-xs">{formatPersianNumber(draft.progress)}٪</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor={`${fieldId}-personnel`} className="block text-[11px] font-bold text-slate-700 mb-1">پرسنل مسئول</label>
          <StagePersonnelPicker id={`${fieldId}-personnel`} value={draft.personnel} personnel={personnel} onChange={names => update({ personnel: names })} disabled={saving} />
        </div>
        <div>
          <label htmlFor={`${fieldId}-start`} className="block text-[11px] font-bold text-slate-700 mb-1">تاریخ شروع</label>
          <JalaliDateInput id={`${fieldId}-start`} value={draft.startDate} onChange={startDate => update({ startDate })} placeholder="انتخاب تاریخ" className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white" />
        </div>
        <div>
          <label htmlFor={`${fieldId}-end`} className="block text-[11px] font-bold text-slate-700 mb-1">تاریخ پایان / تحویل</label>
          <JalaliDateInput id={`${fieldId}-end`} value={draft.endDate} onChange={endDate => update({ endDate })} placeholder="انتخاب تاریخ" className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white" />
        </div>
        <div>
          <label htmlFor={`${fieldId}-notes`} className="block text-[11px] font-bold text-slate-700 mb-1">یادداشت مرحله</label>
          <input id={`${fieldId}-notes`} type="text" value={draft.notes} onChange={(e) => update({ notes: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-blue-200">
        <button type="button" onClick={() => setDraft(null)} disabled={saving} className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-xs">
          انصراف
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
          <span>{saving ? 'در حال ذخیره' : 'ذخیره مرحله'}</span>
        </button>
      </div>
    </div>
  );
}
