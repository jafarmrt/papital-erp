/**
 * Keyboard focus of an open window (v10.2.x, TD-1325, OBS-R1-37).
 *
 * While a window is open, Tab and Shift+Tab move only among the controls of the topmost window,
 * and closing it puts focus back where it was before it opened. Opening a window moves focus into
 * it only when focus is not already inside (a field with `autoFocus` keeps it); the window itself
 * then takes focus, not its first button, so Enter never presses «بستن» by accident. A list that a
 * window opens outside itself (a picker drawn on `document.body`) is never pulled back on a click;
 * only Tab is kept inside.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

const openWindows: Array<() => HTMLElement | null> = [];

/** The controls of a window that Tab can reach, in document order. */
export function focusableControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && !element.closest('[hidden]'));
}

function keepTabInside(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const root = openWindows[openWindows.length - 1]?.();
  if (!root) return;
  const controls = focusableControls(root);
  const active = document.activeElement as HTMLElement | null;
  if (controls.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  const inside = !!active && root.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first || active === root) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Registers a window for Tab; the returned function removes it. */
export function pushDialogFocus(getRoot: () => HTMLElement | null): () => void {
  openWindows.push(getRoot);
  if (openWindows.length === 1) document.addEventListener('keydown', keepTabInside);
  return () => {
    const index = openWindows.indexOf(getRoot);
    if (index >= 0) openWindows.splice(index, 1);
    if (openWindows.length === 0) document.removeEventListener('keydown', keepTabInside);
  };
}

/** Number of windows that currently keep Tab inside (for tests). */
export function openDialogFocusCount(): number {
  return openWindows.length;
}

/**
 * Keeps Tab inside the window `rootRef` points to while `open`, moves focus into it when it opens
 * and gives focus back to the element that had it when it closes.
 */
export function useDialogFocus(rootRef: RefObject<HTMLElement | null>, open = true): void {
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    returnTo.current = before instanceof HTMLElement && before !== document.body ? before : null;
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) {
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      if (!root.style.outline) root.style.outline = 'none';
      root.focus({ preventScroll: true });
    }
    const remove = pushDialogFocus(() => rootRef.current);
    return () => {
      remove();
      const target = returnTo.current;
      returnTo.current = null;
      if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
  }, [open, rootRef]);
}
