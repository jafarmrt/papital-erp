import { AlertTriangle, Download, Film, Image as ImageIcon, Loader2, Pencil, Trash2 } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { mediaFileUrl, type MediaAssetView } from '../../lib/media/mediaApi';

export const PREPARING_TEXT = 'در حال آماده‌سازی';
export const LIGHT_FAILED_TEXT = 'ساخت نسخه سبک ناموفق بود';

interface Props {
  asset: MediaAssetView;
  selected: boolean;
  canChange: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function sizeText(bytes: number): string {
  return `${formatPersianNumber(bytes / (1024 * 1024), 1)} مگابایت`;
}

const actionClass = 'inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-bold border border-slate-200 text-slate-700 hover:bg-slate-50';

/** One file of the product gallery with its downloads and, for its uploader or a manager, edit and delete */
export function MediaAssetTile({ asset, selected, canChange, onToggle, onOpen, onEdit, onDelete }: Props) {
  const preparing = asset.kind === 'image' && !asset.hasThumb && !asset.lightFailed;
  const name = asset.title || asset.originalName;
  return (
    <div className={`bg-white border rounded-xl overflow-hidden flex flex-col ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'}`} data-testid={`media-asset-${asset.id}`}>
      <div className="relative aspect-square bg-slate-50">
        <button type="button" onClick={onOpen} className="w-full h-full flex items-center justify-center" aria-label={`نمایش ${name}`}>
          {asset.hasThumb ? (
            <img src={mediaFileUrl(asset.id, 'thumb')} alt={name} loading="lazy" className="w-full h-full object-cover" />
          ) : asset.kind === 'video' ? (
            <Film size={36} className="text-slate-300" />
          ) : preparing ? (
            <span className="flex flex-col items-center gap-1 text-xs text-slate-500"><Loader2 size={20} className="animate-spin" />{PREPARING_TEXT}</span>
          ) : (
            <ImageIcon size={36} className="text-slate-300" />
          )}
        </button>
        <label className="absolute top-2 right-2 bg-white/90 rounded-md p-1 cursor-pointer">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`انتخاب ${name}`} />
        </label>
        {asset.kind === 'video' && asset.hasThumb && <Film size={18} className="absolute bottom-2 left-2 text-white drop-shadow" />}
        {asset.isLowQuality && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5">
            <AlertTriangle size={11} /> کیفیت پایین
          </span>
        )}
      </div>
      <div className="p-2 space-y-1.5 flex-1 flex flex-col">
        <span className="text-xs font-bold text-slate-800 truncate" title={name}>{name}</span>
        <span className="text-[11px] text-slate-500">{sizeText(asset.sizeBytes)}</span>
        {asset.lightFailed && <span className="text-[11px] font-semibold text-rose-600">{LIGHT_FAILED_TEXT}</span>}
        <div className="mt-auto flex flex-wrap gap-1">
          {asset.kind === 'image' && asset.hasLight && (
            <a href={mediaFileUrl(asset.id, 'light', true)} className={actionClass}><Download size={12} /> دانلود نسخه سبک</a>
          )}
          <a href={mediaFileUrl(asset.id, 'original', true)} className={actionClass}><Download size={12} /> دانلود نسخه اصلی</a>
          {canChange && (
            <>
              <button type="button" onClick={onEdit} className={actionClass}><Pencil size={12} /> ویرایش</button>
              <button type="button" onClick={onDelete} className={`${actionClass} text-rose-600`}><Trash2 size={12} /> حذف</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
