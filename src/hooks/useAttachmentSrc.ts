import { useEffect, useState } from 'react';
import { fetchAttachmentBlob, needsBearerFetch } from '../lib/attachments/attachmentDisplay';

/**
 * v7.0.100 (TD-224 بند ۲): نشانی قابل نمایش یک پیوست. با کوکی همان نشانی برگردانده می‌شود؛ در حالت توکن در حافظه
 * فایل با هدر Bearer دریافت و نشانی blob برگردانده می‌شود (تا رسیدن فایل undefined).
 */
export function useAttachmentSrc(url: string | undefined): string | undefined {
  const bearer = needsBearerFetch(url);
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setObjectUrl(undefined);
    if (!bearer || !url) return undefined;
    const controller = new AbortController();
    let created: string | undefined;
    fetchAttachmentBlob(url, controller.signal)
      .then(blob => {
        if (controller.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error('Attachment load failed:', err);
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, bearer]);

  return bearer ? objectUrl : url;
}
