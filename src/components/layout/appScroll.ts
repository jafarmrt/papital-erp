/**
 * v11 phase 6.3b (U13): the page area of `AppLayout` is the one element that scrolls (the window does not), so code that
 * moved the page with `window.scrollTo` moves this element instead.
 */
export const APP_SCROLL_ATTRIBUTE = 'data-app-scroll';

/** The page area (`data-app-scroll` in `AppLayout`), or null outside the app frame (sign-in, setup, tests without the layout) */
export function appScrollArea(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[${APP_SCROLL_ATTRIBUTE}]`);
}

/** Back to the top of the page */
export function scrollAppToTop(behavior: ScrollBehavior = 'smooth'): void {
  const area = appScrollArea();
  if (area && typeof area.scrollTo === 'function') area.scrollTo({ top: 0, behavior });
  else if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior });
}
