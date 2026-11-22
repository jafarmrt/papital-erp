import crypto from 'node:crypto';
import type { Request } from 'express';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, mediaAssets, storefrontPages } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { mediaFilePath } from '../../lib/media/mediaPaths.js';
import { STOREFRONT_SITE_ORIGIN } from '../../lib/storefront/storefrontBuyerRules.js';
import { PAGE_PREVIEW_MINUTES, PAGE_PREVIEW_TOKEN, isPageKind, pageAssetIds, type PageValues } from '../../lib/storefront/storefrontPageRules.js';
import type { PagePreviewLink } from '../../lib/storefront/storefrontPageContracts.js';
import type { StorefrontPagePreview } from '../../lib/storefront/storefrontPagePublicContracts.js';
import { STOREFRONT_SEO_SETTING_KEYS } from '../../lib/storefront/storefrontSeoContracts.js';
import { httpsSiteUrl } from '../../lib/storefront/storefrontSeoRules.js';
import { MEDIA_FILE_NAME, isoOf, pageForSite, type PageRecord } from './storefrontPagePublic.js';

/**
 * v12 phase 10c (start plan §7.2, «پیش‌نمایش»; migration 0031): a link on the site itself that shows a page's saved
 * draft for one hour, so a colleague sees it as a visitor would before «انتشار». The key of the link is 32 random
 * bytes; only its SHA-256 is kept, so reading the database gives no link. A page has one link at a time: a new one ends
 * the old. The link shows the draft as it is saved at the moment it is opened (a later save shows at once), its images
 * through a route of its own under the same key, and nothing of it is reachable without the key or after the hour.
 */
const hashOf = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const notFound = () => new NotFoundError('پیش‌نمایش پیدا نشد یا زمانش گذشته است.', undefined, 'STOREFRONT_PAGE_PREVIEW_NOT_FOUND');

/** The address of the new site, for links the ERP shows to a colleague: the one written in «جست‌وجو و آمار», else the main domain */
async function siteOrigin(): Promise<string> {
  const [row] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STOREFRONT_SEO_SETTING_KEYS.siteUrl));
  return httpsSiteUrl(String(row?.value ?? '')) || STOREFRONT_SITE_ORIGIN;
}

/** `POST /api/storefront/pages/:id/preview`: a new one-hour link to the page's saved draft (it replaces the page's earlier link) */
export async function createPagePreview(req: Request, id: number): Promise<PagePreviewLink> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.parse(systemNowUtcIso()) + PAGE_PREVIEW_MINUTES * 60_000).toISOString();
  await orm.transaction(async (tx) => {
    const [row] = await tx.select({ id: storefrontPages.id, title: storefrontPages.title }).from(storefrontPages)
      .where(and(eq(storefrontPages.id, id), eq(storefrontPages.isDeleted, 0))).for('update');
    if (!row) throw new NotFoundError('صفحه پیدا نشد.', undefined, 'STOREFRONT_PAGE_NOT_FOUND');
    // the page's version is left as it is: a link changes nothing a colleague edits, so an open editor does not go stale
    await tx.update(storefrontPages).set({ previewHash: hashOf(token), previewExpiresAt: expiresAt }).where(eq(storefrontPages.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'صفحهٔ سایت', entityId: `page-${id}`,
      description: `پیوند پیش‌نمایش یک‌ساعتهٔ صفحهٔ «${row.title}» ساخته شد`, details: { previewExpiresAt: expiresAt },
    });
  });
  const path = `/preview/${token}`;
  return { path, url: `${await siteOrigin()}${path}`, expiresAt };
}

/** The live page a presented key opens now, or the same refusal for a wrong shape, an unknown key, an ended link and a removed page */
async function pageOfToken(token: string): Promise<PageRecord> {
  if (!PAGE_PREVIEW_TOKEN.test(token)) throw notFound();
  const [row] = await orm.select().from(storefrontPages).where(and(
    eq(storefrontPages.previewHash, hashOf(token)), eq(storefrontPages.isDeleted, 0), gt(storefrontPages.previewExpiresAt, sql`now()`),
  )).limit(1);
  if (!row) throw notFound();
  return row;
}

const draftOf = (row: PageRecord): Omit<PageValues, 'slug'> => ({
  title: row.title, seoTitle: row.seoTitle, seoDescription: row.seoDescription, noindex: true, shareImageAssetId: row.shareImageAssetId,
  sections: Array.isArray(row.sections) ? row.sections : [],
});

/**
 * `GET /api/storefront/v1/page-previews/:token`: the page's saved draft in the shape of a page of the site (built by
 * the same code as a published page, so nothing more goes out than publishing would send), marked «noindex» whatever
 * the draft says, with the time the link ends
 */
export async function publicPagePreview(token: string): Promise<StorefrontPagePreview> {
  const row = await pageOfToken(token);
  const page = await pageForSite(row, draftOf(row), {
    slug: row.slug, kind: isPageKind(row.kind) ? row.kind : 'custom', title: row.title, noindex: true, updatedAt: isoOf(row.updatedAt),
  });
  return { ...page, expiresAt: isoOf(row.previewExpiresAt ?? '') };
}

/**
 * `GET /api/storefront/v1/page-previews/:token/media/:file`: an image the page's draft names, while the link is open.
 * An image of a draft is not served by the site's image route (only a published page's is), so a preview reads its
 * images here, under its own key; any other file is the same 404.
 */
export async function pagePreviewImageFile(token: string, file: string): Promise<string> {
  const row = await pageOfToken(token);
  const match = MEDIA_FILE_NAME.exec(file);
  const ids = pageAssetIds({ shareImageAssetId: row.shareImageAssetId, sections: Array.isArray(row.sections) ? row.sections : [] });
  if (!match || ids.length === 0) throw new NotFoundError('پیدا نشد');
  const [sha256, thumb] = [match[1], Boolean(match[2])];
  const assets = await orm.select({ lightBytes: mediaAssets.lightBytes, thumbBytes: mediaAssets.thumbBytes }).from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.sha256, sha256), eq(mediaAssets.isDeleted, 0), eq(mediaAssets.kind, 'image'), isNotNull(mediaAssets.lightBytes)));
  if (!assets.some(a => (thumb ? a.thumbBytes : a.lightBytes) !== null)) throw new NotFoundError('پیدا نشد');
  return mediaFilePath(sha256, thumb ? 'thumb' : 'light', 'webp');
}
