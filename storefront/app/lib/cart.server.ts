import { ORDER_LINES_MAX, ORDER_LINE_QUANTITY_MAX } from '@erp/storefront/storefrontOrderRules';
import { STOREFRONT_SLUG_MAX } from '@erp/storefront/storefrontRules';
import { cookieOf, secure } from './account.server';

/**
 * v11 phase 8.2 (start plan §2): the cart lives in this app, in the `sf_cart` cookie, and holds only which products and
 * how many. It reserves nothing and carries no price: the ERP prices the cart again at the quote and at the order, so a
 * cookie a buyer edits by hand can only ask for other products, never another price.
 *
 * The cookie is httpOnly (the pages read it on the server, so every cart form works without JavaScript) and
 * `SameSite=Lax`, kept 30 days. Its value is `slug~quantity` lines joined by `|`, the whole thing URL-encoded; a cart
 * that would not fit in a cookie (about 4 KB) is refused rather than cut short.
 */
const CART_COOKIE = 'sf_cart';
const CART_MAX_AGE = 30 * 24 * 3600;
/** a browser keeps a cookie up to 4096 bytes with its name and attributes */
const CART_VALUE_MAX = 3600;

export interface CartLine {
  slug: string;
  quantity: number;
}

const validSlug = (slug: string) => slug.length > 0 && slug.length <= STOREFRONT_SLUG_MAX && !/[|~\u0000-\u001f]/.test(slug);

export function cartOf(request: Request): CartLine[] {
  const lines: CartLine[] = [];
  for (const part of cookieOf(request, CART_COOKIE).split('|')) {
    const at = part.lastIndexOf('~');
    if (at <= 0) continue;
    const slug = part.slice(0, at);
    const quantity = Number(part.slice(at + 1));
    if (!validSlug(slug) || !Number.isInteger(quantity) || quantity < 1) continue;
    if (lines.some(l => l.slug === slug)) continue;
    lines.push({ slug, quantity: Math.min(quantity, ORDER_LINE_QUANTITY_MAX) });
    if (lines.length >= ORDER_LINES_MAX) break;
  }
  return lines;
}

const encoded = (lines: CartLine[]) => encodeURIComponent(lines.map(l => `${l.slug}~${l.quantity}`).join('|'));

/** The cookie for these lines, or null when they would not fit */
export function cartCookie(lines: CartLine[]): string | null {
  if (!lines.length) return clearCartCookie();
  const value = encoded(lines);
  if (value.length > CART_VALUE_MAX) return null;
  return `${CART_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CART_MAX_AGE}${secure()}`;
}

export const clearCartCookie = () => `${CART_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

export const cartCount = (lines: CartLine[]) => lines.reduce((sum, l) => sum + l.quantity, 0);

/** A quantity as a form sent it (Persian digits too), within 1..99; NaN when it is not a whole number */
export function formQuantity(raw: FormDataEntryValue | null): number {
  const text = String(raw ?? '').trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (!/^\d{1,3}$/.test(text)) return Number.NaN;
  return Math.min(Number(text), ORDER_LINE_QUANTITY_MAX);
}

export type CartChange =
  | { kind: 'add'; slug: string; quantity: number }
  | { kind: 'set'; slug: string; quantity: number }
  | { kind: 'remove'; slug: string };

export const CART_FULL = `سبد بیش از ${ORDER_LINES_MAX.toLocaleString('fa-IR')} قلم کالا جا ندارد؛ نخست همین‌ها را سفارش دهید.`;

/** The cart after one change; null when it would hold too many lines */
export function changeCart(lines: CartLine[], change: CartChange): CartLine[] | null {
  if (!validSlug(change.slug)) return lines;
  if (change.kind === 'remove') return lines.filter(l => l.slug !== change.slug);
  const found = lines.find(l => l.slug === change.slug);
  if (!found) {
    if (lines.length >= ORDER_LINES_MAX) return null;
    return [...lines, { slug: change.slug, quantity: Math.min(change.quantity, ORDER_LINE_QUANTITY_MAX) }];
  }
  const quantity = Math.min(change.kind === 'add' ? found.quantity + change.quantity : change.quantity, ORDER_LINE_QUANTITY_MAX);
  return lines.map(l => (l.slug === change.slug ? { ...l, quantity } : l));
}
