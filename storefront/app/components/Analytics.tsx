import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * v11 phase 8.5: the visit-statistics service the owner chose in the ERP («جست‌وجو و آمار بازدید»), only on the live site
 * (never on a preview or test address). The id and address were checked again on this server (`loadableAnalytics`) and are
 * written as JSON, so they cannot break out of the script. The page's security policy allows exactly that service's
 * addresses (`app/lib/csp.ts`).
 */
export interface AnalyticsConfig {
  provider: 'ga4' | 'matomo';
  id: string;
  url: string;
}

/**
 * Matomo's command queue. Before `matomo.js` has loaded it is the plain array the setup script made; once loaded,
 * Matomo puts its own object there, which is not an array and still takes commands through `push`.
 */
interface MatomoQueue { push: (command: unknown[]) => unknown }

declare global {
  interface Window { _paq?: unknown }
}

const isMatomoQueue = (value: unknown): value is MatomoQueue =>
  typeof value === 'object' && value !== null && typeof (value as { push?: unknown }).push === 'function';

/**
 * Tells Matomo of a page a buyer moved to inside the site, as its guide for single-page sites says: where they came
 * from, the new address and title, then the view; and the links of the new page are looked at again. One command a
 * `push`, which both the array and Matomo's own object take. False when no queue is there (the script never ran).
 */
export function matomoPageView(queue: unknown, page: { url: string; title: string; from: string }): boolean {
  if (!isMatomoQueue(queue)) return false;
  for (const command of [['setReferrerUrl', page.from], ['setCustomUrl', page.url], ['setDocumentTitle', page.title], ['trackPageView'], ['enableLinkTracking']]) {
    queue.push(command);
  }
  return true;
}

export function AnalyticsScripts({ config }: { config: AnalyticsConfig }) {
  if (config.provider === 'ga4') {
    // GA4 counts the pages a buyer moves to inside the site by itself (enhanced measurement, page changes)
    const setup = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(config.id)});`;
    return (
      <>
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.id)}`} />
        <script dangerouslySetInnerHTML={{ __html: setup }} />
      </>
    );
  }
  const tracker = `${config.url}/matomo.php`;
  const setup = `var _paq=window._paq=window._paq||[];_paq.push(['setTrackerUrl',${JSON.stringify(tracker)}]);_paq.push(['setSiteId',${JSON.stringify(config.id)}]);_paq.push(['enableLinkTracking']);_paq.push(['trackPageView']);`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: setup }} />
      <script async src={`${config.url}/matomo.js`} />
    </>
  );
}

/**
 * Matomo counts only the first page by itself; every later page a buyer moves to inside the site is told to it here.
 * (Until v12 phase 10 this looked for an array and found Matomo's own object once the script had loaded, so no later
 * page was ever counted.)
 */
export function MatomoPageViews() {
  const location = useLocation();
  const shown = useRef('');
  useEffect(() => {
    const from = shown.current;
    shown.current = window.location.href;
    // the first page is counted by the setup script
    if (from === '' || from === window.location.href) return;
    matomoPageView(window._paq, { url: window.location.href, title: document.title, from });
  }, [location.pathname, location.search]);
  return null;
}
