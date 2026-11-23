import { useEffect } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useBlocker, useMatches, useNavigation, useRouteLoaderData, type LinksFunction } from 'react-router';
import type { Route } from './+types/root';
import './app.css';
import { brand, facets, menus, publicSettings, shopInfo } from './lib/api.server';
import { imageVersion } from './lib/brandImage.server';
import { siteEnv } from './lib/site.server';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { BottomNav, BottomNavSpace } from './components/BottomNav';
import { FloatingWhatsApp } from './components/FloatingWhatsApp';
import { DEFAULT_SHOP } from './lib/shopInfo';
import { AnalyticsScripts, MatomoPageViews } from './components/Analytics';
import { siteSeo } from './lib/seo.server';
import { sessionOf } from './lib/account.server';
import { cartCount, cartOf } from './lib/cart.server';
import { fixedText } from './lib/fixedText.server';
import { fixedTitle } from './lib/fixedText';
import { FixedIntro } from './components/FixedIntro';

export const links: LinksFunction = () => [
  { rel: 'preload', href: '/fonts/Vazirmatn-Regular.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: '/fonts/Vazirmatn-ExtraBold.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [f, settings, images, seo, menu, shop, notFoundText] = await Promise.all([
    facets(), publicSettings(), brand(), siteSeo(), menus(), shopInfo(), fixedText('fixed-not-found'),
  ]);
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
    /** v12 phase 9c: the menus of «فهرست‌های سایت»; a null place keeps the fixed menu */
    menus: menu,
    /** v12 phase 10a: «اطلاعات فروشگاه»: the brand's name, contact details, the footer's texts, the e-namad seal */
    shop,
    /** v12 phase 10c: the words the shop wrote for «پیدا نشد» (null = the words of this file); the page is drawn here, in `ErrorBoundary` */
    notFoundText,
  };
}

export type RootData = Awaited<ReturnType<typeof loader>>;
export const useRootData = () => useRouteLoaderData<RootData>('root');

/**
 * v12 phase 10c: a draft's preview (`/preview/<key>`) has the link's key in its address, and a statistics script reads
 * the address itself (`Referrer-Policy` does not stop it): no statistics service is loaded or told of that page. The
 * page is known by its route, not by how its address is spelled (`/PREVIEW/…` is the same route). The route makes
 * coming to it and leaving it a fresh load of the document, so a script loaded on another page is never running here.
 */
const useInPreview = () => useMatches().some(match => match.id === 'routes/pagePreview');

/**
 * Leaving a preview for another page of the site is a fresh load of that page, never a move inside the preview's
 * document (see `clientLoader` of `routes/pagePreview.tsx`). It is part of the layout, so it is there as well when the
 * preview's read failed and the page is this file's «پیدا نشد» or «در دسترس نیست».
 */
function PreviewLeaves() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => nextLocation.pathname !== currentLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') window.location.assign(`${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`);
  }, [blocker]);
  return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRootData();
  const inPreview = useInPreview();
  const shop = data?.shop ?? DEFAULT_SHOP;
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
        {data?.seo.analytics && !inPreview ? <AnalyticsScripts config={data.seo.analytics} /> : null}
        {data?.pwa ? (
          <>
            <link rel="manifest" href="/manifest.webmanifest" />
            {data.faviconIsBitmap ? null : <link rel="apple-touch-icon" href="/pwa/icon-192.png" />}
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-title" content={shop.brand.name} />
          </>
        ) : null}
      </head>
      <body>
        {inPreview ? <PreviewLeaves /> : null}
        {data?.seo.analytics?.provider === 'matomo' && !inPreview ? <MatomoPageViews /> : null}
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-card focus:px-4 focus:py-2">پرش به محتوا</a>
        {data?.previewNotice ? (
          <p className="bg-brand px-4 py-2 text-center text-sm text-brand-foreground">{data.previewNotice}</p>
        ) : null}
        <SiteHeader brand={shop.brand} categories={data?.categories ?? []} logoUrl={data?.logoUrl ?? ''} ordering={data?.ordering ?? false} cartCount={data?.cartCount ?? 0} signedIn={data?.signedIn ?? false}
          headerMenu={data?.menus.header ?? null} drawerMenu={data?.menus.drawer ?? null} />
        <main id="main" className="flex-1">{children}</main>
        <SiteFooter data={data} />
        <BottomNavSpace />
        <FloatingWhatsApp number={shop.whatsappFloat} />
        <BottomNav ordering={data?.ordering ?? false} cartCount={data?.cartCount ?? 0} signedIn={data?.signedIn ?? false} menu={data?.menus.bottom ?? null} />
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

/**
 * The title of a page that failed (the pages that work write their own): «پیدا نشد» with the words the shop wrote for
 * it, and never a page for a search engine.
 */
export function meta({ error, data }: Route.MetaArgs) {
  if (!error) return [];
  const status = isRouteErrorResponse(error) ? error.status : 0;
  const text = status === 404 ? data?.notFoundText : null;
  const brandName = data?.shop?.brand.fullName || DEFAULT_SHOP.brand.fullName;
  // each of the three pages `ErrorBoundary` draws has the title of its own heading
  const title = status === 404 ? (text?.seoTitle || fixedTitle(text, 'این صفحه پیدا نشد'))
    : status === 429 ? 'جست‌وجوی زیادی در یک دقیقه' : 'فروشگاه لحظه‌ای در دسترس نیست';
  return [
    { title: `${title} | ${brandName}` }, { name: 'robots', content: 'noindex' },
    ...(text?.seoDescription ? [{ name: 'description', content: text.seoDescription }] : []),
  ];
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const text = useRootData()?.notFoundText;
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
      <h1 className="text-2xl font-extrabold">{notFound ? fixedTitle(text, 'این صفحه پیدا نشد') : 'فروشگاه لحظه‌ای در دسترس نیست'}</h1>
      <div className="mt-3 text-muted-foreground">
        {notFound
          ? <FixedIntro text={text}><p>شاید نشانی عوض شده یا این محصول دیگر روی سایت نیست.</p></FixedIntro>
          : <p>چند دقیقهٔ دیگر دوباره سر بزنید.</p>}
      </div>
      <a href="/" className="mt-8 inline-flex min-h-11 items-center rounded-control bg-primary px-6 font-medium text-primary-foreground">بازگشت به صفحهٔ اصلی</a>
    </section>
  );
}
