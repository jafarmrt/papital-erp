import crypto from 'crypto';
import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { BRAND_IMAGE_TITLES, brandImageError, parseBrandImage, type BrandImageKind } from '../../lib/storefront/storefrontRules.js';
import {
  STOREFRONT_SETTING_KEYS as KEYS, type StorefrontBrandView, type StorefrontPublicBrand,
} from '../../lib/storefront/storefrontContracts.js';

/**
 * v11 phase 8.3 (package 18): the site's logo and browser icon (owner: «لوگو … بشه تغییر داد توی تنظیمات»). Each is a
 * small image kept as a data URL in `app_settings` (`sf_logo`, `sf_favicon`), like the company logo of the general
 * settings, which the site shows while it has no logo of its own. A save carries the brand version (`sf_brand_version`,
 * apart from the settings form's version so an upload never makes the open form stale) and writes one audit row that
 * names the image by its hash and size, never its bytes.
 */
const COMPANY_LOGO_KEY = 'company_logo';
const KIND_KEYS: Readonly<Record<BrandImageKind, string>> = { logo: KEYS.logo, favicon: KEYS.favicon };
const decodeBytes = (base64: string): Uint8Array => Buffer.from(base64, 'base64');

async function stored(executor: DbExecutor): Promise<Record<string, string>> {
  const rows = await executor.select().from(appSettings)
    .where(inArray(appSettings.key, [KEYS.logo, KEYS.favicon, KEYS.brandVersion, COMPANY_LOGO_KEY]));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

/** The company logo, only when it is an image the site may show (an old file path or anything unsafe is left out) */
const usableCompanyLogo = (value: string | undefined) => (value && brandImageError(value, 'logo', decodeBytes) === null ? value : '');

export async function readStorefrontBrand(executor: DbExecutor): Promise<StorefrontBrandView> {
  const values = await stored(executor);
  const logo = values[KEYS.logo] ?? '';
  return {
    logo,
    favicon: values[KEYS.favicon] ?? '',
    usesCompanyLogo: !logo && Boolean(usableCompanyLogo(values[COMPANY_LOGO_KEY])),
    version: Number(values[KEYS.brandVersion]) || 0,
  };
}

export async function publicBrand(): Promise<StorefrontPublicBrand> {
  const values = await stored(orm);
  return { logo: values[KEYS.logo] || usableCompanyLogo(values[COMPANY_LOGO_KEY]), favicon: values[KEYS.favicon] ?? '' };
}

const fingerprint = (dataUrl: string) => {
  const parsed = parseBrandImage(dataUrl);
  if (!parsed) return null;
  return { type: parsed.type, bytes: Buffer.from(parsed.base64, 'base64').length, sha256: crypto.createHash('sha256').update(parsed.base64).digest('hex').slice(0, 16) };
};

/** Saves (or with '' removes) one brand image */
export async function saveStorefrontBrandImage(req: Request, kind: BrandImageKind, image: string, version: number): Promise<StorefrontBrandView> {
  const problem = brandImageError(image, kind, decodeBytes);
  if (problem) throw new ValidationError(problem, undefined, 'STOREFRONT_BRAND_IMAGE_INVALID');
  await orm.transaction(async (tx) => {
    await tx.insert(appSettings).values({ key: KEYS.brandVersion, value: '0' }).onConflictDoNothing({ target: appSettings.key });
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.brandVersion)).for('update');
    const current = Number(row?.value) || 0;
    if (current !== version) {
      throw new OptimisticLockError({ entityType: 'StorefrontBrand', entityId: KEYS.brandVersion, expectedVersion: version, currentVersion: current });
    }
    const key = KIND_KEYS[kind];
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
    const previous = String(before?.value ?? '');
    if (previous === image) return;
    await tx.insert(appSettings).values({ key, value: image }).onConflictDoUpdate({ target: appSettings.key, set: { value: image } });
    await tx.update(appSettings).set({ value: String(current + 1) }).where(eq(appSettings.key, KEYS.brandVersion));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: `brand-${kind}`,
      description: image ? `${BRAND_IMAGE_TITLES[kind]} عوض شد` : `${BRAND_IMAGE_TITLES[kind]} برداشته شد`,
      details: { before: previous ? fingerprint(previous) : null, after: image ? fingerprint(image) : null },
    });
  });
  invalidateSettingsCache();
  return readStorefrontBrand(orm);
}
