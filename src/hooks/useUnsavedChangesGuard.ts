import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmAction } from '../components/ConfirmDialogHost';

/**
 * v10.2.x (10.2 package 2, production projects review U2): a page whose form holds changes not yet saved asks before
 * the work is thrown away. Before, the project window's three tabs with their own save button dropped their changes
 * without a word when another tab was opened, the window was closed or Esc was pressed.
 *
 * While `dirty` is true: closing or reloading the browser tab asks the browser's own question, and a click on a link
 * of this application (the menu, the bottom bar, a link on the page) asks first and follows the link only after
 * «بی ذخیره برو». The browser's own back button is not stopped (the application's router cannot hold it); the page's
 * own «بازگشت» button asks through `confirmLeaveUnsaved`.
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

export function useUnsavedChangesGuard(dirty: boolean): void {
  const navigate = useNavigate();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return undefined;
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
          void navigate(target);
        }
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, navigate]);
}
