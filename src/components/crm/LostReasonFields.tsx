import { useState, type FormEvent } from 'react';
import { CRM_LOST_REASONS, CRM_LOST_REASON_LABELS, CRM_LOST_REASON_NOTE_MAX, lostReasonError } from '../../lib/crm/leadFields';
import { DialogLayer } from '../common/DialogLayer';

interface LostReasonFieldsProps {
  reason: string;
  note: string;
  onChange: (next: { reason: string; note: string }) => void;
}

/**
 * v10.1.18 (N-02 بخش ۲، تصمیم ت۶): دلیل از دست رفتن پرونده از فهرست ثابت و شرح «سایر»؛ در فرم پرونده و در پنجره‌ای که
 * کشیدن پرونده به ستون «ناموفق» یا انتخاب آن مرحله باز می‌کند. همان قاعده `lostReasonError` کارساز.
 */
export function LostReasonFields({ reason, note, onChange }: LostReasonFieldsProps) {
  return (
    <fieldset className="space-y-2 p-3 rounded-xl border border-rose-200 bg-rose-50/40" data-testid="lost-reason-fields">
      <legend className="px-1 text-xs font-bold text-rose-800">دلیل از دست رفتن</legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {CRM_LOST_REASONS.map(key => (
          <label key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${reason === key ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200'}`}>
            <input type="radio" name="lost-reason" value={key} checked={reason === key} onChange={() => onChange({ reason: key, note })} className="sr-only" />
            {CRM_LOST_REASON_LABELS[key]}
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={e => onChange({ reason, note: e.target.value })}
        maxLength={CRM_LOST_REASON_NOTE_MAX}
        rows={2}
        placeholder={reason === 'other' ? 'شرح دلیل (لازم برای «سایر»)' : 'شرح کوتاه (اختیاری)'}
        aria-label="شرح دلیل از دست رفتن"
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white outline-none focus:border-rose-400"
      />
    </fieldset>
  );
}

interface LostReasonDialogProps {
  leadTitle: string;
  onCancel: () => void;
  onConfirm: (lost: { lostReason: string; lostReasonNote: string }) => Promise<void> | void;
}

/** پنجره پرسش دلیل، پیش از رفتن پرونده به «ناموفق (انصراف)» از قیف یا فهرست */
export function LostReasonDialog({ leadTitle, onCancel, onConfirm }: LostReasonDialogProps) {
  const [value, setValue] = useState({ reason: '', note: '' });
  const [saving, setSaving] = useState(false);
  const error = value.reason ? lostReasonError(value.reason, value.note) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.reason || error) return;
    setSaving(true);
    try {
      await onConfirm({ lostReason: value.reason, lostReasonNote: value.note.trim() });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[90] bg-slate-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="دلیل از دست رفتن">
      <DialogLayer onClose={onCancel} disabled={saving} />
      <form onSubmit={submit} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="font-black text-sm text-slate-900">پرونده «{leadTitle}» از دست رفت؟</h3>
        <p className="text-[11px] text-slate-500">دلیل را انتخاب کنید؛ گزارش قیف دلیل‌ها را می‌شمارد.</p>
        <LostReasonFields reason={value.reason} note={value.note} onChange={setValue} />
        {error && <p className="text-[11px] text-rose-600" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-[44px] px-4 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">انصراف</button>
          <button type="submit" disabled={!value.reason || !!error || saving} className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50 cursor-pointer">
            {saving ? 'در حال ثبت…' : 'ثبت «از دست رفته»'}
          </button>
        </div>
      </form>
    </div>
  );
}
