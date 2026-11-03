import crypto from 'crypto';
import { AppError } from '../../errors/customErrors.js';
import { derivedSecretKey } from '../../lib/secretBox.js';

/**
 * v11 phase 8.2a (start plan §8): the buyer's tracking key of an order. The order row keeps only a random salt; the key is
 * an HMAC of the order number and the salt under a key derived from `ERP_SECRETS_KEY`, so neither the key nor anything
 * that rebuilds it is in the database, and a repeat of the same order request can still answer the same key. Without a
 * configured secrets key the site takes no order (503), rather than handing out a key the database alone could forge.
 */
const PURPOSE = 'storefront-order-access';
const PREFIX = 'ok_';
export const ACCESS_KEY_MAX = 80;

function secret(): Buffer {
  const key = derivedSecretKey(PURPOSE);
  if (!key) {
    throw new AppError('کلید رمزنگاری سرور تنظیم نشده است؛ سایت تا آن زمان سفارش نمی‌گیرد.', 503, 'STOREFRONT_SECRETS_KEY_MISSING');
  }
  return key;
}

export const newAccessSalt = (): string => crypto.randomBytes(16).toString('hex');

export function orderAccessKey(orderNumber: string, salt: string): string {
  return PREFIX + crypto.createHmac('sha256', secret()).update(`${orderNumber}:${salt}`).digest('base64url');
}

/** Whether a presented key is this order's key (constant time; a malformed key is simply wrong) */
export function isOrderAccessKey(orderNumber: string, salt: string, presented: string): boolean {
  if (!presented || presented.length > ACCESS_KEY_MAX || !presented.startsWith(PREFIX)) return false;
  const want = Buffer.from(orderAccessKey(orderNumber, salt));
  const got = Buffer.from(presented);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** The fingerprint of a normalized order request, to answer a repeat of the same request key */
export function requestHashOf(request: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex');
}
