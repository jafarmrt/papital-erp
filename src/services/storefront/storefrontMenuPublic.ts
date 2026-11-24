import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { storefrontMenuItems, storefrontMenus } from '../../db/schema.js';
import { MENU_BOTTOM_MIN, MENU_LOCATIONS, isMenuIcon, type MenuLocation } from '../../lib/storefront/storefrontMenuRules.js';
import type { StorefrontPublicMenuItem, StorefrontPublicMenus } from '../../lib/storefront/storefrontMenuContracts.js';
import { siteLinkResolver, type LinkRef } from './storefrontSiteLinkTargets.js';

/**
 * v12 phase 9c (V12_SITE_NEXT_START_PLAN.md §6, `AGENTS.md` §1.9c): `GET /api/storefront/v1/menus`, the menus the site
 * shows. A place goes out only while its switch is on, with only the items that are on and lead somewhere the site has now
 * (a category or a collection with items on the site, a product on the site, a campaign page on and inside its days);
 * a heading goes out only with such a child. The cart and order tracking go out only while the site takes orders. The ERP builds every address: a product's and a campaign page's from their
 * current slugs, so a link follows a change of slug. A place left with nothing to show (or a bottom bar with fewer than
 * three buttons) is null, and the site keeps its fixed menu there.
 */
type ItemRecord = typeof storefrontMenuItems.$inferSelect;

export async function publicMenus(): Promise<StorefrontPublicMenus> {
  const out: StorefrontPublicMenus = { header: null, drawer: null, footer: null, bottom: null };
  const on = (await orm.select({ location: storefrontMenus.location }).from(storefrontMenus).where(eq(storefrontMenus.isEnabled, 1)))
    .map(r => r.location).filter((l): l is MenuLocation => (MENU_LOCATIONS as readonly string[]).includes(l));
  if (on.length === 0) return out;
  const rows = await orm.select().from(storefrontMenuItems)
    .where(and(inArray(storefrontMenuItems.location, on), eq(storefrontMenuItems.isDeleted, 0), eq(storefrontMenuItems.isActive, 1)))
    .orderBy(asc(storefrontMenuItems.position), asc(storefrontMenuItems.id));
  // v12 phase 10e: where each link leads now is worked out by the code a slide's button and a banner use too
  const refOf = (row: ItemRecord): LinkRef => ({
    kind: row.linkKind, target: row.target, itemId: row.targetItemId, campaignId: row.targetCampaignId, pageId: row.targetPageId, newsId: row.targetNewsId,
  });
  const resolve = await siteLinkResolver(rows.map(refOf));
  /** the address of a link the site has now, '' for a heading, null for a link that leads nowhere today */
  const hrefOf = (row: ItemRecord): string | null => (row.linkKind === 'none' ? '' : resolve(refOf(row)));
  const itemOf = (row: ItemRecord, children: StorefrontPublicMenuItem[]): StorefrontPublicMenuItem | null => {
    const href = hrefOf(row);
    if (href === null || (href === '' && children.length === 0)) return null;
    const role = row.linkKind === 'page' && (row.target === 'cart' || row.target === 'account') ? row.target : '';
    return {
      label: row.label, href, external: row.linkKind === 'url', icon: row.location === 'bottom' && isMenuIcon(row.icon) ? row.icon : '',
      role, children,
    };
  };

  for (const location of on) {
    const here = rows.filter(r => r.location === location);
    // the bottom bar's buttons stay on the site: an outside address is not a button there (9c review: it counted toward three)
    const items = here.filter(r => r.parentId === null && !(location === 'bottom' && r.linkKind === 'url')).flatMap((top) => {
      const children = here.filter(r => r.parentId === top.id).flatMap(child => itemOf(child, []) ?? []);
      return itemOf(top, children) ?? [];
    });
    out[location] = items.length === 0 || (location === 'bottom' && items.length < MENU_BOTTOM_MIN) ? null : items;
  }
  return out;
}
