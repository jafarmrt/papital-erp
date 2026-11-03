import { cookieOf, secure } from './account.server';

/**
 * v11 phase 8.2: the tracking keys of the orders this browser placed, so the buyer comes back to an order page without
 * typing anything. The ERP answers an order only with its key in `X-Order-Key`, so the key never goes in an address: it
 * lives in the `sf_orders` cookie (httpOnly, `SameSite=Lax`, only under /orders, 60 days), the last ten orders.
 */
const ORDERS_COOKIE = 'sf_orders';
const ORDERS_MAX_AGE = 60 * 24 * 3600;
const KEPT_MAX = 10;
const NUMBER = /^\d{6,12}$/;
const KEY = /^ok_[A-Za-z0-9_-]{20,77}$/;

export const isOrderNumber = (value: string) => NUMBER.test(value);
export const isOrderKey = (value: string) => KEY.test(value);

function kept(request: Request): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const part of cookieOf(request, ORDERS_COOKIE).split('|')) {
    const [number, key] = part.split('.');
    if (number && key && isOrderNumber(number) && isOrderKey(key)) pairs.push([number, key]);
  }
  return pairs.slice(0, KEPT_MAX);
}

/** The key this browser keeps for an order ('' = none) */
export const orderKeyOf = (request: Request, number: string) => kept(request).find(([n]) => n === number)?.[1] ?? '';

/** The cookie with this order's key first */
export function rememberOrderCookie(request: Request, number: string, key: string): string {
  const pairs = [[number, key] as [string, string], ...kept(request).filter(([n]) => n !== number)].slice(0, KEPT_MAX);
  const value = encodeURIComponent(pairs.map(([n, k]) => `${n}.${k}`).join('|'));
  return `${ORDERS_COOKIE}=${value}; Path=/orders; HttpOnly; SameSite=Lax; Max-Age=${ORDERS_MAX_AGE}${secure()}`;
}

/**
 * When the buyer paid, as the ERP takes it (ISO): a day a few days back and a clock time, both on Tehran's clock
 * (UTC+03:30 all year since 1401). '' when the time is not a clock time.
 */
export function paidAtIso(daysAgo: number, time: string, now = Date.now()): string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))));
  if (!match || !Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > 30) return '';
  const offsetMs = 3.5 * 3600_000;
  const tehran = new Date(now + offsetMs);
  const utcMs = Date.UTC(tehran.getUTCFullYear(), tehran.getUTCMonth(), tehran.getUTCDate() - daysAgo, Number(match[1]), Number(match[2])) - offsetMs;
  return new Date(utcMs).toISOString();
}
