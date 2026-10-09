import { useCallback, useEffect, useState } from 'react';
import { isAbortError } from '../../api';
import { mediaErrorMessage, type MediaAssetView } from '../../lib/media/mediaApi';
import type { MediaViewerRights } from '../../lib/media/mediaAccess';
import {
  getMediaTags, hasSectionConditions, listSectionAssets, type MediaAssetPage, type MediaSection, type MediaSectionQuery,
} from '../../lib/media/mediaSectionsApi';
import { MediaGallery } from './MediaGallery';
import { MediaPager } from './MediaProductCard';
import { MediaSectionFiltersBar } from './MediaSectionFiltersBar';
import { MediaUploadBox } from './MediaUploadBox';

interface Props {
  section: MediaSection;
  query: MediaSectionQuery;
  rights: MediaViewerRights;
  onQuery: (next: MediaSectionQuery) => void;
  /** a file was added or removed, so the section counts are reloaded */
  onCountChanged: () => void;
}

/** v10.0.27 (N-05 PR 3): the files of one custom section: search conditions, gallery with paging and the upload box */
export function MediaSectionView({ section, query, rights, onQuery, onCountChanged }: Props) {
  const [result, setResult] = useState<MediaAssetPage | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tagsKey, setTagsKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getMediaTags(section.id, controller.signal)
      .then(setTags)
      .catch((err: unknown) => {
        if (!isAbortError(err)) setTags([]);
      });
    return () => controller.abort();
  }, [section.id, tagsKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listSectionAssets(section.id, query, controller.signal)
      .then(res => {
        setResult({ ...res, data: Array.isArray(res?.data) ? res.data : [] });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(mediaErrorMessage(err, 'دریافت فایل‌های بخش ناموفق بود.'));
        setLoading(false);
      });
    return () => controller.abort();
  }, [section.id, query]);

  const setAssets = useCallback((change: (assets: MediaAssetView[]) => MediaAssetView[], totalStep = 0) => {
    setResult(prev => (prev ? { ...prev, data: change(prev.data), total: prev.total + totalStep } : prev));
  }, []);
  const onUploaded = useCallback((asset: MediaAssetView) => {
    setAssets(list => [...list.filter(a => a.id !== asset.id), asset], 1);
    onCountChanged();
  }, [setAssets, onCountChanged]);
  const onChanged = useCallback((asset: MediaAssetView) => {
    setAssets(list => list.map(a => (a.id === asset.id ? asset : a)));
    setTagsKey(k => k + 1);
  }, [setAssets]);
  const onDeleted = useCallback((id: number) => {
    setAssets(list => list.filter(a => a.id !== id), -1);
    onCountChanged();
  }, [setAssets, onCountChanged]);
  const onListReplaced = useCallback((assets: MediaAssetView[]) => setAssets(() => assets), [setAssets]);

  const assets = result?.data ?? [];
  // the order route takes every live file of the section, so a move is offered only when this page holds them all
  const canReorder = !hasSectionConditions(query) && query.page === 1 && result !== null && assets.length === result.total;

  return (
    <div className="space-y-4">
      {section.description && <p className="text-xs text-slate-600">{section.description}</p>}
      <MediaSectionFiltersBar query={query} tags={tags} onChange={onQuery} />
      {(rights.canUpload || rights.canManage) && <MediaUploadBox sectionId={section.id} itemId={null} onUploaded={onUploaded} />}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {loading && !result ? (
        <div className="py-16 text-center text-sm text-slate-400">در حال بارگذاری...</div>
      ) : !error && (
        <div className={loading ? 'opacity-60' : ''}>
          <MediaGallery
            assets={[...assets].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)}
            rights={rights}
            onChanged={onChanged}
            onDeleted={onDeleted}
            sectionId={section.id}
            itemId={null}
            onListReplaced={onListReplaced}
            canReorder={canReorder}
            emptyText={hasSectionConditions(query) ? 'فایلی با این شرط‌ها یافت نشد.' : 'هنوز فایلی در این بخش بارگذاری نشده است.'}
          />
        </div>
      )}
      {result && <MediaPager page={result.page || query.page} total={result.total} limit={result.limit} onPage={p => onQuery({ ...query, page: p })} />}
    </div>
  );
}
