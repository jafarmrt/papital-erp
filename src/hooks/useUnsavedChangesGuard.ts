import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmAction } from '../components/ConfirmDialogHost';

/**
 * v10.2.x (10.2 package 2, production projects review U2): a page whose form holds changes not yet saved asks before
 * the work is thrown away. Before, the project window's three tabs with their own save button dropped their changes
 * without a word when another tab was opened, the window was closed or Esc was pressed.
 *
 * While `dirty` is true:
 * - closing or reloading the browser tab asks the browser's own question;
 * - a click on a link of this application (the menu, the bottom bar, a link on the page) asks first and follows the
 *   link only after «بی ذخیره برو»;
 * - the browser's back button (and a phone's back gesture) asks too: the guard puts one extra entry of the same
 *   address on the history (`GUARD_ENTRY_KEY`), so «back» first lands on the page itself and is caught; «می‌مانم»
 *   puts the entry back, «بی ذخیره برو» goes back for real;
 * - code that moves elsewhere itself (the global search, a notification) awaits `confirmLeaveIfDirty()` first and
 *   navigates with `leaveNavigateOptions()`, so the extra entry is replaced instead of left behind.
 * The application uses `BrowserRouter`, which has no navigation blocker, hence this guard.
 */
export const UNSAVED_CHANGES_TITLE = 'تغییرهای ذخیره‌نشده';
export const UNSAVED_CHANGES_MESSAGE = 'تغییرهای این بخش هنوز ذخیره نشده‌اند و اگر بروید از دست می‌روند. بی ذخیره می‌روید؟';
export const UNSAVED_CHANGES_LEAVE = 'بی ذخیره برو';
export const UNSAVED_CHANGES_STAY = 'می‌مانم';

export function confirmLeaveUnsaved(): Promise<boolean> {
  return confirmAction({
    title: UNSAVED_CHANGES_TITLE,
    message: UNSAVED_CHANGES_MESSAGE,
    confirmText: UNSAVED_CHANGES_LEAVE,
    cancelText: UNSAVED_CHANGES_STAY,
  });
}

/** an in-app link the click would follow: same origin, same window, no modifier key */
function inAppLinkTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return next === current ? null : next;
}

/** the history state key of the extra entry the guard puts on the history while changes are unsaved */
export const GUARD_ENTRY_KEY = 'unsavedChangesGuard';

function onGuardEntry(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return !!state && typeof state === 'object' && state[GUARD_ENTRY_KEY] === true;
}

function pushGuardEntry(): void {
  const state = window.history.state as Record<string, unknown> | null;
  window.history.pushState({ ...(state && typeof state === 'object' ? state : {}), [GUARD_ENTRY_KEY]: true }, '', window.location.href);
}

/** how many mounted guards hold unsaved changes right now */
let dirtyGuards = 0;

/** true when the user may leave: nothing is unsaved, or the user chose «بی ذخیره برو» */
export async function confirmLeaveIfDirty(): Promise<boolean> {
  return dirtyGuards === 0 || confirmLeaveUnsaved();
}

/** the navigate options of a confirmed leave: replace the guard's extra entry instead of stacking on it */
export function leaveNavigateOptions(): { replace?: boolean } {
  return onGuardEntry() ? { replace: true } : {};
}

export function useUnsavedChangesGuard(dirty: boolean): void {
  const navigate = useNavigate();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return undefined;
    dirtyGuards += 1;
    let leaving = false;
    let asking = false;
    if (!onGuardEntry()) pushGuardEntry();

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // older browsers show their own question only when a value is set
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const target = inAppLinkTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmLeaveUnsaved().then(ok => {
        if (ok) {
          dirtyRef.current = false;
          void navigate(target, leaveNavigateOptions());
        }
      });
    };
    const onPopState = () => {
      // «back» left the extra entry and landed on the page itself
      if (leaving || asking || !dirtyRef.current || onGuardEntry()) return;
      asking = true;
      void confirmLeaveUnsaved().then(ok => {
        asking = false;
        if (ok) {
          leaving = true;
          dirtyRef.current = false;
          window.history.back();
        } else {
          pushGuardEntry();
        }
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick, true);
    return () => {
      dirtyGuards -= 1;
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onClick, true);
      // saved (or discarded) on the page: take the extra entry away again, so «back» needs one press
      if (!leaving && onGuardEntry()) window.history.back();
    };
  }, [dirty, navigate]);
}
