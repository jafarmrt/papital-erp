import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive } from 'lucide-react';
import { confirmAction } from '../ConfirmDialogHost';
import { formatPersianNumber } from '../../utils';
import { MEDIA_SHOT_TYPES, MEDIA_SHOT_TYPE_LABELS } from '../../lib/media/mediaRules';
import { deleteMediaAsset, downloadMediaZip, mediaErrorMessage, MEDIA_ZIP_MAX_ASSETS, type MediaAssetView } from '../../lib/media/mediaApi';
import { canChangeAsset, type MediaViewerRights } from '../../lib/media/mediaAccess';
import { MediaAssetTile } from './MediaAssetTile';
import { MediaLightbox } from './MediaLightbox';
import { MediaAssetEditModal } from './MediaAssetEditModal';

interface Props {
  assets: MediaAssetView[];
  rights: MediaViewerRights;
  onChanged: (asset: MediaAssetView) => void;
  onDeleted: (id: number) => void;
}

/** Files of one product grouped by shot type, with group download, lightbox, edit and delete */
export function MediaGallery({ assets, rights, onChanged, onDeleted }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<MediaAssetView | null>(null);
  const [zipping, setZipping] = useState(false);

  const groups = useMemo(() => MEDIA_SHOT_TYPES
    .map(type => ({ type, items: assets.filter(a => a.shotType === type) }))
    .filter(g => g.items.length > 0), [assets]);
  const ordered = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const liveSelected = ordered.filter(a => selected.has(a.id)).map(a => a.id);

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const zip = async (variant: 'original' | 'light') => {
    if (liveSelected.length === 0) return;
    if (liveSelected.length > MEDIA_ZIP_MAX_ASSETS) {
      toast.error(`حداکثر ${formatPersianNumber(MEDIA_ZIP_MAX_ASSETS)} فایل در یک دانلود گروهی پذیرفته است.`);
      return;
    }
    setZipping(true);
    try {
      await downloadMediaZip(liveSelected, variant);
    } catch (err: unknown) {
      toast.error(mediaErrorMessage(err, 'ساخت فایل فشرده ناموفق بود.'));
    } finally {
      setZipping(false);
    }
  };

  const remove = async (asset: MediaAssetView) => {
    const ok = await confirmAction({
      title: 'حذف فایل',
      message: `فایل «${asset.title || asset.originalName}» حذف شود؟`,
      confirmText: 'حذف',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    try {
      await deleteMediaAsset(asset.id);
      toast.success('فایل حذف شد.');
      onDeleted(asset.id);
    } catch (err: unknown) {
      toast.error(mediaErrorMessage(err, 'حذف فایل ناموفق بود.'));
    }
  };

  if (assets.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-xl">هنوز تصویر یا فیلمی برای این محصول بارگذاری نشده است.</div>;
  }

  return (
    <section className="space-y-4" aria-label="تصویرها و فیلم‌های محصول">
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        <span className="text-xs text-slate-600">{formatPersianNumber(liveSelected.length)} فایل انتخاب شده</span>
        <button type="button" onClick={() => setSelected(new Set(ordered.map(a => a.id)))} className="text-xs font-bold text-blue-600 px-2">انتخاب همه</button>
        {liveSelected.length > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-bold text-slate-500 px-2">لغو انتخاب</button>}
        <div className="flex-1" />
        <button type="button" disabled={zipping || liveSelected.length === 0} onClick={() => void zip('light')} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">
          <Archive size={14} /> دانلود گروهی (zip) نسخه سبک
        </button>
        <button type="button" disabled={zipping || liveSelected.length === 0} onClick={() => void zip('original')} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-40">
          <Archive size={14} /> دانلود گروهی (zip) نسخه اصلی
        </button>
      </div>

      {groups.map(group => (
        <div key={group.type} className="space-y-2">
          <h2 className="text-sm font-black text-slate-700">{MEDIA_SHOT_TYPE_LABELS[group.type]} <span className="text-slate-400 font-semibold">({formatPersianNumber(group.items.length)})</span></h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {group.items.map(asset => (
              <MediaAssetTile
                key={asset.id}
                asset={asset}
                selected={selected.has(asset.id)}
                canChange={canChangeAsset(asset, rights)}
                onToggle={() => toggle(asset.id)}
                onOpen={() => setOpenIndex(ordered.indexOf(asset))}
                onEdit={() => setEditing(asset)}
                onDelete={() => void remove(asset)}
              />
            ))}
          </div>
        </div>
      ))}

      {openIndex !== null && <MediaLightbox assets={ordered} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />}
      {editing && (
        <MediaAssetEditModal asset={editing} onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); onChanged(saved); }} />
      )}
    </section>
  );
}
