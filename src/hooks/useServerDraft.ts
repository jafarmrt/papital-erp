import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchJson } from '../api';
import toast from 'react-hot-toast';

export interface UseServerDraftOptions<T> {
  entityType: string;
  draftKey?: string;
  autoSaveIntervalMs?: number; // default: 10000ms (10 seconds)
  debounceMs?: number; // default: 2000ms
  onDraftLoaded?: (draftPayload: T, updatedAt: string) => void;
  enabled?: boolean;
  /**
   * v8.0.89 (TD-388): فرم خالی (مثلاً پس از ثبت و پاک شدن فرم) پیش‌نویس نمی‌سازد. پیش‌تر پاک شدن فرم پس از ثبت «تغییر»
   * دیده و پیش‌نویس تازه‌ای با تنظیمات همان سند ذخیره می‌شد که بار بعد بنر «بازیابی» را می‌آورد.
   */
  isEmpty?: (data: T) => boolean;
}

export function useServerDraft<T extends Record<string, any>>(
  currentData: T,
  options: UseServerDraftOptions<T>
) {
  const {
    entityType,
    draftKey = 'default',
    debounceMs = 2500,
    onDraftLoaded,
    enabled = true,
    isEmpty
  } = options;

  const [hasServerDraft, setHasServerDraft] = useState(false);
  const [serverDraftData, setServerDraftData] = useState<T | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [draftStatusText, setDraftStatusText] = useState<string>('');

  const debounceTimerRef = useRef<any>(null);
  const lastPayloadStringRef = useRef<string>('');
  const isInitialLoadRef = useRef<boolean>(true);

  // Check and fetch server draft on mount
  useEffect(() => {
    if (!enabled || !entityType) return;

    const controller = new AbortController();
    fetchJson(`/drafts/${entityType}?draftKey=${draftKey}`, { signal: controller.signal })
      .then((res: any) => {
        if (res?.draft?.payload && res.draft.isDeleted !== 1) {
          setHasServerDraft(true);
          setServerDraftData(res.draft.payload);
          setDraftUpdatedAt(res.draft.updatedAt);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.debug('No server draft found or load error:', err);
      });

    return () => {
      controller.abort();
    };
  }, [entityType, draftKey, enabled]);

  // Save draft function (manual or debounced)
  const saveDraft = useCallback(
    async (dataToSave: T, summary: string = '') => {
      if (!enabled || !entityType) return;

      const payloadString = JSON.stringify(dataToSave);
      // Skip if empty or identical to last saved payload
      if (!payloadString || payloadString === lastPayloadStringRef.current || isEmpty?.(dataToSave)) {
        return;
      }

      setIsSavingDraft(true);
      setDraftStatusText('در حال ذخیره پیش‌نویس در سرور...');

      try {
        await fetchJson('/drafts', {
          method: 'POST',
          body: JSON.stringify({
            entityType,
            draftKey,
            payload: dataToSave,
            summary
          })
        });

        lastPayloadStringRef.current = payloadString;
        setLastSavedTime(new Date());
        setDraftStatusText('پیش‌نویس در سرور ذخیره شد');
        setTimeout(() => setDraftStatusText(''), 4000);
      } catch (err: any) {
        setDraftStatusText('خطا در ذخیره پیش‌نویس');
      } finally {
        setIsSavingDraft(false);
      }
    },
    [entityType, draftKey, enabled, isEmpty]
  );

  // Discard / Clear draft
  const discardDraft = useCallback(async () => {
    if (!entityType) return;
    // v8.0.89 (TD-388): ذخیره زمان‌بندی‌شده‌ای که پیش از ثبت سند مانده بود، پیش‌نویس حذف‌شده را دوباره نمی‌سازد
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    try {
      await fetchJson(`/drafts/${entityType}?draftKey=${draftKey}`, {
        method: 'DELETE'
      });
      setHasServerDraft(false);
      setServerDraftData(null);
      setDraftUpdatedAt(null);
      lastPayloadStringRef.current = '';
      setDraftStatusText('پیش‌نویس سرور حذف شد');
      setTimeout(() => setDraftStatusText(''), 3000);
    } catch (err) {
      console.error('Error discarding server draft:', err);
    }
  }, [entityType, draftKey]);

  // Restore draft
  const restoreDraft = useCallback(() => {
    if (serverDraftData && onDraftLoaded) {
      onDraftLoaded(serverDraftData, draftUpdatedAt || '');
      // v8.0.89 (TD-388): همان پیش‌نویس بازیابی‌شده بی‌تغییر دوباره ذخیره نمی‌شود
      lastPayloadStringRef.current = JSON.stringify(serverDraftData);
      setHasServerDraft(false);
      toast.success('پیش‌نویس سرور با موفقیت بازیابی شد');
    }
  }, [serverDraftData, draftUpdatedAt, onDraftLoaded]);

  // Auto-save debounced effect
  useEffect(() => {
    if (!enabled || !entityType) return;

    // Skip the first render to avoid immediately saving default/empty form state
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void saveDraft(currentData);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [currentData, debounceMs, enabled, entityType, saveDraft]);

  return {
    hasServerDraft,
    serverDraftData,
    draftUpdatedAt,
    isSavingDraft,
    lastSavedTime,
    draftStatusText,
    saveDraft,
    discardDraft,
    restoreDraft
  };
}
