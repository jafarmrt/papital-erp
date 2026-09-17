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

  document.body.classList.add('printing-doc');

  const cleanup = () => {
    document.body.classList.remove('printing-doc');
    if (documentTitle) {
      document.title = originalTitle;
    }
    window.removeEventListener('afterprint', cleanup);
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
  }

  // Fallback cleanup in case afterprint does not fire (some browser iframe contexts)
  setTimeout(cleanup, 2000);
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
