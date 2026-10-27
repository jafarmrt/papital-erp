import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, items, mediaAssets, wcProductLinks } from '../../db/schema.js';
import { derivedSecretKey } from '../../lib/secretBox.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { isMediaSendOn, WC_IMAGE_LINK_TTL_SECONDS, WC_IMAGE_PUSH_SETTING_KEY } from '../../lib/woocommerce/wcMediaPush.js';

/**
 * v11 phase 6.5 (D-04 part D, decision ت۴۶): the short-lived signed address the shop downloads an item's cover from, so no
 * WordPress password is ever needed. The address names a product link and an expiry; its signature is an HMAC with a key
 * derived from `ERP_SECRETS_KEY` over the link, the expiry and the SHA-256 of the cover it was made for, so it cannot be
 * guessed or counted, and it dies when the cover changes. `GET /api/woocommerce/shop-image/<link>-<expiry>-<signature>.webp`
 * (public, limited per address) answers only the light WEBP of the cover of an item with a live link, only while the image
 * push is on and before the expiry; any other request is 404 (`NotFoundError`), the same for every reason.
 */
const PURPOSE = 'wc-shop-image';
const SIGNATURE_BYTES = 16;
const FILE_PATTERN = /^([1-9]\d{0,9})-([1-9]\d{9,10})-([A-Za-z0-9_-]{22})\.webp$/;

function signature(key: Buffer, linkId: number, expires: number, coverSha256: string): string {
  return crypto.createHmac('sha256', key).update(`${linkId}:${expires}:${coverSha256}`).digest().subarray(0, SIGNATURE_BYTES).toString('base64url');
}

/** The file name of a signed address, or null without a secrets key */
export function signedImageFile(linkId: number, coverSha256: string, nowMs: number = Date.now()): string | null {
  const key = derivedSecretKey(PURPOSE);
  if (!key) return null;
  const expires = Math.floor(nowMs / 1000) + WC_IMAGE_LINK_TTL_SECONDS;
  return `${linkId}-${expires}-${signature(key, linkId, expires, coverSha256)}.webp`;
}

export const SHOP_IMAGE_ROUTE = '/shop-image';

export function signedImageUrl(baseUrl: string, linkId: number, coverSha256: string, nowMs?: number): string | null {
  const file = signedImageFile(linkId, coverSha256, nowMs);
  return file ? `${baseUrl}/api/woocommerce${SHOP_IMAGE_ROUTE}/${file}` : null;
}

/** The live cover of an item that has a light version: its SHA-256 */
export async function coverOfItem(itemId: number): Promise<string | null> {
  const [cover] = await orm.select({ sha256: mediaAssets.sha256, lightBytes: mediaAssets.lightBytes }).from(mediaAssets)
    .where(and(eq(mediaAssets.itemId, itemId), eq(mediaAssets.isCover, 1), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image')))
    .limit(1);
  return cover && cover.lightBytes !== null ? cover.sha256 : null;
}

const notFound = () => new NotFoundError('پیدا نشد');

/** The light WEBP file a signed address names; every refusal is the same 404 */
export async function resolveShopImage(file: string, nowMs: number = Date.now()): Promise<string> {
  const match = FILE_PATTERN.exec(file);
  const key = derivedSecretKey(PURPOSE);
  if (!match || !key) throw notFound();
  const linkId = Number(match[1]);
  const expires = Number(match[2]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (expires < nowSeconds || expires > nowSeconds + WC_IMAGE_LINK_TTL_SECONDS) throw notFound();
  const [setting] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, WC_IMAGE_PUSH_SETTING_KEY));
  if (!isMediaSendOn(setting?.value)) throw notFound();
  const [link] = await orm.select({ itemId: wcProductLinks.itemId }).from(wcProductLinks)
    .innerJoin(items, eq(items.id, wcProductLinks.itemId))
    .where(and(eq(wcProductLinks.id, linkId), eq(wcProductLinks.isDeleted, 0), eq(items.isDeleted, 0)));
  if (!link) throw notFound();
  const sha256 = await coverOfItem(link.itemId);
  if (!sha256) throw notFound();
  const wanted = Buffer.from(signature(key, linkId, expires, sha256));
  const given = Buffer.from(match[3]);
  if (wanted.length !== given.length || !crypto.timingSafeEqual(wanted, given)) throw notFound();
  return mediaFilePath(sha256, 'light', 'webp');
}
