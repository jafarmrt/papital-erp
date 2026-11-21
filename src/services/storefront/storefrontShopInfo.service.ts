import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import {
  SHOP_SOCIALS, normalizedShopInfo, shippingLines, shopInfoError, type ShopInfoField, type ShopInfoValues, type ShopSocial,
} from '../../lib/storefront/storefrontShopInfoRules.js';
import {
  STOREFRONT_SHOP_INFO_SETTING_KEYS as KEYS, type StorefrontPublicShopInfo, type StorefrontShopInfoInput, type StorefrontShopInfoView,
} from '../../lib/storefront/storefrontShopInfoContracts.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 10a (package 18, docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «اطلاعات فروشگاه» in `app_settings`
 * (`sf_info_*`): the brand's name and motto, the shop's address and contact details, its social pages, the footer's
 * texts, the e-namad seal's two addresses and the switch of the floating WhatsApp button. A group of its own with its own
 * version row, like the search and statistics settings, so saving it never makes another open form stale; one save is one
 * audit row in the same transaction. Every field is empty until the owner writes it, and the site then keeps its own.
 */
const FIELDS = (Object.keys(KEYS) as Array<ShopInfoField | 'version'>).filter((field): field is ShopInfoField => field !== 'version');
const TEXT_FIELDS = FIELDS.filter((field): field is Exclude<ShopInfoField, 'whatsappFloat'> => field !== 'whatsappFloat');

async function readStored(executor: DbExecutor): Promise<Record<string, string>> {
  const rows = await executor.select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

function valuesOf(stored: Record<string, string>): ShopInfoValues {
  const texts = Object.fromEntries(TEXT_FIELDS.map(field => [field, stored[KEYS[field]] ?? ''])) as Omit<ShopInfoValues, 'whatsappFloat'>;
  return { ...texts, whatsappFloat: stored[KEYS.whatsappFloat] === '1' };
}

const storedText = (values: ShopInfoValues, field: ShopInfoField): string => (field === 'whatsappFloat' ? (values.whatsappFloat ? '1' : '0') : values[field]);

export async function readStorefrontShopInfo(executor: DbExecutor): Promise<StorefrontShopInfoView> {
  const stored = await readStored(executor);
  const settings = await storefrontSettingValues(executor);
  return { ...valuesOf(stored), version: Number(stored[KEYS.version]) || 0, whatsappNumberSet: settings.whatsappNumber !== '' };
}

export async function saveStorefrontShopInfo(req: Request, input: StorefrontShopInfoInput): Promise<StorefrontShopInfoView> {
  const { version, ...raw } = input;
  const problem = shopInfoError(raw);
  if (problem) throw new ValidationError(problem.message, { field: problem.field }, 'STOREFRONT_SHOP_INFO_INVALID');
  const values = normalizedShopInfo(raw);
  await orm.transaction(async (tx) => {
    await tx.insert(appSettings).values({ key: KEYS.version, value: '0' }).onConflictDoNothing({ target: appSettings.key });
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.version)).for('update');
    const current = Number(row?.value) || 0;
    if (current !== version) {
      throw new OptimisticLockError({ entityType: 'StorefrontShopInfo', entityId: KEYS.version, expectedVersion: version, currentVersion: current });
    }
    const before = valuesOf(await readStored(tx));
    const changes: Partial<Record<ShopInfoField, { before: string; after: string }>> = {};
    for (const field of FIELDS) {
      const [was, now] = [storedText(before, field), storedText(values, field)];
      if (was === now) continue;
      changes[field] = { before: was, after: now };
      await tx.insert(appSettings).values({ key: KEYS[field], value: now })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: now } });
    }
    if (Object.keys(changes).length === 0) return;
    await tx.update(appSettings).set({ value: String(current + 1) }).where(eq(appSettings.key, KEYS.version));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'shop-info',
      description: 'اطلاعات فروشگاه سایت ذخیره شد', details: { before, after: values, changes },
    });
  });
  invalidateSettingsCache();
  return readStorefrontShopInfo(orm);
}

/**
 * `GET /api/storefront/v1/shop-info` (its own security review, `AGENTS.md` §1.9c): exactly the fields of
 * `StorefrontPublicShopInfo`. The floating button's number is the one of «سفارش در واتس‌اپ», sent only while the button's
 * own switch is on.
 */
export async function publicShopInfo(): Promise<StorefrontPublicShopInfo> {
  const values = valuesOf(await readStored(orm));
  const social = Object.fromEntries(SHOP_SOCIALS.map(name => [name, values[name]])) as Record<ShopSocial, string>;
  return {
    brand: { name: values.brandName, fullName: values.brandFullName, tagline: values.brandTagline },
    footerNote: values.footerNote,
    contact: { address: values.address, postalCode: values.postalCode, phone: values.phone, mobile: values.mobile, email: values.email, hours: values.hours },
    social,
    copyright: values.copyright,
    shipping: { title: values.shippingTitle, lines: shippingLines(values.shippingText) },
    alternateSiteLabel: values.alternateSiteLabel,
    enamad: { linkUrl: values.enamadLinkUrl, imageUrl: values.enamadImageUrl },
    whatsappFloat: values.whatsappFloat ? (await storefrontSettingValues(orm)).whatsappNumber : '',
  };
}
