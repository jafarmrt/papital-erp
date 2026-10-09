import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa';

/**
 * v10.0.16 (D-11، طرح MOBILE_WORKSHOP_PLAN.md، تصمیم ت۱۲ ب جعفر): برنامه روی گوشی نصب‌پذیر است (manifest و service worker
 * با vite-plugin-pwa). service worker فقط پوسته برنامه را نگه می‌دارد: HTML، CSS، قلم‌ها، آیکون‌ها و تکه‌های JS. هیچ پاسخ
 * `/api`، پیوست یا تصویر بارگذاری‌شده‌ای در حافظه گوشی نمی‌ماند، تا داده مالی و شخصی روی گوشی نماند و پس از «خروج» چیزی
 * باقی نماند. فقط پوسته از پیش بار می‌شود و تکه هر صفحه با نخستین باز شدنش.
 * نسخه تازه بی‌صدا جای قبلی را نمی‌گیرد: نوار «نسخه تازه آماده است» از کاربر می‌خواهد بارگذاری دوباره را بزند.
 */

export const PWA_APP_NAME = 'سامانه مدیریت کارگاه پاپیتال';
export const PWA_SHORT_NAME = 'پاپیتال';
export const PWA_THEME_COLOR = '#0f172a';
export const PWA_BACKGROUND_COLOR = '#f8fafc';

/** آیکون‌های برنامه نصب‌شده در `public/pwa/` (ساخته‌شده از `favicon.svg`) */
export const PWA_ICON_FILES = {
  any192: 'pwa/pwa-192x192.png',
  any512: 'pwa/pwa-512x512.png',
  maskable512: 'pwa/maskable-512x512.png',
  appleTouch180: 'pwa/apple-touch-icon-180x180.png',
} as const;

/** مسیرهای کارساز که هرگز به صفحه برنامه برگردانده نمی‌شوند و service worker به آن‌ها دست نمی‌زند */
export const PWA_NETWORK_ONLY_PATHS: readonly RegExp[] = [
  /^\/api(\/|$)/,
  /^\/uploads(\/|$)/,
  /^\/health(\/|$)/,
  /^\/metrics(\/|$)/,
];

/**
 * پوسته‌ای که هنگام نصب از پیش بار می‌شود: صفحه، ورودی و کتابخانه‌های مشترک، CSS، سه وزن قلمی که صفحه پیش‌بار می‌کند و
 * آیکون‌ها (حدود یک مگابایت). تکه هر صفحه با نخستین باز شدنش از شبکه می‌آید و برای دفعه بعد نگه داشته می‌شود.
 */
export const PWA_PRECACHE_PATTERNS: readonly string[] = [
  'index.html',
  'favicon.svg',
  'pwa/*.png',
  'fonts/vazirmatn/Vazirmatn-{Regular,Medium,Bold}.woff2',
  'assets/index-*.{js,css}',
  'assets/vendor-{react,query,icons}-*.js',
  'assets/common-components-*.js',
];

/** فایل‌های ساخت با نام هش‌دار (تکه‌های JS و CSS و قلم‌ها) که پس از نخستین بار در حافظه برنامه می‌مانند؛ هیچ داده کارسازی نیست */
export const PWA_STATIC_ASSET_URL = /^https?:\/\/[^/]+\/(assets|fonts)\/[^?#]+\.(js|css|woff2)$/;

export function pwaManifest(): Partial<ManifestOptions> {
  return {
    id: '/',
    name: PWA_APP_NAME,
    short_name: PWA_SHORT_NAME,
    description: 'سامانه یکپارچه مدیریت کارگاه و ERP پاپیتال',
    lang: 'fa',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    icons: [
      { src: `/${PWA_ICON_FILES.any192}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/${PWA_ICON_FILES.any512}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/${PWA_ICON_FILES.maskable512}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** گزینه‌های vite-plugin-pwa؛ vite.config.ts همین را می‌خواند و آزمون Vitest قاعده‌هایش را می‌سنجد */
export function pwaPluginOptions(): Partial<VitePWAOptions> {
  return {
    registerType: 'prompt',
    injectRegister: false,
    manifest: pwaManifest(),
    workbox: {
      // public/ را افزونه copy-public-assets پیش از این افزونه در dist کپی می‌کند (بی uploads)
      globPatterns: [...PWA_PRECACHE_PATTERNS],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [...PWA_NETWORK_ONLY_PATHS],
      cleanupOutdatedCaches: true,
      // فقط فایل‌های ساخت با نام هش‌دار؛ پاسخ‌های کارساز (API، پیوست، تصویر بارگذاری‌شده) هرگز در حافظه service worker نمی‌مانند
      runtimeCaching: [{
        // a RegExp, not a function: workbox copies a function's source into sw.js without its closure
        urlPattern: PWA_STATIC_ASSET_URL,
        handler: 'CacheFirst',
        options: {
          cacheName: 'papital-static-assets',
          expiration: { maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      }],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    },
    devOptions: { enabled: false },
  };
}
