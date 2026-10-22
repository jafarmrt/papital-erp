import { useLayoutEffect, useRef } from 'react';
import { useDialogEscape } from '../../lib/a11y/dialogEscapeStack';
import { useDialogFocus } from '../../lib/a11y/dialogFocus';

let generatedTitleIds = 0;

export interface DialogLayerProps {
  /** Closes the window; Esc calls it only when this window is the topmost one. */
  onClose: () => void;
  /** While true (a save in progress) Esc closes neither this window nor the one under it. */
  disabled?: boolean;
}

/**
 * Keyboard and screen-reader behaviour of a hand-built window (v10.1.30, TD-1277, Vibe Farsi
 * package 3b). Rendered as the first child of the `role="dialog"` overlay: Esc closes the topmost
 * window, and a window without `aria-label` / `aria-labelledby` is named by its first heading.
 */
export function DialogLayer({ onClose, disabled = false }: DialogLayerProps) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogEscape(onClose, true, disabled);
  useDialogFocus(dialogRef);

  useLayoutEffect(() => {
    const dialog = markerRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
    dialogRef.current = dialog;
    if (!dialog || dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) return;
    const heading = dialog.querySelector('h1, h2, h3, h4');
    if (!heading) return;
    if (!heading.id) {
      generatedTitleIds += 1;
      heading.id = `dialog-title-${generatedTitleIds}`;
    }
    dialog.setAttribute('aria-labelledby', heading.id);
  });

  return <span ref={markerRef} hidden />;
}
