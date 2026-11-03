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

declare global {
  interface Window { _paq?: unknown[][] }
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

/** Matomo counts only the first page by itself; every later page a buyer moves to inside the site is told to it here */
export function MatomoPageViews() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const paq = window._paq;
    if (!Array.isArray(paq)) return;
    paq.push(['setCustomUrl', window.location.href], ['setDocumentTitle', document.title], ['trackPageView']);
  }, [location.pathname, location.search]);
  return null;
}
