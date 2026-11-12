import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontDiscountCodes, storefrontDiscountRedemptions, storefrontOrders } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { money } from '../../lib/money.js';
import { tomanText } from '../../lib/storefront/storefrontOrderRules.js';
import { discountAmountOf, isDiscountKind, normalizeDiscountCode } from '../../lib/storefront/storefrontDiscountRules.js';
import type { AppliedDiscount } from '../../lib/storefront/storefrontDiscountContracts.js';
import type { AccountRecord, GroupRecord } from './storefrontBuyerAuth.service.js';
import { rialText } from './storefrontShipping.service.js';

/**
 * v11 phase 8.2c (start plan §6, decision 6): whether a code applies to a cart and buyer, and the use it takes.
 *
 * - A code applies when it is live and active and inside its window; to a guest or retail account only when it is for
 *   retail buyers, to a group's buyer only when its group accepts discounts and the code is opened to that group; only
 *   to a signed-in account when it is «فقط برای دارندگان حساب»; only to a buyer's first order (no earlier order of the
 *   phone or the account that was not cancelled) when it is «فقط اولین خرید»; only from its minimum order (on the items
 *   at the buyer's prices); and only while it has uses left in all and for this buyer (the phone, and the account).
 * - The quote checks what it can know (it has no phone yet); placing the order checks everything again under the code's
 *   row lock and records the use in the same transaction, so two orders never take the last use.
 * - A cancelled order's use goes back (`releaseDiscount`).
 */
type CodeRecord = typeof storefrontDiscountCodes.$inferSelect;

export interface DiscountBuyer {
  account: AccountRecord | null;
  group: GroupRecord | null;
  /** the phone's match key; '' at a quote (the phone is not known yet); `email:<inbox>` for an email-proven order */
  phoneKey: string;
  /** 8e3 review: the mailbox of an email-proven order, whose earlier orders are found by it (not by the typed phone) */
  inboxKey?: string;
}

export interface DiscountChoice {
  code: CodeRecord;
  amount: bigint;
}

const refused = (message: string) => new ValidationError(message, { field: 'discountCode' }, 'STOREFRONT_DISCOUNT_NOT_APPLICABLE');
const NOT_FOUND = 'این کد تخفیف شناخته نیست یا دیگر کار نمی‌کند.';

async function usesOf(executor: DbExecutor, codeId: number, buyer?: DiscountBuyer): Promise<number> {
  const conditions = [eq(storefrontDiscountRedemptions.codeId, codeId), isNull(storefrontDiscountRedemptions.releasedAt)];
  if (buyer) {
    const mine = [
      ...(buyer.phoneKey ? [eq(storefrontDiscountRedemptions.phoneKey, buyer.phoneKey)] : []),
      ...(buyer.account ? [eq(storefrontDiscountRedemptions.buyerAccountId, buyer.account.id)] : []),
    ];
    if (mine.length === 0) return 0;
    conditions.push(mine.length === 1 ? mine[0] : or(...mine)!);
  }
  const [{ n }] = await executor.select({ n: sql<number>`count(*)::int` }).from(storefrontDiscountRedemptions).where(and(...conditions));
  return Number(n);
}

async function hasEarlierOrder(executor: DbExecutor, buyer: DiscountBuyer): Promise<boolean> {
  const mine = [
    ...(buyer.inboxKey ? [sql`regexp_replace(${storefrontOrders.emailKey}, '[+][^@]*@', '@') = ${buyer.inboxKey}`]
      : buyer.phoneKey ? [and(eq(storefrontOrders.phoneKey, buyer.phoneKey), eq(storefrontOrders.emailKey, ''))!] : []),
    ...(buyer.account ? [eq(storefrontOrders.buyerAccountId, buyer.account.id)] : []),
  ];
  if (mine.length === 0) return false;
  const [found] = await executor.select({ id: storefrontOrders.id }).from(storefrontOrders)
    .where(and(ne(storefrontOrders.status, 'cancelled'), mine.length === 1 ? mine[0] : or(...mine)!)).limit(1);
  return Boolean(found);
}

/**
 * The code and its amount for this cart and buyer, or a 422 on `discountCode` that says why not. `lock` (placing an
 * order, inside its transaction) takes the code's row lock first, so the uses counted stay true until the commit.
 */
export async function chooseDiscount(
  executor: DbExecutor, raw: unknown, itemsAmount: string, buyer: DiscountBuyer, options: { lock?: boolean } = {},
): Promise<DiscountChoice> {
  const typed = normalizeDiscountCode(raw);
  if (!typed) throw refused(NOT_FOUND);
  const query = executor.select().from(storefrontDiscountCodes)
    .where(and(eq(storefrontDiscountCodes.code, typed), eq(storefrontDiscountCodes.isDeleted, 0)));
  const [code] = options.lock ? await query.for('update') : await query;
  if (!code || code.isActive !== 1 || !isDiscountKind(code.kind)) throw refused(NOT_FOUND);

  const [{ open }] = (await executor.execute(sql`
    SELECT (${code.startsAt}::timestamptz IS NULL OR ${code.startsAt}::timestamptz <= now())
       AND (${code.endsAt}::timestamptz IS NULL OR ${code.endsAt}::timestamptz > now()) AS open`)).rows as Array<{ open: boolean }>;
  if (!open) throw refused('مهلت این کد تخفیف نرسیده یا گذشته است.');

  if (buyer.group) {
    if (buyer.group.acceptsDiscounts !== 1 || !(code.groupIds ?? []).includes(buyer.group.id)) throw refused('این کد تخفیف برای گروه خرید شما نیست.');
  } else if (code.forRetail !== 1) {
    throw refused('این کد تخفیف فقط برای خریداران عمده است.');
  }
  if (code.accountsOnly === 1 && !buyer.account) throw refused('این کد تخفیف فقط برای دارندگان حساب است؛ نخست وارد حساب خود شوید.');
  if (code.firstOrderOnly === 1 && await hasEarlierOrder(executor, buyer)) throw refused('این کد تخفیف فقط برای نخستین خرید است.');

  const minimum = BigInt(rialText(code.minOrderAmount));
  if (BigInt(itemsAmount) < minimum) {
    throw refused(`این کد تخفیف از خرید ${tomanText(minimum.toString())} تومان به بالا کار می‌کند.`);
  }
  if (code.usageLimit > 0 && await usesOf(executor, code.id) >= code.usageLimit) throw refused('ظرفیت این کد تخفیف تمام شده است.');
  if (code.perBuyerLimit > 0 && await usesOf(executor, code.id, buyer) >= code.perBuyerLimit) {
    throw refused('شما پیش‌تر از این کد تخفیف استفاده کرده‌اید.');
  }
  const amount = discountAmountOf({ kind: code.kind, percent: code.percent, amount: rialText(code.amount), maxDiscount: rialText(code.maxDiscount) }, itemsAmount);
  if (amount <= 0n) throw refused('این کد تخفیف روی این سبد مبلغی کم نمی‌کند.');
  return { code, amount };
}

export const appliedDiscount = (code: string, title: string, amount: string): AppliedDiscount => ({
  code, title, amount, amountToman: tomanText(amount),
});

/** The use of a code by a placed order, in the order's transaction */
export async function redeemDiscount(executor: DbExecutor, choice: DiscountChoice, order: { id: number; phoneKey: string; buyerAccountId: number | null }): Promise<void> {
  await executor.insert(storefrontDiscountRedemptions).values({
    codeId: choice.code.id, orderId: order.id, phoneKey: order.phoneKey, buyerAccountId: order.buyerAccountId, amount: money(choice.amount.toString()),
  });
}

/** A cancelled order gives its use back (nothing when it used no code, or already gave it back) */
export async function releaseDiscount(executor: DbExecutor, orderId: number): Promise<void> {
  await executor.update(storefrontDiscountRedemptions).set({ releasedAt: sql`now()` })
    .where(and(eq(storefrontDiscountRedemptions.orderId, orderId), isNull(storefrontDiscountRedemptions.releasedAt)));
}
