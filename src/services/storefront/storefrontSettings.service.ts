import crypto from 'crypto';
import type { Request } from 'express';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings, bankAccounts } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { ItemPricingService } from '../items/itemPricing.service.js';
import {
  LOW_STOCK_THRESHOLD_DEFAULT, LOW_STOCK_THRESHOLD_MAX, RESERVATION_HOURS_DEFAULT, RESERVATION_HOURS_MAX, cardNumberError, digitsOnly,
  ibanError, isStockDisplay, normalizeIban, rialAmountText,
} from '../../lib/storefront/storefrontRules.js';
import { OPEN_ORDERS_PER_PHONE_DEFAULT, OPEN_ORDERS_PER_PHONE_MAX } from '../../lib/storefront/storefrontOrderRules.js';
import {
  STOREFRONT_SETTING_KEYS as KEYS, type StorefrontSettingsInput, type StorefrontSettingsView,
} from '../../lib/storefront/storefrontContracts.js';
import { activeWarehouses, storefrontWarehouseCode } from './storefrontStock.js';

/**
 * v11 phase 8.1 (package 18): the storefront settings in `app_settings` (`sf_*`): the card and IBAN buyers pay to, the
 * free-shipping threshold, the stock reservation hours, the retail and wholesale price lists, how stock is shown and from
 * which warehouse the site sells (start plan decisions 4 and 5), and the hash of the key the
 * storefront app calls the Storefront API with. One save writes the whole group under the lock of its version row, with
 * one audit row in the same transaction; a stale version is 409 (`AGENTS.md` §2.7). The general settings form never
 * writes these keys (it refuses unknown keys).
 */
const HOLDER_MAX = 100;
const BANK_MAX = 60;
const API_KEY_BYTES = 32;

type Stored = Record<string, string>;

async function readStored(executor: DbExecutor, keys: readonly string[]): Promise<Stored> {
  const rows = await executor.select().from(appSettings).where(inArray(appSettings.key, [...keys]));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

const GROUP_KEYS = [
  KEYS.cardNumber, KEYS.cardHolder, KEYS.bankName, KEYS.iban, KEYS.freeShippingThreshold, KEYS.reservationHours,
  KEYS.retailPriceList, KEYS.wholesalePriceList, KEYS.lowStockThreshold, KEYS.stockDisplay, KEYS.warehouseCode, KEYS.enabled, KEYS.ordersEnabled, KEYS.treasuryAccountId,
  KEYS.openOrdersPerPhone, KEYS.version, KEYS.apiKeyHint, KEYS.apiKeyCreatedAt, KEYS.apiKeySha256,
] as const;

function reservationHoursOf(stored: string | undefined): number {
  const hours = Number(stored);
  return Number.isInteger(hours) && hours >= 1 && hours <= RESERVATION_HOURS_MAX ? hours : RESERVATION_HOURS_DEFAULT;
}

function lowStockThresholdOf(stored: string | undefined): number {
  if (stored === undefined || stored === '') return LOW_STOCK_THRESHOLD_DEFAULT;
  const value = Number(stored);
  return Number.isInteger(value) && value >= 0 && value <= LOW_STOCK_THRESHOLD_MAX ? value : LOW_STOCK_THRESHOLD_DEFAULT;
}

function openOrdersPerPhoneOf(stored: string | undefined): number {
  const value = Number(stored);
  return Number.isInteger(value) && value >= 1 && value <= OPEN_ORDERS_PER_PHONE_MAX ? value : OPEN_ORDERS_PER_PHONE_DEFAULT;
}

function treasuryAccountIdOf(stored: string | undefined): number {
  const value = Number(stored);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * v11 phase 8.2a: the treasury accounts a site payment may be received into: live and active bank accounts in rials with a
 * ledger account (a receipt without one is refused by the treasury anyway)
 */
export async function storefrontTreasuryAccounts(executor: DbExecutor): Promise<Array<{ id: number; title: string; bankName: string }>> {
  const rows = await executor.select({ id: bankAccounts.id, title: bankAccounts.title, bankName: bankAccounts.bankName, currency: bankAccounts.currency })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.isDeleted, 0), eq(bankAccounts.isActive, 1), eq(bankAccounts.type, 'bank'), isNotNull(bankAccounts.accountId)))
    .orderBy(asc(bankAccounts.code), asc(bankAccounts.id));
  return rows.filter(r => (r.currency || 'IRR').toUpperCase() === 'IRR').map(r => ({ id: r.id, title: r.title, bankName: r.bankName ?? '' }));
}

function inputOf(stored: Stored): StorefrontSettingsInput {
  return {
    cardNumber: stored[KEYS.cardNumber] ?? '',
    cardHolder: stored[KEYS.cardHolder] ?? '',
    bankName: stored[KEYS.bankName] ?? '',
    iban: stored[KEYS.iban] ?? '',
    freeShippingThreshold: stored[KEYS.freeShippingThreshold] ?? '',
    reservationHours: reservationHoursOf(stored[KEYS.reservationHours]),
    retailPriceList: stored[KEYS.retailPriceList] ?? '',
    wholesalePriceList: stored[KEYS.wholesalePriceList] ?? '',
    lowStockThreshold: lowStockThresholdOf(stored[KEYS.lowStockThreshold]),
    stockDisplay: isStockDisplay(stored[KEYS.stockDisplay]) ? stored[KEYS.stockDisplay] as StorefrontSettingsInput['stockDisplay'] : 'status',
    warehouseCode: stored[KEYS.warehouseCode] ?? '',
    enabled: stored[KEYS.enabled] === '1',
    ordersEnabled: stored[KEYS.ordersEnabled] === '1',
    treasuryAccountId: treasuryAccountIdOf(stored[KEYS.treasuryAccountId]),
    openOrdersPerPhone: openOrdersPerPhoneOf(stored[KEYS.openOrdersPerPhone]),
    version: Number(stored[KEYS.version]) || 0,
  };
}

/** The settings the ERP tab shows (the key itself is never shown again, only its last four letters) */
export async function readStorefrontSettings(executor: DbExecutor): Promise<StorefrontSettingsView> {
  const stored = await readStored(executor, GROUP_KEYS);
  const input = inputOf(stored);
  return {
    ...input,
    priceLists: await ItemPricingService.getPricingStrategies(executor),
    warehouses: await activeWarehouses(executor),
    treasuryAccounts: await storefrontTreasuryAccounts(executor),
    effectiveWarehouseCode: await storefrontWarehouseCode(executor, input.warehouseCode),
    apiKey: {
      configured: Boolean(stored[KEYS.apiKeySha256]),
      hint: stored[KEYS.apiKeyHint] ?? '',
      createdAt: stored[KEYS.apiKeyCreatedAt] || null,
    },
  };
}

/** The values the Storefront API and the order flow read */
export async function storefrontSettingValues(executor: DbExecutor): Promise<StorefrontSettingsInput> {
  return inputOf(await readStored(executor, GROUP_KEYS));
}

function checkedInput(input: StorefrontSettingsInput, priceLists: string[], warehouseCodes: string[], treasuryIds: number[]): Omit<StorefrontSettingsInput, 'version'> {
  const cardError = cardNumberError(input.cardNumber);
  if (cardError) throw new ValidationError(cardError, undefined, 'STOREFRONT_CARD_INVALID');
  const shebaError = ibanError(input.iban);
  if (shebaError) throw new ValidationError(shebaError, undefined, 'STOREFRONT_IBAN_INVALID');
  const cardHolder = input.cardHolder.trim();
  const bankName = input.bankName.trim();
  if (cardHolder.length > HOLDER_MAX) throw new ValidationError(`نام صاحب حساب حداکثر ${HOLDER_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'STOREFRONT_HOLDER_TOO_LONG');
  if (bankName.length > BANK_MAX) throw new ValidationError(`نام بانک حداکثر ${BANK_MAX.toLocaleString('fa-IR')} نویسه است.`, undefined, 'STOREFRONT_BANK_TOO_LONG');
  const cardNumber = digitsOnly(input.cardNumber);
  const iban = normalizeIban(input.iban);
  if ((cardNumber || iban) && !cardHolder) {
    throw new ValidationError('نام صاحب حساب کارت یا شبا لازم است تا خریدار بداند به چه کسی پرداخت می‌کند.', undefined, 'STOREFRONT_HOLDER_REQUIRED');
  }
  const thresholdText = input.freeShippingThreshold.trim();
  const freeShippingThreshold = thresholdText === '' ? '' : rialAmountText(thresholdText, { allowZero: false });
  if (freeShippingThreshold === null) {
    throw new ValidationError('سقف ارسال رایگان باید مبلغ ریالی بزرگ‌تر از صفر باشد؛ برای خاموش کردن، خالی بگذارید.', undefined, 'STOREFRONT_THRESHOLD_INVALID');
  }
  if (!Number.isInteger(input.reservationHours) || input.reservationHours < 1 || input.reservationHours > RESERVATION_HOURS_MAX) {
    throw new ValidationError(`مهلت رزرو باید ۱ تا ${RESERVATION_HOURS_MAX.toLocaleString('fa-IR')} ساعت باشد.`, undefined, 'STOREFRONT_RESERVATION_INVALID');
  }
  const listOf = (title: string, label: string): string => {
    const wanted = title.trim();
    if (!wanted) return '';
    if (!priceLists.includes(wanted)) throw new ValidationError(`${label} «${wanted}» در تنظیمات قیمت‌گذاری نیست.`, undefined, 'STOREFRONT_PRICE_LIST_NOT_CONFIGURED');
    return wanted;
  };
  const retailPriceList = listOf(input.retailPriceList, 'لیست قیمت تکی');
  const wholesalePriceList = listOf(input.wholesalePriceList, 'لیست قیمت عمده');
  if (retailPriceList && retailPriceList === wholesalePriceList) {
    throw new ValidationError('لیست قیمت تکی و عمده باید دو لیست جدا باشند.', undefined, 'STOREFRONT_PRICE_LISTS_SAME');
  }
  if (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0 || input.lowStockThreshold > LOW_STOCK_THRESHOLD_MAX) {
    throw new ValidationError(`آستانه «تعداد کم» باید عدد درست ۰ تا ${LOW_STOCK_THRESHOLD_MAX.toLocaleString('fa-IR')} باشد؛ ۰ یعنی هرگز.`, undefined, 'STOREFRONT_LOW_STOCK_INVALID');
  }
  if (!isStockDisplay(input.stockDisplay)) throw new ValidationError('شیوه نمایش موجودی شناخته نیست.', undefined, 'STOREFRONT_STOCK_DISPLAY_INVALID');
  const warehouseCode = input.warehouseCode.trim();
  if (warehouseCode && !warehouseCodes.includes(warehouseCode)) {
    throw new ValidationError(`انبار «${warehouseCode}» فعال نیست یا وجود ندارد.`, undefined, 'STOREFRONT_WAREHOUSE_INVALID');
  }
  if (input.treasuryAccountId !== 0 && !treasuryIds.includes(input.treasuryAccountId)) {
    throw new ValidationError('حساب دریافت کارت‌به‌کارت باید یک حساب بانکی ریالیِ فعال با سرفصل حسابداری باشد.', undefined, 'STOREFRONT_TREASURY_ACCOUNT_INVALID');
  }
  if (!Number.isInteger(input.openOrdersPerPhone) || input.openOrdersPerPhone < 1 || input.openOrdersPerPhone > OPEN_ORDERS_PER_PHONE_MAX) {
    throw new ValidationError(`سقف سفارش‌های پرداخت‌نشدهٔ هر شماره باید ۱ تا ${OPEN_ORDERS_PER_PHONE_MAX.toLocaleString('fa-IR')} باشد.`, undefined, 'STOREFRONT_OPEN_ORDERS_INVALID');
  }
  const ordersEnabled = input.ordersEnabled === true;
  if (ordersEnabled && (!cardNumber && !iban)) {
    throw new ValidationError('برای روشن کردن ثبت سفارش، کارت یا شبای دریافت پول لازم است.', undefined, 'STOREFRONT_ORDERS_NEED_PAYMENT');
  }
  if (ordersEnabled && input.treasuryAccountId === 0) {
    throw new ValidationError('برای روشن کردن ثبت سفارش، حساب دریافت کارت‌به‌کارت را انتخاب کنید.', undefined, 'STOREFRONT_ORDERS_NEED_TREASURY');
  }
  if (ordersEnabled && !retailPriceList) {
    throw new ValidationError('برای روشن کردن ثبت سفارش، لیست قیمت تکی لازم است.', undefined, 'STOREFRONT_ORDERS_NEED_PRICE_LIST');
  }
  return {
    cardNumber, cardHolder, bankName, iban, freeShippingThreshold, reservationHours: input.reservationHours, retailPriceList, wholesalePriceList,
    lowStockThreshold: input.lowStockThreshold, stockDisplay: input.stockDisplay, warehouseCode, enabled: input.enabled === true,
    ordersEnabled, treasuryAccountId: input.treasuryAccountId, openOrdersPerPhone: input.openOrdersPerPhone,
  };
}

/** Locks the group's version row (made on first use) and checks the version the form was opened with */
async function lockVersion(tx: DbExecutor, expected: number): Promise<number> {
  await tx.insert(appSettings).values({ key: KEYS.version, value: '0' }).onConflictDoNothing({ target: appSettings.key });
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.version)).for('update');
  const current = Number(row?.value) || 0;
  if (current !== expected) {
    throw new OptimisticLockError({ entityType: 'StorefrontSettings', entityId: KEYS.version, expectedVersion: expected, currentVersion: current });
  }
  return current;
}

async function writeValue(tx: DbExecutor, key: string, value: string): Promise<void> {
  await tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function saveStorefrontSettings(req: Request, input: StorefrontSettingsInput): Promise<StorefrontSettingsView> {
  await orm.transaction(async (tx) => {
    const current = await lockVersion(tx, input.version);
    const warehouseCodes = (await activeWarehouses(tx)).map(w => w.code);
    const treasuryIds = (await storefrontTreasuryAccounts(tx)).map(a => a.id);
    const values = checkedInput(input, await ItemPricingService.getPricingStrategies(tx), warehouseCodes, treasuryIds);
    const before = inputOf(await readStored(tx, GROUP_KEYS));
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const fields = Object.keys(values) as Array<keyof typeof values>;
    for (const field of fields) {
      const after = values[field];
      if (String(before[field]) === String(after)) continue;
      changes[field] = { before: before[field], after };
      await writeValue(tx, KEYS[field], typeof after === 'boolean' ? (after ? '1' : '0') : String(after));
    }
    if (Object.keys(changes).length === 0) return;
    await writeValue(tx, KEYS.version, String(current + 1));
    const { version: _v, ...beforeValues } = before;
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'settings',
      description: 'تنظیمات فروشگاه سایت ذخیره شد', details: { before: beforeValues, after: values, changes },
    });
  });
  invalidateSettingsCache();
  return readStorefrontSettings(orm);
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * A new key for the storefront app; the old one stops working at once. The key is answered only here, and the database
 * keeps its SHA-256 and its last four letters.
 */
export async function rotateStorefrontApiKey(req: Request): Promise<{ apiKey: string; hint: string; createdAt: string }> {
  const apiKey = `sf_${crypto.randomBytes(API_KEY_BYTES).toString('base64url')}`;
  const hint = apiKey.slice(-4);
  const createdAt = systemNowUtcIso();
  await orm.transaction(async (tx) => {
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.apiKeySha256)).for('update');
    await writeValue(tx, KEYS.apiKeySha256, sha256(apiKey));
    await writeValue(tx, KEYS.apiKeyHint, hint);
    await writeValue(tx, KEYS.apiKeyCreatedAt, createdAt);
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'api-key',
      description: row?.value ? 'کلید برنامه سایت عوض شد؛ کلید پیشین دیگر کار نمی‌کند' : 'کلید برنامه سایت ساخته شد',
      details: { after: { hint, createdAt } },
    });
  });
  invalidateSettingsCache();
  return { apiKey, hint, createdAt };
}

/** Whether the owner has turned the Storefront API on (`sf_enabled`, default off) */
export async function isStorefrontEnabled(): Promise<boolean> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.enabled));
  return String(row?.value ?? '') === '1';
}

/** Whether a presented key is the storefront app's current key (constant time; no stored key = never) */
export async function isStorefrontApiKey(presented: string): Promise<boolean> {
  if (!presented || presented.length > 200) return false;
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.apiKeySha256));
  const stored = String(row?.value ?? '');
  if (!/^[0-9a-f]{64}$/.test(stored)) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(presented), 'hex'), Buffer.from(stored, 'hex'));
}

/** v11 phase 8.2a: whether the site takes orders now (`sf_enabled` and `sf_orders_enabled`, both default off) */
export async function isStorefrontOrderingOn(executor: DbExecutor = orm): Promise<boolean> {
  const rows = await executor.select({ key: appSettings.key, value: appSettings.value }).from(appSettings)
    .where(inArray(appSettings.key, [KEYS.enabled, KEYS.ordersEnabled]));
  const on = new Set(rows.filter(r => String(r.value ?? '') === '1').map(r => r.key));
  return on.has(KEYS.enabled) && on.has(KEYS.ordersEnabled);
}
