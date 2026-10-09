import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import { confirmAction } from '../ConfirmDialogHost';
import { mediaErrorMessage, type MediaAssetView } from '../../lib/media/mediaApi';
import { MEDIA_WARNING_TEXT } from '../../lib/media/mediaRules';
import {
  copyMediaAssetToItemImage, movedIds, reorderMediaAssets, setMediaAssetCover,
} from '../../lib/media/mediaSectionsApi';
import {
  MEDIA_REPLACE_KIND_TEXT, posterFromVideo, precheckMediaFile, replaceAcceptOf, replaceMediaFileContent, uploadVideoPoster,
} from '../../lib/media/mediaUpload';

/** The item whose picture a product image may become; its version comes from the product page and returns updated */
export interface MediaItemImageTarget {
  version: number;
  onVersion: (version: number) => void;
}

export interface MediaGalleryActionsInput {
  /** files in the order the gallery shows them (grouped by shot type) */
  ordered: MediaAssetView[];
  sectionId: number;
  itemId: number | null;
  onListReplaced: (assets: MediaAssetView[]) => void;
  onChanged: (asset: MediaAssetView) => void;
  itemImage?: MediaItemImageTarget | null;
}

/**
 * The full id order after moving one file one place within its shot type group (the gallery shows groups, so «earlier»
 * is the previous file of the same group); null when it cannot move.
 */
export function orderAfterMove(ordered: MediaAssetView[], asset: MediaAssetView, step: -1 | 1): number[] | null {
  const groupIds = ordered.filter(a => a.shotType === asset.shotType).map(a => a.id);
  const next = movedIds(groupIds, asset.id, step);
  if (next === groupIds) return null;
  let k = 0;
  return ordered.map(a => (a.shotType === asset.shotType ? next[k++] : a.id));
}

/** v10.0.27 (N-05 PR 3): order, cover, replacement and item-picture actions of a gallery's files */
export function useMediaGalleryActions({ ordered, sectionId, itemId, onListReplaced, onChanged, itemImage }: MediaGalleryActionsInput) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<MediaAssetView | null>(null);

  const run = useCallback(async (id: number, work: () => Promise<void>, failText: string) => {
    setBusyId(id);
    try {
      await work();
    } catch (err: unknown) {
      toast.error(mediaErrorMessage(err, failText));
    } finally {
      setBusyId(null);
    }
  }, []);

  const move = useCallback((asset: MediaAssetView, step: -1 | 1) => {
    const ids = orderAfterMove(ordered, asset, step);
    if (!ids) return Promise.resolve();
    return run(asset.id, async () => {
      onListReplaced(await reorderMediaAssets({ sectionId, itemId, ids }));
    }, 'تغییر ترتیب فایل‌ها ناموفق بود.');
  }, [ordered, sectionId, itemId, onListReplaced, run]);

  const toggleCover = useCallback((asset: MediaAssetView) => run(asset.id, async () => {
    onListReplaced(await setMediaAssetCover(asset.id, !asset.isCover));
    toast.success(asset.isCover ? 'تصویر شاخص برداشته شد.' : 'تصویر شاخص محصول تعیین شد.');
  }, 'تعیین تصویر شاخص ناموفق بود.'), [onListReplaced, run]);

  const copyToItem = useCallback(async (asset: MediaAssetView) => {
    if (!itemImage) return;
    const ok = await confirmAction({
      title: 'عکس کالا',
      message: `نسخه سبک «${asset.title || asset.originalName}» عکس کالا در فهرست کالاها شود؟`,
      confirmText: 'استفاده',
      cancelText: 'انصراف',
    });
    if (!ok) return;
    await run(asset.id, async () => {
      const answer = await copyMediaAssetToItemImage(asset.id, itemImage.version);
      itemImage.onVersion(answer.version);
      toast.success('عکس کالا به‌روزرسانی شد.');
    }, 'به‌روزرسانی عکس کالا ناموفق بود.');
  }, [itemImage, run]);

  const startReplace = useCallback((asset: MediaAssetView) => {
    const input = replaceInputRef.current;
    if (!input) return;
    replaceTarget.current = asset;
    input.accept = replaceAcceptOf(asset.kind);
    input.click();
  }, []);

  const onReplaceFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replaceTarget.current;
    if (!file || !target) return;
    const check = await precheckMediaFile(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    if (check.kind !== target.kind) {
      toast.error(MEDIA_REPLACE_KIND_TEXT[target.kind]);
      return;
    }
    await run(target.id, async () => {
      const answer = await replaceMediaFileContent(target.id, file, check.type);
      let asset = answer.data;
      if (asset.kind === 'video') {
        try {
          const poster = await posterFromVideo(file);
          await uploadVideoPoster(asset.id, poster);
          asset = { ...asset, hasThumb: true, durationSeconds: poster.durationSeconds };
        } catch {
          toast.error('تصویر پیش‌نمایش فیلم ساخته نشد؛ فیلم جایگزین شده است.');
        }
      }
      onChanged(asset);
      toast.success('فایل با نسخه تازه جایگزین شد.');
      for (const w of answer.warnings ?? []) toast(MEDIA_WARNING_TEXT[w]);
    }, 'جایگزینی فایل ناموفق بود.');
  }, [onChanged, run]);

  return { busyId, move, toggleCover, copyToItem, startReplace, onReplaceFile, replaceInputRef };
}
