import { siteEnv } from '../lib/site.server';

/**
 * The service worker of the installable site (`STOREFRONT_PWA=1`). It never keeps a page, a price or a stock figure:
 * pages and their data always come from the server, so a buyer never sees an old price. It keeps only files whose
 * address changes with their content (the build's /assets, product photos named by their hash) and the fonts and app
 * icons, and shows a small «no connection» page when a page cannot be reached. Bump CACHE_VERSION when a font or app
 * icon changes under the same name.
 */
const CACHE_VERSION = 1;

const OFFLINE_PAGE = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>اتصال برقرار نیست | گالری پاپیتال</title>
<style>
@font-face{font-family:Vazirmatn;src:url(/fonts/Vazirmatn-Regular.woff2) format("woff2");font-display:swap}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#162644;font-family:Vazirmatn,Tahoma,sans-serif;text-align:center}
main{max-width:22rem;padding:2rem 1rem}h1{font-size:1.4rem;margin:1rem 0 .5rem}p{line-height:1.9;color:#4b5563}
img{width:96px;height:96px}button{margin-top:1.5rem;min-height:44px;padding:0 1.5rem;border:0;border-radius:.5rem;background:#162644;color:#fff;font:inherit;cursor:pointer}
</style></head><body><main>
<img src="/pwa/icon-192.png" alt="">
<h1>اتصال به اینترنت برقرار نیست</h1>
<p>قیمت و موجودی همیشه تازه از فروشگاه خوانده می‌شوند، پس بدون اینترنت نشان داده نمی‌شوند. اتصال را بررسی کنید و دوباره تلاش کنید.</p>
<button type="button" onclick="location.reload()">تلاش دوباره</button>
</main></body></html>`;

const worker = `'use strict';
const STATIC = 'papital-static-v${CACHE_VERSION}';
const MEDIA = 'papital-media-v${CACHE_VERSION}';
const LIMITS = { [STATIC]: 80, [MEDIA]: 150 };
const OFFLINE = ${JSON.stringify(OFFLINE_PAGE)};
const PHOTO = /^\\/media\\/[0-9a-f]{64}(-thumb)?\\.webp$/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(cache => cache.addAll(['/pwa/icon-192.png', '/fonts/Vazirmatn-Regular.woff2'])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => !(key in LIMITS)).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function trim(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - LIMITS[name])).map(key => cache.delete(key)));
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone()).then(() => trim(name)).catch(() => undefined);
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })));
    return;
  }
  const path = url.pathname;
  if (path.startsWith('/assets/') || path.startsWith('/fonts/') || path.startsWith('/pwa/')) {
    event.respondWith(cacheFirst(request, STATIC));
  } else if (PHOTO.test(path)) {
    event.respondWith(cacheFirst(request, MEDIA));
  }
  // everything else (page data, prices, stock, the logo) goes to the network as if there were no worker
});
`;

export function loader() {
  if (!siteEnv().pwa) throw new Response('پیدا نشد', { status: 404 });
  return new Response(worker, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' },
  });
}
