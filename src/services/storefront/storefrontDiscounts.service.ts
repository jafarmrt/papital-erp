import type { Request } from 'express';
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerGroups, storefrontDiscountCodes, storefrontDiscountRedemptions } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { rialAmountText } from '../../lib/storefront/storefrontRules.js';
import {
  DISCOUNT_CODE_HINT, DISCOUNT_LIMIT_MAX, DISCOUNT_PERCENT_MAX, DISCOUNT_TITLE_MAX, isDiscountKind, normalizeDiscountCode,
} from '../../lib/storefront/storefrontDiscountRules.js';
import type { DiscountCodeInput, DiscountCodeRow, DiscountCodesView } from '../../lib/storefront/storefrontDiscountContracts.js';
import { rialText } from './storefrontShipping.service.js';

/**
 * v11 phase 8.2c (package 18, start plan §6, decision 6): the «کدهای تخفیف» section of the «فروشگاه سایت» tab. Reading
 * needs `storefront.view`, writing `storefront.manage` (like the buyer groups, since a code decides what a buyer pays). A
 * save runs under the code's version (a stale form is 409) with an audit row in the same transaction. Removing a code is a
 * soft delete: its orders keep it, and its code text may be used again for a new one. A code's kind and amount may change
 * while it has uses; each order keeps the amount it got.
 */
type CodeRecord = typeof storefrontDiscountCodes.$inferSelect;

/** Iran keeps +03:30 all year (no daylight saving since 1401), so a Tehran day is a fixed span of UTC */
const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dayStart = (day: string): string => `${day}T00:00:00+03:30`;
const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
/** The Tehran day a stored time falls on ('' for none); `ends` reads an end time back as the last day it works */
function tehranDay(stored: string | null, options: { ends?: boolean } = {}): string {
  if (!stored) return '';
  const at = Date.parse(stored) + TEHRAN_OFFSET_MS - (options.ends ? DAY_MS : 0);
  return new Date(at).toISOString().slice(0, 10);
}

function rowOf(code: CodeRecord, usedCount: number): DiscountCodeRow {
  return {
    id: code.id, code: code.code, title: code.title, kind: isDiscountKind(code.kind) ? code.kind : 'percent', percent: code.percent,
    amount: rialText(code.amount), maxDiscount: rialText(code.maxDiscount), minOrderAmount: rialText(code.minOrderAmount),
    startsOn: tehranDay(code.startsAt), endsOn: tehranDay(code.endsAt, { ends: true }), usageLimit: code.usageLimit,
    perBuyerLimit: code.perBuyerLimit, forRetail: code.forRetail === 1, groupIds: code.groupIds ?? [], accountsOnly: code.accountsOnly === 1,
    firstOrderOnly: code.firstOrderOnly === 1, isActive: code.isActive === 1, usedCount, version: code.version,
  };
}

/** The uses each code holds now (a cancelled order's use went back) */
async function usesOf(executor: DbExecutor, ids: number[]): Promise<Map<number, number>> {
  const used = new Map<number, number>();
  if (ids.length === 0) return used;
  const uses = await executor.select({ codeId: storefrontDiscountRedemptions.codeId, n: count() }).from(storefrontDiscountRedemptions)
    .where(and(inArray(storefrontDiscountRedemptions.codeId, ids), isNull(storefrontDiscountRedemptions.releasedAt)))
    .groupBy(storefrontDiscountRedemptions.codeId);
  for (const u of uses) used.set(u.codeId, Number(u.n));
  return used;
}

export async function listDiscountCodes(executor: DbExecutor): Promise<DiscountCodesView> {
  const codes = await executor.select().from(storefrontDiscountCodes).where(eq(storefrontDiscountCodes.isDeleted, 0))
    .orderBy(desc(storefrontDiscountCodes.id));
  const used = await usesOf(executor, codes.map(c => c.id));
  const groupRows = await executor.select({ id: storefrontBuyerGroups.id, title: storefrontBuyerGroups.title, acceptsDiscounts: storefrontBuyerGroups.acceptsDiscounts })
    .from(storefrontBuyerGroups).where(eq(storefrontBuyerGroups.isDeleted, 0)).orderBy(asc(storefrontBuyerGroups.sortOrder), asc(storefrontBuyerGroups.id));
  return {
    codes: codes.map(c => rowOf(c, used.get(c.id) ?? 0)),
    groups: groupRows.map(g => ({ id: g.id, title: g.title, acceptsDiscounts: g.acceptsDiscounts === 1 })),
  };
}

const invalid = (message: string, code: string) => new ValidationError(message, undefined, code);
const faNumber = (n: number) => n.toLocaleString('fa-IR');

function limitOf(value: number, title: string): number {
  if (!Number.isInteger(value) || value < 0 || value > DISCOUNT_LIMIT_MAX) {
    throw invalid(`${title} باید عدد درست ۰ تا ${faNumber(DISCOUNT_LIMIT_MAX)} باشد؛ ۰ یعنی بی‌سقف.`, 'STOREFRONT_DISCOUNT_LIMIT_INVALID');
  }
  return value;
}

function amountOf(value: string, title: string, allowZero: boolean): string {
  const amount = rialAmountText(value.trim() || '0', { allowZero });
  if (amount === null) throw invalid(`${title} باید مبلغ ریالی${allowZero ? '؛ ۰ یعنی ندارد' : ' بزرگ‌تر از صفر'} باشد.`, 'STOREFRONT_DISCOUNT_AMOUNT_INVALID');
  return amount;
}

function dayOf(value: string, title: string): string {
  const day = value.trim();
  if (day && (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))) {
    throw invalid(`${title} تاریخ درستی نیست.`, 'STOREFRONT_DISCOUNT_DATE_INVALID');
  }
  return day;
}

/** The code as it is stored, or the first reason it cannot be (the groups are checked against the database separately) */
export function checkedDiscountCode(input: DiscountCodeInput): DiscountCodeInput {
  const code = normalizeDiscountCode(input.code);
  if (!code) throw invalid(DISCOUNT_CODE_HINT, 'STOREFRONT_DISCOUNT_CODE_INVALID');
  const title = input.title.trim();
  if (title.length > DISCOUNT_TITLE_MAX) throw invalid(`عنوان کد حداکثر ${faNumber(DISCOUNT_TITLE_MAX)} نویسه است.`, 'STOREFRONT_DISCOUNT_TITLE_TOO_LONG');
  if (!isDiscountKind(input.kind)) throw invalid('نوع تخفیف را انتخاب کنید.', 'STOREFRONT_DISCOUNT_KIND_INVALID');
  const percentKind = input.kind === 'percent';
  if (percentKind && (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > DISCOUNT_PERCENT_MAX)) {
    throw invalid(`درصد تخفیف باید عدد درست ۱ تا ${faNumber(DISCOUNT_PERCENT_MAX)} باشد.`, 'STOREFRONT_DISCOUNT_PERCENT_INVALID');
  }
  const amount = percentKind ? '0' : amountOf(input.amount, 'مبلغ تخفیف', false);
  const maxDiscount = percentKind ? amountOf(input.maxDiscount, 'سقف تخفیف', true) : '0';
  const minOrderAmount = amountOf(input.minOrderAmount, 'حداقل خرید', true);
  if (!percentKind && BigInt(minOrderAmount) <= BigInt(amount)) {
    throw invalid('حداقل خرید کد مبلغی باید از مبلغ تخفیف بیشتر باشد، تا سفارشی رایگان نشود.', 'STOREFRONT_DISCOUNT_MIN_ORDER_LOW');
  }
  const startsOn = dayOf(input.startsOn, 'روز آغاز');
  const endsOn = dayOf(input.endsOn, 'روز پایان');
  if (startsOn && endsOn && endsOn < startsOn) throw invalid('روز پایان نباید پیش از روز آغاز باشد.', 'STOREFRONT_DISCOUNT_WINDOW_INVALID');
  const groupIds = [...new Set((Array.isArray(input.groupIds) ? input.groupIds : []).map(Number))];
  if (groupIds.some(id => !Number.isInteger(id) || id < 1)) throw invalid('گروه خریدار انتخاب‌شده شناخته نیست.', 'STOREFRONT_DISCOUNT_GROUP_INVALID');
  if (!input.forRetail && groupIds.length === 0) {
    throw invalid('کد برای چه کسی است؟ «خریداران تکی» را روشن کنید یا دست‌کم یک گروه خریدار انتخاب کنید.', 'STOREFRONT_DISCOUNT_AUDIENCE_REQUIRED');
  }
  return {
    code, title, kind: input.kind, percent: percentKind ? input.percent : 0, amount, maxDiscount, minOrderAmount, startsOn, endsOn,
    usageLimit: limitOf(input.usageLimit, 'سقف کل استفاده'), perBuyerLimit: limitOf(input.perBuyerLimit, 'سقف استفادهٔ هر خریدار'),
    forRetail: input.forRetail, groupIds: groupIds.sort((a, b) => a - b), accountsOnly: input.accountsOnly,
    firstOrderOnly: input.firstOrderOnly, isActive: input.isActive,
  };
}

const columnsOf = (v: DiscountCodeInput) => ({
  code: v.code, title: v.title, kind: v.kind, percent: v.percent, amount: money(v.amount), maxDiscount: money(v.maxDiscount),
  minOrderAmount: money(v.minOrderAmount), startsAt: v.startsOn ? dayStart(v.startsOn) : null, endsAt: v.endsOn ? dayStart(dayAfter(v.endsOn)) : null,
  usageLimit: v.usageLimit, perBuyerLimit: v.perBuyerLimit, forRetail: v.forRetail ? 1 : 0, groupIds: v.groupIds, accountsOnly: v.accountsOnly ? 1 : 0,
  firstOrderOnly: v.firstOrderOnly ? 1 : 0, isActive: v.isActive ? 1 : 0,
});

/** Every chosen group must be live and accept discounts (a group that does not is never offered a code) */
async function checkGroups(tx: DbExecutor, groupIds: number[]): Promise<void> {
  if (groupIds.length > 0) {
    const groups = await tx.select({ id: storefrontBuyerGroups.id, title: storefrontBuyerGroups.title, acceptsDiscounts: storefrontBuyerGroups.acceptsDiscounts })
      .from(storefrontBuyerGroups).where(and(inArray(storefrontBuyerGroups.id, groupIds), eq(storefrontBuyerGroups.isDeleted, 0))).for('share');
    if (groups.length !== groupIds.length) throw invalid('گروه خریدار انتخاب‌شده پیدا نشد.', 'STOREFRONT_DISCOUNT_GROUP_INVALID');
    const closed = groups.find(g => g.acceptsDiscounts !== 1);
    if (closed) {
      throw invalid(`گروه «${closed.title}» کد تخفیف نمی‌پذیرد؛ نخست در گروه‌های خریدار «کد تخفیف می‌پذیرد» را روشن کنید.`, 'STOREFRONT_DISCOUNT_GROUP_CLOSED');
    }
  }
}

async function refuseTakenCode(tx: DbExecutor, code: string, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontDiscountCodes.code, code), eq(storefrontDiscountCodes.isDeleted, 0)];
  if (exceptId !== undefined) conditions.push(ne(storefrontDiscountCodes.id, exceptId));
  const [taken] = await tx.select({ id: storefrontDiscountCodes.id }).from(storefrontDiscountCodes).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(`کد «${code}» پیش‌تر ساخته شده است.`, undefined, 'STOREFRONT_DISCOUNT_CODE_TAKEN');
}

const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');

export async function createDiscountCode(req: Request, input: DiscountCodeInput): Promise<DiscountCodeRow> {
  const values = checkedDiscountCode(input);
  const id = await orm.transaction(async (tx) => {
    await refuseTakenCode(tx, values.code);
    await checkGroups(tx, values.groupIds);
    const [created] = await tx.insert(storefrontDiscountCodes).values({ ...columnsOf(values), createdBy: actorOf(req), updatedBy: actorOf(req) })
      .returning({ id: storefrontDiscountCodes.id });
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: `discount-code-${created.id}`,
      description: `کد تخفیف «${values.code}» ساخته شد`, details: { after: values },
    });
    return created.id;
  });
  return discountCodeById(orm, id);
}

async function lockedCode(tx: DbExecutor, id: number, expectedVersion: number): Promise<CodeRecord> {
  const [code] = await tx.select().from(storefrontDiscountCodes)
    .where(and(eq(storefrontDiscountCodes.id, id), eq(storefrontDiscountCodes.isDeleted, 0))).for('update');
  if (!code) throw new NotFoundError('کد تخفیف پیدا نشد.', undefined, 'STOREFRONT_DISCOUNT_NOT_FOUND');
  if (code.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontDiscountCode', entityId: id, expectedVersion, currentVersion: code.version });
  }
  return code;
}

export async function updateDiscountCode(req: Request, id: number, input: DiscountCodeInput & { version: number }): Promise<DiscountCodeRow> {
  const values = checkedDiscountCode(input);
  await orm.transaction(async (tx) => {
    const code = await lockedCode(tx, id, input.version);
    await refuseTakenCode(tx, values.code, id);
    await checkGroups(tx, values.groupIds);
    const { id: _id, version: _version, usedCount: _used, ...before } = rowOf(code, 0);
    await tx.update(storefrontDiscountCodes)
      .set({ ...columnsOf(values), updatedBy: actorOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(code.version) })
      .where(eq(storefrontDiscountCodes.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'فروشگاه سایت', entityId: `discount-code-${id}`,
      description: `کد تخفیف «${values.code}» ویرایش شد`, details: { before, after: values },
    });
  });
  return discountCodeById(orm, id);
}

export async function deleteDiscountCode(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const code = await lockedCode(tx, id, version);
    await tx.update(storefrontDiscountCodes)
      .set({ isDeleted: 1, isActive: 0, updatedBy: actorOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(code.version) })
      .where(eq(storefrontDiscountCodes.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: 'فروشگاه سایت', entityId: `discount-code-${id}`,
      description: `کد تخفیف «${code.code}» حذف شد`, details: { before: { code: code.code, title: code.title, kind: code.kind } },
    });
  });
}

export async function discountCodeById(executor: DbExecutor, id: number): Promise<DiscountCodeRow> {
  const [code] = await executor.select().from(storefrontDiscountCodes)
    .where(and(eq(storefrontDiscountCodes.id, id), eq(storefrontDiscountCodes.isDeleted, 0)));
  if (!code) throw new NotFoundError('کد تخفیف پیدا نشد.', undefined, 'STOREFRONT_DISCOUNT_NOT_FOUND');
  const used = await usesOf(executor, [id]);
  return rowOf(code, used.get(id) ?? 0);
}
