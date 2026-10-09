import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../common/Modal';
import { MEDIA_SHOT_TYPES, MEDIA_SHOT_TYPE_LABELS, type MediaShotType } from '../../lib/media/mediaRules';
import { mediaErrorMessage, updateMediaAsset, type MediaAssetView } from '../../lib/media/mediaApi';

interface Props {
  asset: MediaAssetView;
  onClose: () => void;
  onSaved: (asset: MediaAssetView) => void;
}

const inputClass = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Title, description and shot type of one file */
export function MediaAssetEditModal({ asset, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(asset.title ?? '');
  const [description, setDescription] = useState(asset.description ?? '');
  const [shotType, setShotType] = useState<MediaShotType>(asset.shotType);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const saved = await updateMediaAsset(asset.id, { version: asset.version, title: title.trim(), description: description.trim(), shotType });
      toast.success('مشخصات فایل ذخیره شد.');
      onSaved(saved);
    } catch (err: unknown) {
      setError(mediaErrorMessage(err, 'ذخیره مشخصات فایل ناموفق بود.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="ویرایش مشخصات فایل" size="md">
      <form onSubmit={e => void submit(e)} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-600">عنوان</span>
          <input className={inputClass} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-600">نوع نما</span>
          <select className={inputClass} value={shotType} onChange={e => setShotType(e.target.value as MediaShotType)}>
            {MEDIA_SHOT_TYPES.map(t => <option key={t} value={t}>{MEDIA_SHOT_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-600">توضیح</span>
          <textarea className={inputClass} rows={3} value={description} maxLength={5000} onChange={e => setDescription(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={isSaving} className="px-4 h-9 rounded-lg border border-slate-200 text-sm font-bold text-slate-600">انصراف</button>
          <button type="submit" disabled={isSaving} className="px-4 h-9 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50">
            {isSaving ? 'در حال ذخیره...' : 'ذخیره'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
