import type { Request } from 'express';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerAccounts, storefrontBuyerGroups } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { userHasRoleOrPermission } from '../../middleware/authorize.js';
import { rialAmountText } from '../../lib/storefront/storefrontRules.js';
import {
  GROUP_COLLECTIONS_MAX, GROUP_DESCRIPTION_MAX, GROUP_MIN_LINE_QUANTITY_MAX, GROUP_TITLE_MAX, groupCodeError, isCatalogScope,
} from '../../lib/storefront/storefrontBuyerRules.js';
import type { BuyerGroupInput, BuyerGroupRow, BuyerGroupsView } from '../../lib/storefront/storefrontBuyerContracts.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import { rialText } from './storefrontShipping.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.2b (package 18, start plan §6, decision 5): the «گروه‌های خریدار» section of the «فروشگاه سایت» tab. A group
 * is a price policy of the site besides the retail one of the settings: its own ERP price list, minimums, payment methods
 * and visible products. Writes need `storefront.manage`, and choosing or changing a group's price list also
 * `products.edit_price` (the WooCommerce price rule), since it decides what a buyer pays. A save runs under the group's
 * version (a stale form is 409) with an audit row in the same transaction. A group with approved accounts is not deleted;
 * it is turned off, and its buyers fall back to retail prices.
 */
const SORT_MAX = 100_000;

type GroupRecord = typeof storefrontBuyerGroups.$inferSelect;

function rowOf(group: GroupRecord, accountCount: number): BuyerGroupRow {
  return {
    id: group.id, code: group.code, title: group.title, description: group.description, priceList: group.priceList,
    minOrderAmount: rialText(group.minOrderAmount), minLineQuantity: group.minLineQuantity, allowCard: group.allowCard === 1,
    allowOnAccount: group.allowOnAccount === 1, creditLimit: rialText(group.creditLimit),
    catalogScope: isCatalogScope(group.catalogScope) ? group.catalogScope : 'all', collections: group.collections ?? [],
    acceptsDiscounts: group.acceptsDiscounts === 1, isActive: group.isActive === 1, sortOrder: group.sortOrder, accountCount,
    version: group.version,
  };
}

async function accountCounts(executor: DbExecutor): Promise<Map<number, number>> {
  const rows = await executor.select({ groupId: storefrontBuyerAccounts.groupId, n: count() }).from(storefrontBuyerAccounts)
    .where(sql`${storefrontBuyerAccounts.groupId} IS NOT NULL`).groupBy(storefrontBuyerAccounts.groupId);
  return new Map(rows.map(r => [Number(r.groupId), Number(r.n)]));
}

/** The collections of the live finished products, to choose a group's visible products from */
export async function liveCollections(executor: DbExecutor): Promise<string[]> {
  const result = await executor.execute(sql`
    SELECT DISTINCT unnest(collections) AS name FROM items WHERE is_deleted = 0 AND type = 'product' ORDER BY 1`);
  return (result.rows as Array<{ name: unknown }>).map(r => String(r.name ?? '').trim()).filter(Boolean);
}

export async function listBuyerGroups(executor: DbExecutor): Promise<BuyerGroupsView> {
  const groups = await executor.select().from(storefrontBuyerGroups).where(eq(storefrontBuyerGroups.isDeleted, 0))
    .orderBy(asc(storefrontBuyerGroups.sortOrder), asc(storefrontBuyerGroups.id));
  const counts = await accountCounts(executor);
  return {
    groups: groups.map(g => rowOf(g, counts.get(g.id) ?? 0)),
    priceLists: await ItemPricingService.getPricingStrategies(executor),
    collections: await liveCollections(executor),
  };
}

const invalid = (message: string, code: string) => new ValidationError(message, undefined, code);

/** The group as it is stored, or the first reason it cannot be */
export function checkedBuyerGroup(input: BuyerGroupInput, priceLists: readonly string[], retailPriceList: string): BuyerGroupInput {
  const code = input.code.trim();
  const codeError = groupCodeError(code);
  if (codeError) throw invalid(codeError, 'STOREFRONT_GROUP_CODE_INVALID');
  const title = input.title.trim();
  if (!title) throw invalid('نام گروه لازم است.', 'STOREFRONT_GROUP_TITLE_REQUIRED');
  if (title.length > GROUP_TITLE_MAX) throw invalid(`نام گروه حداکثر ${GROUP_TITLE_MAX.toLocaleString('fa-IR')} نویسه است.`, 'STOREFRONT_GROUP_TITLE_TOO_LONG');
  const description = input.description.trim();
  if (description.length > GROUP_DESCRIPTION_MAX) {
    throw invalid(`توضیح گروه حداکثر ${GROUP_DESCRIPTION_MAX.toLocaleString('fa-IR')} نویسه است.`, 'STOREFRONT_GROUP_DESCRIPTION_TOO_LONG');
  }
  const priceList = input.priceList.trim();
  if (priceList && !priceLists.includes(priceList)) {
    throw invalid(`لیست قیمت «${priceList}» در تنظیمات قیمت‌گذاری نیست.`, 'STOREFRONT_PRICE_LIST_NOT_CONFIGURED');
  }
  if (priceList && priceList === retailPriceList) {
    throw invalid('لیست قیمت گروه باید جدا از لیست قیمت تکی سایت باشد؛ خریدار تکی همان قیمت را بی حساب هم می‌بیند.', 'STOREFRONT_GROUP_PRICE_LIST_RETAIL');
  }
  if (input.isActive && !priceList) throw invalid('گروه فعال لیست قیمت لازم دارد.', 'STOREFRONT_GROUP_PRICE_LIST_REQUIRED');
  const minOrderAmount = rialAmountText(input.minOrderAmount.trim() || '0', { allowZero: true });
  if (minOrderAmount === null) throw invalid('حداقل مبلغ سفارش باید مبلغ ریالی باشد؛ ۰ یعنی ندارد.', 'STOREFRONT_GROUP_MIN_ORDER_INVALID');
  const creditLimit = rialAmountText(input.creditLimit.trim() || '0', { allowZero: true });
  if (creditLimit === null) throw invalid('سقف اعتبار باید مبلغ ریالی باشد؛ ۰ یعنی ندارد.', 'STOREFRONT_GROUP_CREDIT_INVALID');
  if (!Number.isInteger(input.minLineQuantity) || input.minLineQuantity < 0 || input.minLineQuantity > GROUP_MIN_LINE_QUANTITY_MAX) {
    throw invalid(`حداقل تعداد هر کالا باید عدد درست ۰ تا ${GROUP_MIN_LINE_QUANTITY_MAX.toLocaleString('fa-IR')} باشد؛ ۰ یعنی ندارد.`, 'STOREFRONT_GROUP_MIN_LINE_INVALID');
  }
  if (!input.allowCard && !input.allowOnAccount) throw invalid('دست‌کم یک راه پرداخت را روشن کنید.', 'STOREFRONT_GROUP_PAYMENT_REQUIRED');
  if (!isCatalogScope(input.catalogScope)) throw invalid('دامنهٔ کالاهای گروه شناخته نیست.', 'STOREFRONT_GROUP_SCOPE_INVALID');
  const collections = input.catalogScope === 'collections'
    ? [...new Set(input.collections.map(c => c.trim()).filter(Boolean))]
    : [];
  if (input.catalogScope === 'collections' && collections.length === 0) {
    throw invalid('برای «فقط کالکشن‌های برگزیده» دست‌کم یک کالکشن انتخاب کنید.', 'STOREFRONT_GROUP_COLLECTIONS_REQUIRED');
  }
  if (collections.length > GROUP_COLLECTIONS_MAX) {
    throw invalid(`هر گروه حداکثر ${GROUP_COLLECTIONS_MAX.toLocaleString('fa-IR')} کالکشن دارد.`, 'STOREFRONT_GROUP_COLLECTIONS_TOO_MANY');
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > SORT_MAX) {
    throw invalid('ترتیب نمایش باید عدد درست صفر یا بزرگ‌تر باشد.', 'STOREFRONT_GROUP_SORT_INVALID');
  }
  return {
    code, title, description, priceList, minOrderAmount, minLineQuantity: input.minLineQuantity, allowCard: input.allowCard,
    allowOnAccount: input.allowOnAccount, creditLimit, catalogScope: input.catalogScope, collections,
    acceptsDiscounts: input.acceptsDiscounts, isActive: input.isActive, sortOrder: input.sortOrder,
  };
}

const columnsOf = (v: BuyerGroupInput) => ({
  code: v.code, title: v.title, description: v.description, priceList: v.priceList, minOrderAmount: money(v.minOrderAmount),
  minLineQuantity: v.minLineQuantity, allowCard: v.allowCard ? 1 : 0, allowOnAccount: v.allowOnAccount ? 1 : 0,
  creditLimit: money(v.creditLimit), catalogScope: v.catalogScope, collections: v.collections, acceptsDiscounts: v.acceptsDiscounts ? 1 : 0,
  isActive: v.isActive ? 1 : 0, sortOrder: v.sortOrder,
});

async function assertMayPrice(req: Request): Promise<void> {
  if (!(await userHasRoleOrPermission(req.user, 'products.edit_price'))) {
    throw new ForbiddenError('انتخاب لیست قیمت گروه، قیمتی را که خریدار می‌پردازد تعیین می‌کند؛ مجوز ویرایش قیمت کالا هم لازم است.', undefined, 'STOREFRONT_GROUP_PRICE_FORBIDDEN');
  }
}

async function refuseTakenCode(tx: DbExecutor, code: string, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontBuyerGroups.code, code), eq(storefrontBuyerGroups.isDeleted, 0)];
  if (exceptId !== undefined) conditions.push(ne(storefrontBuyerGroups.id, exceptId));
  const [taken] = await tx.select({ id: storefrontBuyerGroups.id }).from(storefrontBuyerGroups).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(`کد گروه «${code}» پیش‌تر به کار رفته است.`, undefined, 'STOREFRONT_GROUP_CODE_TAKEN');
}

async function checkedFor(executor: DbExecutor, input: BuyerGroupInput): Promise<BuyerGroupInput> {
  const priceLists = await ItemPricingService.getPricingStrategies(executor);
  const settings = await storefrontSettingValues(executor);
  return checkedBuyerGroup(input, priceLists, settings.retailPriceList);
}

const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');

export async function createBuyerGroup(req: Request, input: BuyerGroupInput): Promise<BuyerGroupRow> {
  const values = await checkedFor(orm, input);
  if (values.priceList) await assertMayPrice(req);
  const id = await orm.transaction(async (tx) => {
    await refuseTakenCode(tx, values.code);
    const [created] = await tx.insert(storefrontBuyerGroups).values({ ...columnsOf(values), createdBy: actorOf(req) })
      .returning({ id: storefrontBuyerGroups.id });
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: `buyer-group-${created.id}`,
      description: `گروه خریدار «${values.title}» ساخته شد`, details: { after: values },
    });
    return created.id;
  });
  return buyerGroupById(orm, id);
}

async function lockedGroup(tx: DbExecutor, id: number, expectedVersion: number): Promise<GroupRecord> {
  const [group] = await tx.select().from(storefrontBuyerGroups)
    .where(and(eq(storefrontBuyerGroups.id, id), eq(storefrontBuyerGroups.isDeleted, 0))).for('update');
  if (!group) throw new NotFoundError('گروه خریدار پیدا نشد.', undefined, 'STOREFRONT_GROUP_NOT_FOUND');
  if (group.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontBuyerGroup', entityId: id, expectedVersion, currentVersion: group.version });
  }
  return group;
}

export async function updateBuyerGroup(req: Request, id: number, input: BuyerGroupInput & { version: number }): Promise<BuyerGroupRow> {
  const values = await checkedFor(orm, input);
  await orm.transaction(async (tx) => {
    const group = await lockedGroup(tx, id, input.version);
    if (group.priceList !== values.priceList) await assertMayPrice(req);
    await refuseTakenCode(tx, values.code, id);
    const { id: _id, version: _version, accountCount: _count, ...before } = rowOf(group, 0);
    await tx.update(storefrontBuyerGroups).set({ ...columnsOf(values), updatedAt: systemNowUtcIso(), version: nextVersion(group.version) })
      .where(eq(storefrontBuyerGroups.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'فروشگاه سایت', entityId: `buyer-group-${id}`,
      description: `گروه خریدار «${values.title}» ویرایش شد`, details: { before, after: values },
    });
  });
  return buyerGroupById(orm, id);
}

export async function deleteBuyerGroup(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const group = await lockedGroup(tx, id, version);
    const [used] = await tx.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.groupId, id)).limit(1);
    if (used) {
      throw new ConflictError('این گروه خریدار حساب تأییدشده دارد؛ به جای حذف، آن را غیرفعال کنید یا خریدارانش را به گروه دیگری ببرید.', undefined, 'STOREFRONT_GROUP_IN_USE');
    }
    await tx.update(storefrontBuyerGroups).set({ isDeleted: 1, isActive: 0, updatedAt: systemNowUtcIso(), version: nextVersion(group.version) })
      .where(eq(storefrontBuyerGroups.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: 'فروشگاه سایت', entityId: `buyer-group-${id}`,
      description: `گروه خریدار «${group.title}» حذف شد`, details: { before: { code: group.code, title: group.title, priceList: group.priceList } },
    });
  });
}

export async function buyerGroupById(executor: DbExecutor, id: number): Promise<BuyerGroupRow> {
  const [group] = await executor.select().from(storefrontBuyerGroups).where(and(eq(storefrontBuyerGroups.id, id), eq(storefrontBuyerGroups.isDeleted, 0)));
  if (!group) throw new NotFoundError('گروه خریدار پیدا نشد.', undefined, 'STOREFRONT_GROUP_NOT_FOUND');
  const counts = await accountCounts(executor);
  return rowOf(group, counts.get(id) ?? 0);
}
