import type { Request } from 'express';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontShippingMethods, storefrontShippingRates } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { money, type Money } from '../../lib/money.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import {
  SHIPPING_DESCRIPTION_MAX, SHIPPING_PRICING_TITLES, SHIPPING_RATES_MAX, SHIPPING_TITLE_MAX, isProvince, isShippingPricing,
  rialAmountText, shippingCodeError,
} from '../../lib/storefront/storefrontRules.js';
import type { ShippingMethodInput, ShippingMethodRow, ShippingRateRow } from '../../lib/storefront/storefrontContracts.js';
import { STOREFRONT_AUDIT_ENTITY } from './storefrontSettings.service.js';

/**
 * v11 phase 8.1 (package 18): the delivery methods of the site and the rows of a weight and province priced method. A
 * save writes the method and all its rows in one transaction under the method's version (a stale form is 409); the rows
 * of the old version are soft deleted and the new ones inserted, so the audit row holds both lists. Only the owner's
 * settings decide what is offered: the seeded post, Snapp, courier and pickup methods start inactive.
 */
const SORT_MAX = 100_000;
/** heavier than any parcel the post takes; a bound above it is a typing mistake */
const WEIGHT_MAX_GRAMS = 1_000_000;

/** Whole rials of a money column, as the contracts carry them */
export function rialText(value: Money | null | undefined): string {
  return value ? value.round(0).toString() : '';
}

type MethodRecord = typeof storefrontShippingMethods.$inferSelect;
type RateRecord = typeof storefrontShippingRates.$inferSelect;

function rowOf(method: MethodRecord, rates: RateRecord[]): ShippingMethodRow {
  return {
    id: method.id,
    code: method.code,
    title: method.title,
    description: method.description,
    pricing: isShippingPricing(method.pricing) ? method.pricing : 'flat',
    flatRate: rialText(method.flatRate),
    isActive: method.isActive === 1,
    isFreeShippingEligible: method.isFreeShippingEligible === 1,
    sortOrder: method.sortOrder,
    rates: rates.map(r => ({ province: r.province, maxWeightGrams: r.maxWeightGrams, rate: rialText(r.rate) })),
    version: method.version,
  };
}

/** The live methods with their live rows, in the order the site shows them */
export async function listShippingMethods(executor: DbExecutor, options: { activeOnly?: boolean } = {}): Promise<ShippingMethodRow[]> {
  const where = options.activeOnly
    ? and(eq(storefrontShippingMethods.isDeleted, 0), eq(storefrontShippingMethods.isActive, 1))
    : eq(storefrontShippingMethods.isDeleted, 0);
  const methods = await executor.select().from(storefrontShippingMethods).where(where)
    .orderBy(asc(storefrontShippingMethods.sortOrder), asc(storefrontShippingMethods.id));
  if (methods.length === 0) return [];
  const rates = await executor.select().from(storefrontShippingRates)
    .where(and(inArray(storefrontShippingRates.methodId, methods.map(m => m.id)), eq(storefrontShippingRates.isDeleted, 0)))
    .orderBy(asc(storefrontShippingRates.sortOrder), asc(storefrontShippingRates.id));
  const byMethod = new Map<number, RateRecord[]>();
  for (const rate of rates) byMethod.set(rate.methodId, [...(byMethod.get(rate.methodId) ?? []), rate]);
  return methods.map(m => rowOf(m, byMethod.get(m.id) ?? []));
}

const invalid = (message: string, code: string, details?: unknown) => new ValidationError(message, details, code);

/** The method as it is stored, or the first reason it cannot be */
export function checkedShippingMethod(input: ShippingMethodInput): ShippingMethodInput {
  const code = input.code.trim();
  const codeError = shippingCodeError(code);
  if (codeError) throw invalid(codeError, 'STOREFRONT_SHIPPING_CODE_INVALID');
  const title = input.title.trim();
  if (!title) throw invalid('عنوان روش ارسال لازم است.', 'STOREFRONT_SHIPPING_TITLE_REQUIRED');
  if (title.length > SHIPPING_TITLE_MAX) throw invalid(`عنوان روش ارسال حداکثر ${SHIPPING_TITLE_MAX.toLocaleString('fa-IR')} نویسه است.`, 'STOREFRONT_SHIPPING_TITLE_TOO_LONG');
  const description = input.description.trim();
  if (description.length > SHIPPING_DESCRIPTION_MAX) {
    throw invalid(`توضیح روش ارسال حداکثر ${SHIPPING_DESCRIPTION_MAX.toLocaleString('fa-IR')} نویسه است.`, 'STOREFRONT_SHIPPING_DESCRIPTION_TOO_LONG');
  }
  if (!isShippingPricing(input.pricing)) throw invalid('شیوه قیمت‌گذاری ارسال شناخته نیست.', 'STOREFRONT_SHIPPING_PRICING_INVALID');
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > SORT_MAX) {
    throw invalid('ترتیب نمایش باید عدد درست صفر یا بزرگ‌تر باشد.', 'STOREFRONT_SHIPPING_SORT_INVALID');
  }

  let flatRate = '0';
  if (input.pricing === 'flat') {
    const rate = rialAmountText(input.flatRate, { allowZero: false });
    if (rate === null) throw invalid('نرخ ثابت ارسال باید مبلغ ریالی بزرگ‌تر از صفر باشد؛ ارسال رایگان را با شیوه «رایگان» بسازید.', 'STOREFRONT_SHIPPING_FLAT_RATE_INVALID');
    flatRate = rate;
  }

  const rates: ShippingRateRow[] = [];
  if (input.pricing === 'table') {
    if (input.rates.length === 0) throw invalid('روش «بر اساس وزن و استان» دست‌کم یک ردیف نرخ لازم دارد.', 'STOREFRONT_SHIPPING_RATES_REQUIRED');
    if (input.rates.length > SHIPPING_RATES_MAX) {
      throw invalid(`هر روش ارسال حداکثر ${SHIPPING_RATES_MAX.toLocaleString('fa-IR')} ردیف نرخ دارد.`, 'STOREFRONT_SHIPPING_RATES_TOO_MANY');
    }
    const seen = new Set<string>();
    input.rates.forEach((raw, index) => {
      const row = (index + 1).toLocaleString('fa-IR');
      const province = raw.province.trim();
      if (!isProvince(province)) throw invalid(`ردیف ${row}: استان «${province}» شناخته نیست.`, 'STOREFRONT_SHIPPING_PROVINCE_INVALID', { row: index });
      const weight = raw.maxWeightGrams;
      if (weight !== null && (!Number.isInteger(weight) || weight <= 0 || weight > WEIGHT_MAX_GRAMS)) {
        throw invalid(`ردیف ${row}: سقف وزن باید گرم درست بزرگ‌تر از صفر باشد؛ برای «بدون سقف» خالی بگذارید.`, 'STOREFRONT_SHIPPING_WEIGHT_INVALID', { row: index });
      }
      const rate = rialAmountText(raw.rate, { allowZero: true });
      if (rate === null) throw invalid(`ردیف ${row}: نرخ باید مبلغ ریالی باشد.`, 'STOREFRONT_SHIPPING_RATE_INVALID', { row: index });
      const key = `${province}|${weight ?? ''}`;
      if (seen.has(key)) throw invalid(`ردیف ${row}: همین استان و سقف وزن پیش‌تر آمده است.`, 'STOREFRONT_SHIPPING_RATE_DUPLICATE', { row: index });
      seen.add(key);
      rates.push({ province, maxWeightGrams: weight, rate });
    });
  } else if (input.rates.length > 0) {
    throw invalid(`ردیف نرخ فقط برای شیوه «${SHIPPING_PRICING_TITLES.table}» است.`, 'STOREFRONT_SHIPPING_RATES_UNEXPECTED');
  }

  return {
    code, title, description, pricing: input.pricing, flatRate, isActive: input.isActive,
    isFreeShippingEligible: input.pricing === 'free' || input.pricing === 'on_delivery' ? false : input.isFreeShippingEligible,
    sortOrder: input.sortOrder, rates,
  };
}

async function refuseTakenCode(tx: DbExecutor, code: string, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontShippingMethods.code, code), eq(storefrontShippingMethods.isDeleted, 0)];
  if (exceptId !== undefined) conditions.push(ne(storefrontShippingMethods.id, exceptId));
  const [taken] = await tx.select({ id: storefrontShippingMethods.id }).from(storefrontShippingMethods).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(`کد روش ارسال «${code}» پیش‌تر به کار رفته است.`, undefined, 'STOREFRONT_SHIPPING_CODE_TAKEN');
}

async function insertRates(tx: DbExecutor, methodId: number, rates: ShippingRateRow[]): Promise<void> {
  if (rates.length === 0) return;
  await tx.insert(storefrontShippingRates).values(rates.map((r, index) => ({
    methodId, province: r.province, maxWeightGrams: r.maxWeightGrams, rate: money(r.rate), sortOrder: index,
  })));
}

const auditView = ({ rates, ...method }: ShippingMethodInput) => ({ ...method, rates: rates.length, rateRows: rates });

export async function createShippingMethod(req: Request, input: ShippingMethodInput): Promise<ShippingMethodRow> {
  const values = checkedShippingMethod(input);
  const id = await orm.transaction(async (tx) => {
    await refuseTakenCode(tx, values.code);
    const [created] = await tx.insert(storefrontShippingMethods).values({
      code: values.code, title: values.title, description: values.description, pricing: values.pricing, flatRate: money(values.flatRate),
      isActive: values.isActive ? 1 : 0, isFreeShippingEligible: values.isFreeShippingEligible ? 1 : 0, sortOrder: values.sortOrder,
      createdBy: String((req.user as { username?: string } | undefined)?.username ?? ''),
    }).returning({ id: storefrontShippingMethods.id });
    await insertRates(tx, created.id, values.rates);
    await logActivity({
      req, tx, action: 'CREATE', entity: STOREFRONT_AUDIT_ENTITY, entityId: `shipping-${created.id}`,
      description: `روش ارسال «${values.title}» ساخته شد`, details: { after: auditView(values) },
    });
    return created.id;
  });
  return shippingMethodById(id);
}

async function lockedMethod(tx: DbExecutor, id: number, expectedVersion: number): Promise<MethodRecord> {
  const [method] = await tx.select().from(storefrontShippingMethods)
    .where(and(eq(storefrontShippingMethods.id, id), eq(storefrontShippingMethods.isDeleted, 0))).for('update');
  if (!method) throw new NotFoundError('روش ارسال پیدا نشد.', undefined, 'STOREFRONT_SHIPPING_NOT_FOUND');
  if (method.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontShippingMethod', entityId: id, expectedVersion, currentVersion: method.version });
  }
  return method;
}

async function liveRates(tx: DbExecutor, methodId: number): Promise<RateRecord[]> {
  return tx.select().from(storefrontShippingRates)
    .where(and(eq(storefrontShippingRates.methodId, methodId), eq(storefrontShippingRates.isDeleted, 0)))
    .orderBy(asc(storefrontShippingRates.sortOrder), asc(storefrontShippingRates.id));
}

export async function updateShippingMethod(req: Request, id: number, input: ShippingMethodInput & { version: number }): Promise<ShippingMethodRow> {
  const values = checkedShippingMethod(input);
  await orm.transaction(async (tx) => {
    const method = await lockedMethod(tx, id, input.version);
    await refuseTakenCode(tx, values.code, id);
    const before = rowOf(method, await liveRates(tx, id));
    await tx.update(storefrontShippingMethods).set({
      code: values.code, title: values.title, description: values.description, pricing: values.pricing, flatRate: money(values.flatRate),
      isActive: values.isActive ? 1 : 0, isFreeShippingEligible: values.isFreeShippingEligible ? 1 : 0, sortOrder: values.sortOrder,
      updatedAt: systemNowUtcIso(), version: nextVersion(method.version),
    }).where(eq(storefrontShippingMethods.id, id));
    await tx.update(storefrontShippingRates).set({ isDeleted: 1 })
      .where(and(eq(storefrontShippingRates.methodId, id), eq(storefrontShippingRates.isDeleted, 0)));
    await insertRates(tx, id, values.rates);
    const { id: _id, version: _version, ...beforeValues } = before;
    await logActivity({
      req, tx, action: 'UPDATE', entity: STOREFRONT_AUDIT_ENTITY, entityId: `shipping-${id}`,
      description: `روش ارسال «${values.title}» ویرایش شد`, details: { before: auditView(beforeValues), after: auditView(values) },
    });
  });
  return shippingMethodById(id);
}

export async function deleteShippingMethod(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const method = await lockedMethod(tx, id, version);
    await tx.update(storefrontShippingMethods).set({ isDeleted: 1, isActive: 0, updatedAt: systemNowUtcIso(), version: nextVersion(method.version) })
      .where(eq(storefrontShippingMethods.id, id));
    await tx.update(storefrontShippingRates).set({ isDeleted: 1 })
      .where(and(eq(storefrontShippingRates.methodId, id), eq(storefrontShippingRates.isDeleted, 0)));
    await logActivity({
      req, tx, action: 'DELETE', entity: STOREFRONT_AUDIT_ENTITY, entityId: `shipping-${id}`,
      description: `روش ارسال «${method.title}» حذف شد`, details: { before: { code: method.code, title: method.title, pricing: method.pricing } },
    });
  });
}

async function shippingMethodById(id: number): Promise<ShippingMethodRow> {
  const [method] = await orm.select().from(storefrontShippingMethods)
    .where(and(eq(storefrontShippingMethods.id, id), eq(storefrontShippingMethods.isDeleted, 0)));
  if (!method) throw new NotFoundError('روش ارسال پیدا نشد.', undefined, 'STOREFRONT_SHIPPING_NOT_FOUND');
  return rowOf(method, await liveRates(orm, id));
}
