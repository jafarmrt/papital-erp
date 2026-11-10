import { useEffect } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useNavigation, useRouteLoaderData, type LinksFunction } from 'react-router';
import type { Route } from './+types/root';
import './app.css';
import { brand, facets, publicSettings } from './lib/api.server';
import { imageVersion } from './lib/brandImage.server';
import { siteEnv } from './lib/site.server';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { AnalyticsScripts, MatomoPageViews } from './components/Analytics';
import { siteSeo } from './lib/seo.server';
import { sessionOf } from './lib/account.server';
import { cartCount, cartOf } from './lib/cart.server';

export const links: LinksFunction = () => [
  { rel: 'preload', href: '/fonts/Vazirmatn-Regular.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: '/fonts/Vazirmatn-ExtraBold.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [f, settings, images, seo] = await Promise.all([facets(), publicSettings(), brand(), siteSeo()]);
  const env = siteEnv();
  return {
    categories: f.categories,
    collections: f.collections,
    shippingTitles: settings.shippingMethods.map(m => m.title),
    freeShippingThreshold: settings.freeShippingThreshold,
    whatsapp: settings.whatsapp ?? '',
    /** v11 phase 8.2: the site takes orders, so the cart and «افزودن به سبد» show */
    ordering: settings.ordering === true,
    cartCount: settings.ordering === true ? cartCount(cartOf(request)) : 0,
    /** a session cookie is there (it may have expired: /account then asks to sign in again) */
    signedIn: sessionOf(request) !== '',
    siteUrl: env.siteUrl,
    previewNotice: env.previewNotice,
    indexable: env.indexable,
    pwa: env.pwa,
    /** '' = none; otherwise the address of the image, versioned by its content */
    logoUrl: images.logo ? `/brand/logo?v=${imageVersion(images.logo)}` : '',
    faviconUrl: images.favicon ? `/brand/favicon?v=${imageVersion(images.favicon)}` : '',
    /** iOS takes only a bitmap as the home-screen icon */
    faviconIsBitmap: Boolean(images.favicon) && !images.favicon.startsWith('data:image/svg+xml'),
    seo,
  };
}

export type RootData = Awaited<ReturnType<typeof loader>>;
export const useRootData = () => useRouteLoaderData<RootData>('root');

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRootData();
  return (
    <html lang="fa" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
        {data && !data.indexable ? <meta name="robots" content="noindex, nofollow" /> : null}
        {data?.seo.verification.google ? <meta name="google-site-verification" content={data.seo.verification.google} /> : null}
        {data?.seo.verification.bing ? <meta name="msvalidate.01" content={data.seo.verification.bing} /> : null}
        <Meta />
        <Links />
        {data?.faviconUrl ? (
          <>
            <link rel="icon" href={data.faviconUrl} />
            {data.faviconIsBitmap ? <link rel="apple-touch-icon" href={data.faviconUrl} /> : null}
          </>
        ) : <link rel="icon" href="/favicon.svg" type="image/svg+xml" />}
        {data?.seo.analytics ? <AnalyticsScripts config={data.seo.analytics} /> : null}
        {data?.pwa ? (
          <>
            <link rel="manifest" href="/manifest.webmanifest" />
            {data.faviconIsBitmap ? null : <link rel="apple-touch-icon" href="/pwa/icon-192.png" />}
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-title" content="پاپیتال" />
          </>
        ) : null}
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-card focus:px-4 focus:py-2">پرش به محتوا</a>
        {data?.previewNotice ? (
          <p className="bg-brand px-4 py-2 text-center text-sm text-brand-foreground">{data.previewNotice}</p>
        ) : null}
        <SiteHeader categories={data?.categories ?? []} logoUrl={data?.logoUrl ?? ''} ordering={data?.ordering ?? false} cartCount={data?.cartCount ?? 0} signedIn={data?.signedIn ?? false} />
        <main id="main" className="flex-1">{children}</main>
        <SiteFooter data={data} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** A thin bar along the top while the next page loads, so a slow phone connection never looks frozen */
function NavigationProgress() {
  const busy = useNavigation().state !== 'idle';
  return (
    <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-right bg-primary transition-[opacity,scale] duration-500 ${busy ? 'scale-x-75 opacity-100' : 'scale-x-0 opacity-0'}`} />
  );
}

/**
 * The installable site's worker: registered while `STOREFRONT_PWA=1`; once the switch is off, the next visit removes
 * it from the phone, so nothing stays behind
 */
function useServiceWorker(enabled: boolean) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (enabled) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    else navigator.serviceWorker.getRegistrations().then(all => all.forEach(r => void r.unregister())).catch(() => undefined);
  }, [enabled]);
}

export default function App() {
  const data = useRootData();
  useServiceWorker(data?.pwa ?? false);
  return (
    <>
      <NavigationProgress />
      {data?.seo.analytics?.provider === 'matomo' ? <MatomoPageViews /> : null}
      <Outlet />
    </>
  );
}

// v12 phase 7: a page this boundary renders gets the headers of the root only, so the search limit's `Retry-After`
// (thrown with the 429 by /products) is passed on here; nothing else of a thrown response reaches the page
export function headers({ errorHeaders }: Route.HeadersArgs) {
  const headers = new Headers();
  const retryAfter = errorHeaders?.get('Retry-After');
  if (retryAfter) headers.set('Retry-After', retryAfter);
  return headers;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // v12 phase 7: one visitor's searches past the limit (the shop itself is fine)
  if (isRouteErrorResponse(error) && error.status === 429) {
    return (
      <section className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-extrabold">جست‌وجوی زیادی در یک دقیقه</h1>
        <p className="mt-3 text-muted-foreground">یک دقیقهٔ دیگر دوباره جست‌وجو کنید. دیدن محصولات و کالکشن‌ها همین حالا هم کار می‌کند.</p>
        <a href="/products" className="mt-8 inline-flex min-h-11 items-center rounded-control bg-primary px-6 font-medium text-primary-foreground">همهٔ محصولات</a>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-extrabold">{notFound ? 'این صفحه پیدا نشد' : 'فروشگاه الان در دسترس نیست'}</h1>
      <p className="mt-3 text-muted-foreground">
        {notFound
          ? 'شاید نشانی عوض شده یا این محصول دیگر روی سایت نیست.'
          : 'ارتباط با انبار برقرار نشد. چند دقیقهٔ دیگر دوباره سر بزنید.'}
      </p>
      <a href="/" className="mt-8 inline-flex min-h-11 items-center rounded-control bg-primary px-6 font-medium text-primary-foreground">بازگشت به صفحهٔ اصلی</a>
    </section>
  );
}
