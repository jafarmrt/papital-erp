import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Lock, Pencil, Trash2 } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import type { MediaSection, MediaSectionInput } from '../../lib/media/mediaSectionsApi';

export const SECTION_FIXED_TEXT = 'ثابت';
export const SECTION_TITLE_LABEL = 'عنوان بخش';
export const SECTION_DESCRIPTION_LABEL = 'توضیح بخش';

const inputClass = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const iconClass = 'p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40';

interface FieldsProps {
  initial: MediaSectionInput;
  busy: boolean;
  submitText: string;
  onSubmit: (input: MediaSectionInput) => void;
  onCancel?: () => void;
}

/** Title and description of a section, for a new section and for an edit */
export function MediaSectionFields({ initial, busy, submitText, onSubmit, onCancel }: FieldsProps) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), description: description.trim() });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <input className={inputClass} value={title} maxLength={100} onChange={e => setTitle(e.target.value)} aria-label={SECTION_TITLE_LABEL} placeholder={SECTION_TITLE_LABEL} />
      <textarea className={inputClass} rows={2} value={description} maxLength={1000} onChange={e => setDescription(e.target.value)} aria-label={SECTION_DESCRIPTION_LABEL} placeholder={SECTION_DESCRIPTION_LABEL} />
      <div className="flex gap-2 justify-end">
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold text-slate-600">انصراف</button>}
        <button type="submit" disabled={busy || !title.trim()} className="px-3 h-8 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50">{submitText}</button>
      </div>
    </form>
  );
}

interface RowProps {
  section: MediaSection;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (step: -1 | 1) => void;
  onSave: (input: MediaSectionInput) => Promise<boolean>;
  onDelete: () => void;
}

/** v10.0.27 (N-05 PR 3): one section in the manager's window; «محصولات» is fixed but may be moved */
export function MediaSectionRow({ section, isFirst, isLast, busy, onMove, onSave, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const fixed = section.kind === 'products';
  if (editing) {
    return (
      <li className="border border-blue-200 rounded-lg p-2">
        <MediaSectionFields
          initial={{ title: section.title, description: section.description }}
          busy={busy}
          submitText="ذخیره"
          onCancel={() => setEditing(false)}
          onSubmit={input => void onSave(input).then(ok => { if (ok) setEditing(false); })}
        />
      </li>
    );
  }
  return (
    <li className="border border-slate-200 rounded-lg p-2 flex items-center gap-2" data-testid={`media-section-row-${section.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-800 truncate">{section.title}</span>
          {fixed && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5"><Lock size={10} />{SECTION_FIXED_TEXT}</span>}
          <span className="text-[11px] text-slate-500">{formatPersianNumber(section.assetCount)} فایل</span>
        </div>
        {section.description && <p className="text-[11px] text-slate-500 truncate">{section.description}</p>}
      </div>
      <button type="button" className={iconClass} disabled={busy || isFirst} onClick={() => onMove(-1)} aria-label={`جابه‌جایی ${section.title} به بالا`}><ArrowUp size={14} /></button>
      <button type="button" className={iconClass} disabled={busy || isLast} onClick={() => onMove(1)} aria-label={`جابه‌جایی ${section.title} به پایین`}><ArrowDown size={14} /></button>
      {!fixed && (
        <>
          <button type="button" className={iconClass} disabled={busy} onClick={() => setEditing(true)} aria-label={`ویرایش ${section.title}`}><Pencil size={14} /></button>
          <button type="button" className={`${iconClass} text-rose-600`} disabled={busy} onClick={onDelete} aria-label={`حذف ${section.title}`}><Trash2 size={14} /></button>
        </>
      )}
    </li>
  );
}
