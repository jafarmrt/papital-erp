import { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatPersianNumber } from '../../utils';
import { MEDIA_SHOT_TYPE_LABELS } from '../../lib/media/mediaRules';
import { mediaFileUrl, type MediaAssetView } from '../../lib/media/mediaApi';

interface Props {
  assets: MediaAssetView[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** Full view of one file of the gallery, with next / previous and a player for a video */
export function MediaLightbox({ assets, index, onIndex, onClose }: Props) {
  const asset = assets[index];
  const count = assets.length;
  const go = useCallback((step: number) => onIndex((index + step + count) % count), [index, count, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // right to left: the left arrow goes to the next file
      else if (e.key === 'ArrowLeft') go(1);
      else if (e.key === 'ArrowRight') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!asset) return null;
  const src = asset.kind === 'image' && asset.hasLight ? mediaFileUrl(asset.id, 'light') : mediaFileUrl(asset.id, 'original');

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label="نمایش فایل" dir="rtl">
      <div className="flex items-center justify-between p-3 text-white">
        <div className="text-sm">
          <span className="font-bold">{asset.title || asset.originalName}</span>
          <span className="mx-2 text-white/60">{MEDIA_SHOT_TYPE_LABELS[asset.shotType] ?? ''}</span>
          <span className="text-white/60">{formatPersianNumber(index + 1)} از {formatPersianNumber(count)}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="بستن" className="p-2 rounded-full hover:bg-white/10"><X size={22} /></button>
      </div>
      <div className="flex-1 flex items-center justify-center gap-2 px-2 min-h-0">
        {count > 1 && (
          <button type="button" onClick={() => go(-1)} aria-label="قبلی" className="p-2 rounded-full text-white hover:bg-white/10"><ChevronRight size={32} /></button>
        )}
        <div className="flex-1 h-full flex items-center justify-center min-h-0">
          {asset.kind === 'video' ? (
            <video key={asset.id} src={src} controls autoPlay className="max-h-full max-w-full" />
          ) : (
            <img key={asset.id} src={src} alt={asset.title || asset.originalName} className="max-h-full max-w-full object-contain" />
          )}
        </div>
        {count > 1 && (
          <button type="button" onClick={() => go(1)} aria-label="بعدی" className="p-2 rounded-full text-white hover:bg-white/10"><ChevronLeft size={32} /></button>
        )}
      </div>
      {asset.description && <p className="p-3 text-center text-sm text-white/80 whitespace-pre-line">{asset.description}</p>}
    </div>
  );
}
