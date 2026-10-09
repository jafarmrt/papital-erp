import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { isAbortError } from '../api';
import { useHasAnyPermission, useHasPermission } from '../contexts/AuthContext';
import type { User } from '../types';
import { MediaProductInfoCard } from '../components/media/MediaProductInfoCard';
import { MediaGallery } from '../components/media/MediaGallery';
import { MediaUploadBox } from '../components/media/MediaUploadBox';
import { getMediaProduct, mediaErrorMessage, type MediaAssetView, type MediaProductDetail } from '../lib/media/mediaApi';
import { MEDIA_INFO_EDIT_KEYS, MEDIA_MANAGE_KEY, MEDIA_UPLOAD_KEYS } from '../lib/media/mediaAccess';

/** v10.0.22 (N-05 PR 2): one product of the media library: its card, gallery and upload box */
export default function MediaProductPage({ user }: { user?: User | null }) {
  const { itemId: itemIdParam } = useParams();
  const itemId = Number(itemIdParam);
  const canUpload = useHasAnyPermission(MEDIA_UPLOAD_KEYS);
  const canManage = useHasPermission(MEDIA_MANAGE_KEY);
  const canEditInfo = useHasAnyPermission(MEDIA_INFO_EDIT_KEYS);
  const [detail, setDetail] = useState<MediaProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      setError('شناسه محصول نامعتبر است.');
      return undefined;
    }
    const controller = new AbortController();
    setError(null);
    getMediaProduct(itemId, controller.signal)
      .then(res => setDetail({ ...res, assets: Array.isArray(res?.assets) ? res.assets : [] }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setError(mediaErrorMessage(err, 'دریافت محصول ناموفق بود.'));
      });
    return () => controller.abort();
  }, [itemId]);

  const onUploaded = useCallback((asset: MediaAssetView) => {
    setDetail(prev => (prev ? { ...prev, assets: [...prev.assets.filter(a => a.id !== asset.id), asset] } : prev));
  }, []);
  const onChanged = useCallback((asset: MediaAssetView) => {
    setDetail(prev => (prev ? { ...prev, assets: prev.assets.map(a => (a.id === asset.id ? asset : a)) } : prev));
  }, []);
  const onDeleted = useCallback((id: number) => {
    setDetail(prev => (prev ? { ...prev, assets: prev.assets.filter(a => a.id !== id) } : prev));
  }, []);

  return (
    <div className="space-y-4" dir="rtl">
      <Link to="/media-library" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
        <ArrowRight size={14} /> بازگشت به کتابخانه تصاویر و فیلم‌ها
      </Link>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {!detail && !error && <div className="py-16 text-center text-sm text-slate-400">در حال بارگذاری...</div>}
      {detail && (
        <>
          <MediaProductInfoCard item={detail.item} canEdit={canEditInfo} onSaved={item => setDetail(prev => (prev ? { ...prev, item } : prev))} />
          {canUpload && <MediaUploadBox sectionId={detail.productsSectionId} itemId={detail.item.id} onUploaded={onUploaded} />}
          <MediaGallery
            assets={[...detail.assets].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)}
            rights={{ canUpload, canManage, username: user?.username }}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
        </>
      )}
    </div>
  );
}
