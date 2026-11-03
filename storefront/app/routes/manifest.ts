import { brand } from '../lib/api.server';
import { BRAND } from '../lib/brand';
import { decodeDataUrl, imageVersion, pngSize } from '../lib/brandImage.server';
import { siteEnv } from '../lib/site.server';

/** The colours of the installed app: the white page and header of the site (app.css --background, --chrome), as the theme-color of every page */
export const PWA_THEME = { background: '#ffffff', theme: '#ffffff' } as const;

const DEFAULT_ICONS = [
  { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * The browser icon set in the ERP is the app icon when a phone can use it: an SVG (any size), or a square PNG of at
 * least 192 pixels. Anything else (a small or oblong PNG, a WEBP or JPG) leaves the shop's own icons in place.
 */
function iconsOf(favicon: string) {
  const image = decodeDataUrl(favicon);
  if (!image) return DEFAULT_ICONS;
  const src = `/brand/favicon?v=${imageVersion(favicon)}`;
  if (image.type === 'image/svg+xml') return [{ src, sizes: 'any', type: image.type, purpose: 'any' }, DEFAULT_ICONS[2]];
  const size = image.type === 'image/png' ? pngSize(image.bytes) : null;
  if (size && size.width === size.height && size.width >= 192) {
    return [{ src, sizes: `${size.width}x${size.height}`, type: image.type, purpose: 'any' }, DEFAULT_ICONS[2]];
  }
  return DEFAULT_ICONS;
}

/** The web app manifest: what a phone shows when the site is added to its home screen; none while the switch is off */
export async function loader() {
  if (!siteEnv().pwa) throw new Response('پیدا نشد', { status: 404 });
  const manifest = {
    name: BRAND.fullName,
    short_name: BRAND.name,
    description: BRAND.tagline,
    lang: 'fa-IR',
    dir: 'rtl',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: PWA_THEME.background,
    theme_color: PWA_THEME.theme,
    categories: ['shopping'],
    icons: iconsOf((await brand()).favicon),
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
