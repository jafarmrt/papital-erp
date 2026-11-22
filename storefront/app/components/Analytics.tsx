import { useEffect } from 'react';
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
 * from, the new address and title, then the view. One command a `push`, which both the array and Matomo's own object
 * take. False when no queue is there (the script never ran).
 */
export function matomoPageView(queue: unknown, page: { url: string; title: string; from: string }): boolean {
  if (!isMatomoQueue(queue)) return false;
  for (const command of [['setReferrerUrl', page.from], ['setCustomUrl', page.url], ['setDocumentTitle', page.title], ['trackPageView']]) {
    queue.push(command);
  }
  return true;
}

/**
 * The address of a page as a statistics service is told it: the site, the path and the query, never the part after
 * «#». That part is not a place on the site, and on «تعیین رمز» it is the one-time key of the link.
 */
export const reportedAddress = (location: { origin: string; pathname: string; search: string }): string => `${location.origin}${location.pathname}${location.search}`;

/**
 * Whether a page now on the screen is a move to tell Matomo of: not the first page of the document (the setup script
 * counts that one) and not the page already told.
 */
export const isLaterPage = (told: string, now: string): boolean => told !== '' && told !== now;

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
  // `discardHashTag`: nothing after «#» is ever sent. The first page's address and title are fixed here, when the page is
  // drawn: Matomo otherwise reads them when its script has loaded, and a buyer who has moved on by then would have the
  // second page counted twice and the first not at all.
  const setup = `var _paq=window._paq=window._paq||[];_paq.push(['discardHashTag',true]);_paq.push(['setCustomUrl',location.origin+location.pathname+location.search]);_paq.push(['setDocumentTitle',document.title]);_paq.push(['setTrackerUrl',${JSON.stringify(tracker)}]);_paq.push(['setSiteId',${JSON.stringify(config.id)}]);_paq.push(['enableLinkTracking']);_paq.push(['trackPageView']);`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: setup }} />
      <script async src={`${config.url}/matomo.js`} />
    </>
  );
}

/**
 * The address last told to Matomo in this document ('' = only the first page, which the setup script counts). It is kept
 * outside the component because the layout is drawn anew when a page fails («پیدا نشد») and again when the buyer moves
 * on, and a count kept inside would start over each time. It is touched only in an effect, so never on the server.
 */
let told = '';

/**
 * Matomo counts only the first page by itself; every later page a buyer moves to inside the site is told to it here.
 * (Until v12 phase 10 this looked for an array and found Matomo's own object once the script had loaded, so no later
 * page was ever counted.) It is part of the layout, so a «پیدا نشد» reached inside the site is counted, and so is the
 * page after it.
 */
export function MatomoPageViews() {
  const location = useLocation();
  useEffect(() => {
    const now = reportedAddress(window.location);
    const from = told;
    told = now;
    if (isLaterPage(from, now)) matomoPageView(window._paq, { url: now, title: document.title, from });
  }, [location.pathname, location.search]);
  return null;
}
