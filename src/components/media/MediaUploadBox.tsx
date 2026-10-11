import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, UploadCloud, X } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { MEDIA_SHOT_TYPES, MEDIA_SHOT_TYPE_LABELS, MEDIA_WARNING_TEXT, type MediaShotType } from '../../lib/media/mediaRules';
import type { MediaAssetView } from '../../lib/media/mediaApi';
import { POSTER_FAILED_TEXT, useMediaUploadQueue, type UploadEntry } from './useMediaUploadQueue';

interface Props {
  sectionId: number;
  itemId: number | null;
  onUploaded: (asset: MediaAssetView) => void;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.tif,.tiff,.mp4,.mov,.webm,.heic,.heif';

function EntryRow({ entry, busy, onShot, onRemove }: { entry: UploadEntry; busy: boolean; onShot: (s: MediaShotType) => void; onRemove: () => void }) {
  const editable = entry.status === 'ready' || entry.status === 'failed';
  return (
    <li className="border border-slate-200 rounded-lg p-2 space-y-1.5" data-testid="media-upload-entry">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs font-bold text-slate-800 truncate" title={entry.file.name}>{entry.file.name}</span>
        <span className="text-[11px] text-slate-500">{formatPersianNumber(entry.file.size / (1024 * 1024), 1)} مگابایت</span>
        {editable ? (
          <select aria-label="نوع نما" value={entry.shotType} disabled={busy} onChange={e => onShot(e.target.value as MediaShotType)} className="h-7 rounded-md border border-slate-200 text-[11px] px-1">
            {MEDIA_SHOT_TYPES.map(t => <option key={t} value={t}>{MEDIA_SHOT_TYPE_LABELS[t]}</option>)}
          </select>
        ) : entry.kind && <span className="text-[11px] text-slate-500">{MEDIA_SHOT_TYPE_LABELS[entry.shotType]}</span>}
        {entry.status === 'done' && <CheckCircle2 size={16} className="text-emerald-600" aria-label="بارگذاری شد" />}
        {entry.status !== 'uploading' && !busy && (
          <button type="button" onClick={onRemove} aria-label="برداشتن از صف" className="p-1 text-slate-400 hover:text-rose-600"><X size={14} /></button>
        )}
      </div>
      {(entry.status === 'uploading' || entry.status === 'done') && (
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(entry.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
        </div>
      )}
      {entry.error && <p role="alert" className="text-[11px] font-semibold text-rose-600">{entry.error}</p>}
      {entry.warnings.map(w => (
        <p key={w} className="flex items-start gap-1 text-[11px] text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{MEDIA_WARNING_TEXT[w]}</p>
      ))}
      {entry.posterFailed && <p className="text-[11px] text-amber-700">{POSTER_FAILED_TEXT}</p>}
    </li>
  );
}

/** Upload box of a product: drag and drop or pick several files, check them, then send one after another */
export function MediaUploadBox({ sectionId, itemId, onUploaded }: Props) {
  const queue = useMediaUploadQueue({ sectionId, itemId, onUploaded });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const waiting = queue.entries.filter(e => e.status === 'ready' || e.status === 'failed').length;
  const checking = queue.entries.some(e => e.status === 'checking');

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    queue.addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" aria-label="بارگذاری تصویر و فیلم">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 text-center ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
      >
        <UploadCloud size={28} className="text-blue-500" />
        <p className="text-sm font-bold text-slate-700">تصویر یا فیلم را اینجا رها کنید</p>
        <p className="text-[11px] text-slate-500">تصویر JPG، PNG، WEBP یا TIFF و فیلم MP4، MOV یا WEBM، هر فایل حداکثر ۵۰ مگابایت</p>
        <button type="button" onClick={() => inputRef.current?.click()} className="px-4 h-8 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">انتخاب فایل</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="media-upload-input"
          onChange={e => { queue.addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
      </div>

      {queue.entries.length > 0 && (
        <>
          <ul className="space-y-2">
            {queue.entries.map(entry => (
              <EntryRow key={entry.key} entry={entry} busy={queue.isUploading} onShot={s => queue.setShotType(entry.key, s)} onRemove={() => queue.removeEntry(entry.key)} />
            ))}
          </ul>
          <div className="flex gap-2 justify-end">
            <button type="button" disabled={queue.isUploading} onClick={queue.clearFinished} className="px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 disabled:opacity-40">پاک کردن انجام‌شده‌ها</button>
            <button type="button" disabled={queue.isUploading || checking || waiting === 0} onClick={() => void queue.uploadAll()} className="px-4 h-8 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-40">
              {queue.isUploading ? 'در حال بارگذاری...' : `بارگذاری ${formatPersianNumber(waiting)} فایل`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
