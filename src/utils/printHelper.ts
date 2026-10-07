import { useEffect, useCallback } from 'react';

export interface PrintOptions {
  printAreaClass?: string;
  documentTitle?: string;
  onBeforePrint?: () => void;
  onAfterPrint?: () => void;
}

/**
 * Universal safe print trigger for ERP V4.
 * Safely applies the printing-doc class to body so only .doc-print-area is rendered by the print engine.
 */
export function executePrint(options: PrintOptions = {}): void {
  const { documentTitle, onBeforePrint, onAfterPrint } = options;

  const originalTitle = document.title;
  if (documentTitle) {
    document.title = documentTitle;
  }

  if (onBeforePrint) {
    try {
      onBeforePrint();
    } catch (e) {
      console.error('[PrintHelper] onBeforePrint error:', e);
    }
  }

  // v9.0.300 (TD-684، B16-20): کلاسی که پنجره چاپ باز (`useDocumentPrint`) گذاشته بود همان‌جا می‌ماند، پاک‌سازی یک بار اجرا
  // می‌شود و عنوانی که پس از چاپ عوض شده دوباره نوشته نمی‌شود. پیش‌تر `afterprint` و زمان‌سنج ۲ ثانیه‌ای هر دو پاک‌سازی
  // می‌کردند: `onAfterPrint` دو بار صدا زده می‌شد و Ctrl+P بعدی با پنجره هنوز باز کل صفحه را چاپ می‌کرد.
  const classWasSet = document.body.classList.contains('printing-doc');
  document.body.classList.add('printing-doc');

  let done = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    window.removeEventListener('afterprint', cleanup);
    if (!classWasSet) document.body.classList.remove('printing-doc');
    if (documentTitle && document.title === documentTitle) {
      document.title = originalTitle;
    }
    if (onAfterPrint) {
      try {
        onAfterPrint();
      } catch (e) {
        console.error('[PrintHelper] onAfterPrint error:', e);
      }
    }
  };

  window.addEventListener('afterprint', cleanup);

  // Trigger standard browser print
  try {
    window.print();
  } catch (err) {
    console.error('[PrintHelper] window.print failed:', err);
    cleanup();
    return;
  }

  // Fallback cleanup only where the browser has no afterprint event (some embedded contexts)
  if (!done && !('onafterprint' in window)) fallbackTimer = setTimeout(cleanup, 2000);
}

/**
 * React hook to toggle printing-doc lifecycle when a print modal opens/closes.
 */
export function useDocumentPrint(isOpen: boolean) {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('printing-doc');
      return () => {
        document.body.classList.remove('printing-doc');
      };
    }
    return undefined;
  }, [isOpen]);

  const handlePrint = useCallback((title?: string) => {
    executePrint({ documentTitle: title });
  }, []);

  return { handlePrint };
}
