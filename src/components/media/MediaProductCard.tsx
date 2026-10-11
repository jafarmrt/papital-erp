import { Link } from 'react-router-dom';
import { AlertTriangle, ImageOff, Image as ImageIcon, Film } from 'lucide-react';
import { formatPersianCode, formatPersianNumber } from '../../utils';
import { mediaFileUrl, type MediaProductRow } from '../../lib/media/mediaApi';

/** One product of the media library grid: its cover thumbnail, counts and a low quality badge */
export function MediaProductCard({ row }: { row: MediaProductRow }) {
  return (
    <Link
      to={`/media-library/products/${row.itemId}`}
      className="group bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-md hover:border-blue-300 transition flex flex-col"
    >
      <div className="relative aspect-square bg-slate-50 flex items-center justify-center">
        {row.coverAssetId && row.coverHasThumb ? (
          <img src={mediaFileUrl(row.coverAssetId, 'thumb')} alt={row.name} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <ImageOff size={36} className="text-slate-300" aria-label="بی‌تصویر" />
        )}
        {row.lowQualityCount > 0 && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5">
            <AlertTriangle size={11} /> {formatPersianNumber(row.lowQualityCount)} کیفیت پایین
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <span className="text-[11px] font-mono text-slate-500">{formatPersianCode(row.code)}</span>
        <span className="text-sm font-bold text-slate-800 line-clamp-2">{row.name}</span>
        {row.collections.length > 0 && (
          <span className="text-[11px] text-slate-500 truncate">{row.collections.join('، ')}</span>
        )}
        <div className="mt-auto pt-2 flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1"><ImageIcon size={12} /> {formatPersianNumber(row.imageCount)}</span>
          <span className="inline-flex items-center gap-1"><Film size={12} /> {formatPersianNumber(row.videoCount)}</span>
        </div>
      </div>
    </Link>
  );
}

interface PagerProps {
  page: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}

export function MediaPager({ page, total, limit, onPage }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-2 py-2" aria-label="صفحه‌بندی">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">قبلی</button>
      <span className="text-xs text-slate-600">صفحه {formatPersianNumber(page)} از {formatPersianNumber(pages)}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">بعدی</button>
    </nav>
  );
}
