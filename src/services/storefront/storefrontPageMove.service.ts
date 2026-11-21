import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { storefrontPages } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { nextVersion } from '../../lib/occHelper.js';
import { PAGE_SLUG_MAX } from '../../lib/storefront/storefrontPageRules.js';
import { STOREFRONT_SLUG_PATTERN } from '../../lib/storefront/storefrontRules.js';
import type { PageDetail } from '../../lib/storefront/storefrontPageContracts.js';
import { lockedPageRow, pageDetail } from './storefrontPages.service.js';
import { redirectMovedPage } from './storefrontRedirects.service.js';

/**
 * v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «تغییر نشانی», a new address for a page the shop made.
 * A draft save never moves a page that is on the site; this does, and in the same transaction writes the old address
 * into «نشانی‌های سایت قبلی» so that it goes to the new one for good (301): a link in a search result, a post or a
 * bookmark keeps working. A page that is not on the site just takes the new address (there is nothing to keep working).
 * A base page never moves. Menu links name a page by its row, so they follow by themselves.
 */
const pagePath = (slug: string) => `/pages/${slug}`;

/** `POST /api/storefront/pages/:id/move` */
export async function movePage(req: Request, id: number, slug: string, version: number): Promise<PageDetail> {
  const wanted = slug.trim();
  if (!wanted || wanted.length > PAGE_SLUG_MAX || !STOREFRONT_SLUG_PATTERN.test(wanted)) {
    throw new ValidationError(
      `نشانی لاتین صفحه حداکثر ${PAGE_SLUG_MAX.toLocaleString('fa-IR')} نویسه است و فقط حرف کوچک انگلیسی، رقم و خط تیره میان کلمه‌ها دارد، مانند our-story.`,
      { field: 'slug' }, 'STOREFRONT_PAGE_SLUG_INVALID',
    );
  }
  await orm.transaction(async (tx) => {
    const row = await lockedPageRow(tx, id, version);
    if (row.kind === 'base') throw new ValidationError('نشانی صفحه‌های پایهٔ سایت عوض نمی‌شود.', { field: 'slug' }, 'STOREFRONT_PAGE_BASE_KEPT');
    if (wanted === row.slug) return;
    const [taken] = await tx.select({ id: storefrontPages.id }).from(storefrontPages)
      .where(and(eq(storefrontPages.slug, wanted), eq(storefrontPages.isDeleted, 0)));
    if (taken) throw new ConflictError('صفحهٔ دیگری همین نشانی را دارد.', { field: 'slug' }, 'STOREFRONT_PAGE_SLUG_TAKEN');
    const actor = String((req.user as { username?: string } | undefined)?.username ?? '');
    await tx.update(storefrontPages).set({ slug: wanted, version: nextVersion(row.version), updatedBy: actor, updatedAt: systemNowUtcIso() })
      .where(eq(storefrontPages.id, id));
    const onSite = row.published !== null;
    if (onSite) await redirectMovedPage(req, tx, { from: pagePath(row.slug), to: pagePath(wanted), title: row.published?.title ?? row.title });
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'صفحهٔ سایت', entityId: `page-${id}`,
      description: `نشانی صفحهٔ «${row.title}» از ${pagePath(row.slug)} به ${pagePath(wanted)} عوض شد`,
      details: { before: { slug: row.slug }, after: { slug: wanted }, onSite, oldAddressRedirected: onSite },
    });
  });
  return pageDetail(orm, id);
}
