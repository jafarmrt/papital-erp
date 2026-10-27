import { formatPersianNumber } from '../../utils/persianNumber';
import type { WcFieldPushView } from './wcShopSync';

/**
 * v11 phase 6.5 (D-04 part D, decisions ت۴۴ to ت۴۶ and ت۵۶-۲), shared by the server and the WooCommerce tab. Two more
 * automatic sends of the minute worker, each behind its own setting, off by default:
 * - «ارسال تصویر شاخص» (`wc_image_push`): when an item's cover in the media library changes, its light WEBP becomes the
 *   featured image of the linked product (a variation's own image); the shop's gallery is kept, a product that already had
 *   an image on the first comparison only takes it as the baseline, and taking a cover away removes nothing from the shop
 *   (ت۴۵). The shop downloads the file from a short-lived signed address of the program (`wc_media_base_url`), never with a
 *   WordPress password (ت۴۶).
 * - «ارسال کالکشن‌ها» (`wc_collection_push`): an item's collections go to its simple or parent product as product tags; the
 *   program adds and removes only the tags it added itself and never touches the shop's other tags (ت۴۴).
 */
export const WC_IMAGE_PUSH_SETTING_KEY = 'wc_image_push';
export const WC_COLLECTION_PUSH_SETTING_KEY = 'wc_collection_push';
/** the program's public address the shop downloads the images from */
export const WC_MEDIA_BASE_URL_SETTING_KEY = 'wc_media_base_url';
/** images in one batch request (the shop downloads each one inside that request) and at most per run */
export const WC_IMAGE_BATCH_SIZE = 5;
export const WC_IMAGE_MAX_PRODUCTS = 20;
/** products whose tags one collection run sends */
export const WC_COLLECTION_MAX_PRODUCTS = 100;
/** a signed image address lives this long (ت۴۶: 10 to 15 minutes) */
export const WC_IMAGE_LINK_TTL_SECONDS = 15 * 60;
/** requests of one address to the public image route in a minute (a run sends at most `WC_IMAGE_MAX_PRODUCTS`) */
export const WC_SHOP_IMAGE_REQUESTS_PER_MINUTE = 60;
/** the ports WordPress downloads from (`wp_safe_remote_get`); '' is the scheme's own */
export const WC_MEDIA_BASE_PORTS = new Set(['', '80', '443', '8080']);

export function isMediaSendOn(value: unknown): boolean {
  return String(value ?? '').trim() === '1';
}

/**
 * The stored form of a public address (no trailing slash), or the Persian reason it cannot be one: http or https only, no
 * user, query or fragment, and a port WordPress downloads from. The server also refuses an internal address.
 */
export function checkMediaBaseUrl(raw: unknown): { url: string } | { error: string } {
  const text = String(raw ?? '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { error: 'نشانی عمومی برنامه معتبر نیست؛ نشانی کامل را با https:// بنویسید.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: 'نشانی عمومی برنامه باید با https:// یا http:// آغاز شود.' };
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { error: 'نشانی عمومی برنامه نام کاربری، پرسش (?) یا نشانه (#) نمی‌گیرد.' };
  }
  if (!WC_MEDIA_BASE_PORTS.has(parsed.port)) {
    return { error: 'وردپرس فقط از درگاه‌های ۸۰، ۴۴۳ و ۸۰۸۰ تصویر برمی‌دارد؛ نشانی عمومی برنامه را با یکی از این درگاه‌ها بنویسید.' };
  }
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

/** The collections of an item as compared with what was sent: letter case and order ignored, '' for none */
export function collectionsKey(names: readonly string[] | null | undefined): string {
  const list = (Array.isArray(names) ? names : []).map(n => String(n ?? '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
  return [...new Set(list)].sort().join('\n');
}

export interface WcImagePushView extends WcFieldPushView {
  /** the program's public address the shop downloads from ('' = not set) */
  baseUrl: string;
  /** `ERP_SECRETS_KEY` is set, so addresses can be signed */
  secretsReady: boolean;
  /** links whose cover changed and waits to be sent */
  pending: number;
  /** links whose shop image was never read (a catalog refresh reads it) */
  notRead: number;
}

export interface WcCollectionPushView extends WcFieldPushView {
  /** linked simple or parent products whose collections differ from what was sent */
  pending: number;
}

export const IMAGE_PUSH_ENABLE_CONFIRM = (pending: number) =>
  'از این پس هر بار جلد کالایی در کتابخانهٔ رسانه عوض شود، نسخهٔ سبک آن تصویر شاخص محصول وصل در سایت می‌شود و گالری سایت دست نمی‌خورد. '
  + 'محصولی که امروز در سایت تصویر دارد تا جلدش عوض نشود دست نمی‌خورد، و برداشتن جلد هیچ تصویری را از سایت پاک نمی‌کند. '
  + (pending > 0 ? `${formatPersianNumber(pending)} محصول بی‌تصویر یا با جلد تازه در دقیقه‌های بعد فرستاده می‌شود. ` : '')
  + 'روشن شود؟';

export const COLLECTION_PUSH_ENABLE_CONFIRM = (pending: number) =>
  'از این پس کالکشن‌های هر کالا برچسب محصول وصل آن در سایت می‌شود. برنامه فقط برچسب‌هایی را که خودش افزوده کم یا زیاد می‌کند '
  + 'و به برچسب‌های دیگر سایت دست نمی‌زند؛ برچسبی که در سایت نباشد ساخته می‌شود. '
  + (pending > 0 ? `برچسب‌های ${formatPersianNumber(pending)} محصول در دقیقه‌های بعد فرستاده می‌شود. ` : '')
  + 'روشن شود؟';
