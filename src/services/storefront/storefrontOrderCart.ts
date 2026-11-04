import type { DbExecutor } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { shippingQuote } from '../../lib/storefront/storefrontRules.js';
import { tomanText, type CartLineInput } from '../../lib/storefront/storefrontOrderRules.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import type { ShippingOption } from '../../lib/storefront/storefrontOrderContracts.js';
import { orderableItems, type OnSale } from './storefrontCatalog.service.js';
import type { GroupRecord } from './storefrontBuyerAuth.service.js';
import { pricesOf } from './storefrontItemData.js';
import { listShippingMethods, rialText } from './storefrontShipping.service.js';

/**
 * v11 phase 8.2a (start plan §4): a cart priced by the server. Only the slugs and quantities of the request are read; the
 * unit price is the item's price in the retail list now, every sum is whole rials in BigInt (never a float), and an item
 * that is not on sale refuses the whole cart with its slug, so the app can say which line to remove.
 */
export interface PricedLine {
  item: OnSale;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
}

export interface PricedCart {
  lines: PricedLine[];
  itemsAmount: string;
  /** the cart's weight in grams, or null when an item has no weight (a weight-priced method is then not offered) */
  weightGrams: number | null;
}

/**
 * v11 phase 8.2b part 2 (start plan §6): the buyer group an approved account orders with. Its price list replaces the
 * retail price, an item outside its collections or without a price in its list is not on sale to it, and its minimums
 * (each line's quantity, the items' amount before shipping) must be met.
 */
export type CartGroup = Pick<GroupRecord, 'priceList' | 'catalogScope' | 'collections' | 'minLineQuantity' | 'minOrderAmount'>;

export async function priceCart(executor: DbExecutor, settings: StorefrontSettingsInput, cart: readonly CartLineInput[], group: CartGroup | null = null): Promise<PricedCart> {
  const bySlug = await orderableItems(executor, settings, cart.map(l => l.slug));
  const groupPrices = group ? await pricesOf(executor, [...bySlug.values()].map(i => i.itemId), group.priceList) : null;
  const inGroup = (item: OnSale) => !group || ((group.catalogScope !== 'collections' || item.collections.some(c => (group.collections ?? []).includes(c)))
    && groupPrices!.has(item.itemId));
  const missing = cart.filter(l => !bySlug.has(l.slug) || !inGroup(bySlug.get(l.slug)!)).map(l => l.slug);
  if (missing.length > 0) {
    throw new ValidationError('برخی کالاهای سبد دیگر روی سایت فروخته نمی‌شوند؛ آن‌ها را از سبد بردارید.', { slugs: missing }, 'STOREFRONT_ITEM_NOT_ON_SALE');
  }
  if (group && group.minLineQuantity > 0) {
    const few = cart.filter(l => l.quantity < group.minLineQuantity).map(l => l.slug);
    if (few.length > 0) {
      throw new ValidationError(`در خرید عمده، تعداد هر کالا دست‌کم ${group.minLineQuantity.toLocaleString('fa-IR')} است.`, { slugs: few, minLineQuantity: group.minLineQuantity }, 'STOREFRONT_GROUP_MIN_LINE');
    }
  }
  let total = 0n;
  let weight = 0;
  let weightKnown = true;
  const lines = cart.map((l) => {
    const item = bySlug.get(l.slug)!;
    const unitPrice = groupPrices ? groupPrices.get(item.itemId)! : item.retailPrice;
    const lineAmount = BigInt(unitPrice) * BigInt(l.quantity);
    total += lineAmount;
    if (item.weight !== null && item.weight > 0) weight += item.weight * l.quantity;
    else weightKnown = false;
    return { item, quantity: l.quantity, unitPrice, lineAmount: lineAmount.toString() };
  });
  if (group) {
    const minimum = rialText(group.minOrderAmount);
    if (BigInt(minimum) > 0n && total < BigInt(minimum)) {
      throw new ValidationError(`حداقل مبلغ سفارش عمده ${tomanText(minimum)} تومان است.`, { minOrderAmount: minimum, itemsAmount: total.toString() }, 'STOREFRONT_GROUP_MIN_ORDER');
    }
  }
  return { lines, itemsAmount: total.toString(), weightGrams: weightKnown ? Math.ceil(weight) : null };
}

/**
 * The active methods this cart can use for a province, each with what it adds to the order. `subtotal` is what free
 * shipping is reckoned on: the items after a discount code (v11 phase 8.2c), the items' amount when none.
 */
export async function shippingOptions(
  executor: DbExecutor, settings: StorefrontSettingsInput, cart: PricedCart, province: string, subtotal: string = cart.itemsAmount,
): Promise<ShippingOption[]> {
  const methods = await listShippingMethods(executor, { activeOnly: true });
  const options: ShippingOption[] = [];
  for (const method of methods) {
    if (method.pricing === 'table' && cart.weightGrams === null) continue;
    const quote = shippingQuote(method, { province, weightGrams: cart.weightGrams ?? 0, subtotal }, settings.freeShippingThreshold);
    if (quote.kind === 'unavailable') continue;
    const base = { code: method.code, title: method.title, description: method.description };
    options.push(quote.kind === 'on_delivery'
      ? { ...base, kind: 'on_delivery', amount: '0', amountToman: '0', free: false }
      : { ...base, kind: 'cost', amount: quote.amount, amountToman: tomanText(quote.amount), free: quote.free });
  }
  return options;
}
