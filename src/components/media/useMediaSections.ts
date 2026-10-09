import { useCallback, useEffect, useState } from 'react';
import { isAbortError } from '../../api';
import { mediaErrorMessage } from '../../lib/media/mediaApi';
import { listMediaSections, type MediaSection } from '../../lib/media/mediaSectionsApi';

/** v10.0.27 (N-05 PR 3): the sections of the media library in their stored order, reloaded after a change */
export function useMediaSections() {
  const [sections, setSections] = useState<MediaSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listMediaSections(controller.signal)
      .then(rows => {
        setSections([...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) setError(mediaErrorMessage(err, 'دریافت بخش‌های کتابخانه ناموفق بود.'));
      });
    return () => controller.abort();
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const replace = useCallback((rows: MediaSection[]) => {
    setSections([...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
  }, []);

  return { sections, error, reload, replace };
}
