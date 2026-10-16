/**
 * Esc closes only the topmost open window (v10.1.30, TD-1277, Vibe Farsi package 3b).
 *
 * Every window registers its close action here while it is open; one `keydown` listener on
 * `window` closes the last one registered. A control that handles Esc itself (an open menu, a
 * suggestion list, an account picker) calls `preventDefault()`, and then no window closes.
 */
import { useEffect, useRef } from 'react';

interface DialogEscapeEntry {
  close: () => void;
  blocked: () => boolean;
}

const openDialogs: DialogEscapeEntry[] = [];

function closeTopmostDialog(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = openDialogs[openDialogs.length - 1];
  if (!top) return;
  event.preventDefault();
  if (!top.blocked()) top.close();
}

/** Registers a window's close action; the returned function removes it. */
export function pushDialogEscape(close: () => void, blocked: () => boolean = () => false): () => void {
  const entry: DialogEscapeEntry = { close, blocked };
  openDialogs.push(entry);
  if (openDialogs.length === 1) window.addEventListener('keydown', closeTopmostDialog);
  return () => {
    const index = openDialogs.indexOf(entry);
    if (index >= 0) openDialogs.splice(index, 1);
    if (openDialogs.length === 0) window.removeEventListener('keydown', closeTopmostDialog);
  };
}

/** Number of windows that currently close on Esc (for tests). */
export function openDialogEscapeCount(): number {
  return openDialogs.length;
}

/**
 * Closes the window on Esc while it is `open` and the topmost window; while `blocked` (a save in
 * progress) Esc does nothing. The latest `onClose` and `blocked` are always read, and a window
 * keeps its place in the stack when it re-renders.
 */
export function useDialogEscape(onClose: () => void, open = true, blocked = false): void {
  const closeRef = useRef(onClose);
  const blockedRef = useRef(blocked);
  closeRef.current = onClose;
  blockedRef.current = blocked;
  useEffect(() => {
    if (!open) return undefined;
    return pushDialogEscape(
      () => closeRef.current(),
      () => blockedRef.current,
    );
  }, [open]);
}
