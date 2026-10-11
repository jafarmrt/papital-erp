import { useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { formatPersianCode, formatPersianNumber, toPersianDigits } from '../../utils';
import type { MediaProductItem } from '../../lib/media/mediaApi';
import { MediaProductInfoForm } from './MediaProductInfoForm';

interface Props {
  item: MediaProductItem;
  canEdit: boolean;
  onSaved: (item: MediaProductItem) => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value || '—'}</span>
    </div>
  );
}

/** Product card of the media library: what a photographer or seller needs to know about the product */
export function MediaProductInfoCard({ item, canEdit, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const weight = item.weight === null || item.weight === '' ? '' : formatPersianNumber(item.weight);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4" aria-label="مشخصات محصول">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-mono text-slate-500">{formatPersianCode(item.code)}</span>
          <h1 className="text-lg font-black text-slate-800">{item.name}</h1>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Pencil size={14} /> ویرایش مشخصات
          </button>
        )}
      </div>

      {editing ? (
        <MediaProductInfoForm item={item} onCancel={() => setEditing(false)} onSaved={(saved) => { setEditing(false); onSaved(saved); }} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="دسته‌بندی" value={item.category} />
            <Field label="رنگ" value={item.color} />
            <Field label="جنس" value={item.material} />
            <Field label="اندازه" value={item.size ? toPersianDigits(item.size) : ''} />
            <Field label="وزن" value={weight} />
            <Field label="سال طراحی" value={item.designYear ? toPersianDigits(String(item.designYear)) : ''} />
            <Field label="کد ترنسفر" value={item.transferCode ? formatPersianCode(item.transferCode) : ''} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-500">کالکشن‌ها</span>
            <div className="flex flex-wrap gap-1.5">
              {item.collections.length === 0 && <span className="text-sm text-slate-400">—</span>}
              {item.collections.map(c => <span key={c} className="rounded-full bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5">{c}</span>)}
            </div>
          </div>
          {item.productDescription && <Field label="توضیح محصول" value={<span className="whitespace-pre-line font-normal">{item.productDescription}</span>} />}
          {item.technicalNotes && <Field label="نکته‌های فنی" value={<span className="whitespace-pre-line font-normal">{item.technicalNotes}</span>} />}
        </>
      )}
    </section>
  );
}
