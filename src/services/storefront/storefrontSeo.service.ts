import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError } from '../../lib/occHelper.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { isAnalyticsProvider, normalizedSeoSettings, seoSettingsError, type SeoSettingsValues } from '../../lib/storefront/storefrontSeoRules.js';
import {
  STOREFRONT_SEO_SETTING_KEYS as KEYS, type StorefrontPublicSeo, type StorefrontSeoSettingsInput, type StorefrontSeoSettingsView,
} from '../../lib/storefront/storefrontSeoContracts.js';

/**
 * v11 phase 8.5 (package 18): the site's search and statistics settings in `app_settings` (`sf_seo_*`): the Google and Bing
 * verification codes, the visit-statistics service (none by default, so nothing loads on the site until the owner
 * chooses one) and the address of the brand's site in another language. A group of its own with its own version row, so
 * saving it never makes the open payment and shipping form stale; one save is one audit row in the same transaction.
 */
const VALUE_KEYS = [KEYS.googleVerification, KEYS.bingVerification, KEYS.analyticsProvider, KEYS.analyticsId, KEYS.analyticsUrl, KEYS.alternateSiteUrl] as const;
type Field = keyof SeoSettingsValues;
const FIELDS: Field[] = ['googleVerification', 'bingVerification', 'analyticsProvider', 'analyticsId', 'analyticsUrl', 'alternateSiteUrl'];

async function readStored(executor: DbExecutor): Promise<Record<string, string>> {
  const rows = await executor.select().from(appSettings).where(inArray(appSettings.key, [...VALUE_KEYS, KEYS.version]));
  return Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]));
}

function valuesOf(stored: Record<string, string>): SeoSettingsValues {
  const provider = stored[KEYS.analyticsProvider];
  return {
    googleVerification: stored[KEYS.googleVerification] ?? '',
    bingVerification: stored[KEYS.bingVerification] ?? '',
    analyticsProvider: isAnalyticsProvider(provider) ? provider : 'none',
    analyticsId: stored[KEYS.analyticsId] ?? '',
    analyticsUrl: stored[KEYS.analyticsUrl] ?? '',
    alternateSiteUrl: stored[KEYS.alternateSiteUrl] ?? '',
  };
}

export async function readStorefrontSeoSettings(executor: DbExecutor): Promise<StorefrontSeoSettingsView> {
  const stored = await readStored(executor);
  return { ...valuesOf(stored), version: Number(stored[KEYS.version]) || 0 };
}

export async function saveStorefrontSeoSettings(req: Request, input: StorefrontSeoSettingsInput): Promise<StorefrontSeoSettingsView> {
  const { version, ...raw } = input;
  const problem = seoSettingsError(raw);
  if (problem) throw new ValidationError(problem.message, { field: problem.field }, 'STOREFRONT_SEO_INVALID');
  const values = normalizedSeoSettings(raw);
  await orm.transaction(async (tx) => {
    await tx.insert(appSettings).values({ key: KEYS.version, value: '0' }).onConflictDoNothing({ target: appSettings.key });
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEYS.version)).for('update');
    const current = Number(row?.value) || 0;
    if (current !== version) {
      throw new OptimisticLockError({ entityType: 'StorefrontSeoSettings', entityId: KEYS.version, expectedVersion: version, currentVersion: current });
    }
    const before = valuesOf(await readStored(tx));
    const changes: Partial<Record<Field, { before: string; after: string }>> = {};
    for (const field of FIELDS) {
      if (before[field] === values[field]) continue;
      changes[field] = { before: before[field], after: values[field] };
      await tx.insert(appSettings).values({ key: KEYS[field], value: values[field] })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: values[field] } });
    }
    if (Object.keys(changes).length === 0) return;
    await tx.update(appSettings).set({ value: String(current + 1) }).where(eq(appSettings.key, KEYS.version));
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'seo',
      description: 'تنظیمات جست‌وجو و آمار بازدید سایت ذخیره شد', details: { before, after: values, changes },
    });
  });
  invalidateSettingsCache();
  return readStorefrontSeoSettings(orm);
}

/** `GET /api/storefront/v1/seo`: verification codes, the statistics service (provider 'none' = nothing loads) and the other-language site */
export async function publicSeo(): Promise<StorefrontPublicSeo> {
  const values = valuesOf(await readStored(orm));
  const on = values.analyticsProvider !== 'none';
  return {
    verification: { google: values.googleVerification, bing: values.bingVerification },
    analytics: { provider: values.analyticsProvider, id: on ? values.analyticsId : '', url: values.analyticsProvider === 'matomo' ? values.analyticsUrl : '' },
    alternateSiteUrl: values.alternateSiteUrl,
  };
}
