import { useCallback, useRef, useState } from 'react';
import type { MediaKind, MediaShotType, MediaWarning } from '../../lib/media/mediaRules';
import type { MediaAssetView } from '../../lib/media/mediaApi';
import {
  DEFAULT_SHOT_TYPE, MediaUploadError, posterFromVideo, precheckMediaFile, uploadMediaFile, uploadVideoPoster,
} from '../../lib/media/mediaUpload';

export type UploadStatus = 'checking' | 'ready' | 'refused' | 'uploading' | 'done' | 'failed';

export interface UploadEntry {
  key: number;
  file: File;
  type: string;
  kind: MediaKind | null;
  shotType: MediaShotType;
  status: UploadStatus;
  progress: number;
  error: string | null;
  warnings: MediaWarning[];
  posterFailed: boolean;
}

export const POSTER_FAILED_TEXT = 'تصویر پیش‌نمایش فیلم ساخته نشد؛ فیلم بارگذاری شده است.';

interface Target {
  sectionId: number;
  itemId: number | null;
  onUploaded: (asset: MediaAssetView) => void;
}

/** Files waiting in the upload box; each is checked on arrival and sent one after another with its own progress */
export function useMediaUploadQueue({ sectionId, itemId, onUploaded }: Target) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const nextKey = useRef(1);
  const latest = useRef<UploadEntry[]>([]);
  latest.current = entries;

  const patch = useCallback((key: number, change: Partial<UploadEntry>) => {
    setEntries(prev => prev.map(e => (e.key === key ? { ...e, ...change } : e)));
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const added: UploadEntry[] = files.map(file => ({
      key: nextKey.current++, file, type: '', kind: null, shotType: 'other', status: 'checking', progress: 0, error: null, warnings: [], posterFailed: false,
    }));
    setEntries(prev => [...prev, ...added]);
    for (const entry of added) {
      void precheckMediaFile(entry.file).then(check => {
        if (!check.ok) patch(entry.key, { status: 'refused', error: check.error });
        else patch(entry.key, { status: 'ready', type: check.type, kind: check.kind, shotType: DEFAULT_SHOT_TYPE[check.kind], warnings: check.warnings });
      });
    }
  }, [patch]);

  const setShotType = useCallback((key: number, shotType: MediaShotType) => patch(key, { shotType }), [patch]);
  const removeEntry = useCallback((key: number) => setEntries(prev => prev.filter(e => e.key !== key)), []);
  const clearFinished = useCallback(() => setEntries(prev => prev.filter(e => e.status !== 'done' && e.status !== 'refused')), []);

  const uploadAll = useCallback(async () => {
    setIsUploading(true);
    try {
      for (const entry of latest.current.filter(e => e.status === 'ready' || e.status === 'failed')) {
        if (!entry.kind) continue;
        patch(entry.key, { status: 'uploading', progress: 0, error: null });
        try {
          const answer = await uploadMediaFile(entry.file, entry.type, { sectionId, itemId, shotType: entry.shotType }, p => patch(entry.key, { progress: p }));
          let asset = answer.data;
          let posterFailed = false;
          if (asset.kind === 'video') {
            try {
              const poster = await posterFromVideo(entry.file);
              await uploadVideoPoster(asset.id, poster);
              asset = { ...asset, hasThumb: true, durationSeconds: poster.durationSeconds };
            } catch {
              posterFailed = true;
            }
          }
          patch(entry.key, { status: 'done', progress: 1, warnings: answer.warnings ?? entry.warnings, posterFailed });
          onUploaded(asset);
        } catch (err: unknown) {
          const message = err instanceof MediaUploadError || err instanceof Error ? err.message : 'بارگذاری فایل ناموفق بود.';
          patch(entry.key, { status: 'failed', error: message });
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [sectionId, itemId, onUploaded, patch]);

  return { entries, isUploading, addFiles, setShotType, removeEntry, clearFinished, uploadAll };
}
