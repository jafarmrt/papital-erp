import type { Request } from 'express';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, storefrontProducts, storefrontRedirects, wcProductLinks } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { nextVersion } from '../../lib/occHelper.js';
import { normalizeSearchText } from '../../lib/search/searchText.js';
import type { StorefrontRedirectImportResult } from '../../lib/storefront/storefrontSeoContracts.js';
import { requireWcConnection, wcListRequest, type WcConnection } from '../woocommerce/wcClient.js';
import { decodeEntities, planRedirectImport, redirectCandidates, type WooRow } from './storefrontRedirectCandidates.js';

/**
 * v11 phase 8.5 (start plan 8.5 §2): «خواندن نشانی‌ها از ووکامرس». One reading of the WooCommerce site's products,
 * categories and tags (only their id, slug, address and name; nothing is written to the site) becomes redirects:
 * - a product's address and its `?p=<id>` form go to the item linked to it in «اتصال ووکامرس» (`wc_product_links`); a
 *   variable product whose colours are several items goes to the first of them in the site's order;
 * - a category's `/product-category/<slug>` and a tag's `/product-tag/<slug>` go to the ERP category or collection of the same
 *   name (the ERP sends its collections to WooCommerce as tags, so their names match).
 * The reading runs again safely: a row the owner made or edited by hand, or removed, is never changed or brought back;
 * a row of an earlier reading is brought in line. The writes are one transaction under the redirects' lock, with one
 * audit row that gives the counts.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
/** rows per insert statement: far under PostgreSQL's limit of parameters in one statement */
const INSERT_CHUNK = 500;
/** changed rows the audit row lists one by one; the counts cover the rest */
const AUDIT_CHANGES_MAX = 200;

async function readList(conn: WcConnection, path: string, fields: string): Promise<{ rows: WooRow[]; truncated: boolean }> {
  const rows: WooRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const answer = await wcListRequest(conn, path, { per_page: PAGE_SIZE, page, orderby: 'id', order: 'asc', _fields: fields });
    const batch = Array.isArray(answer.data) ? answer.data as Array<Record<string, unknown>> : [];
    for (const raw of batch) {
      const id = Number(raw.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      rows.push({
        id, slug: typeof raw.slug === 'string' ? raw.slug : '', permalink: typeof raw.permalink === 'string' ? raw.permalink : '',
        name: typeof raw.name === 'string' ? decodeEntities(raw.name) : '',
      });
    }
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** The site's item for each WooCommerce product: the live links, the first item in the site's order when a product has several */
async function itemsByWooProduct(executor: DbExecutor, productIds: number[]): Promise<Map<number, number>> {
  if (productIds.length === 0) return new Map();
  const links = await executor.select({ productId: wcProductLinks.wcProductId, itemId: wcProductLinks.itemId })
    .from(wcProductLinks)
    .innerJoin(items, and(eq(items.id, wcProductLinks.itemId), eq(items.isDeleted, 0), eq(items.type, 'product')))
    .leftJoin(storefrontProducts, eq(storefrontProducts.itemId, wcProductLinks.itemId))
    .where(and(eq(wcProductLinks.isDeleted, 0), inArray(wcProductLinks.wcProductId, productIds)))
    .orderBy(asc(wcProductLinks.wcProductId), sql`${storefrontProducts.isPublished} DESC NULLS LAST`, sql`${storefrontProducts.sortOrder} ASC NULLS LAST`, asc(wcProductLinks.itemId));
  const out = new Map<number, number>();
  for (const link of links) if (!out.has(link.productId)) out.set(link.productId, link.itemId);
  return out;
}

/** The ERP's category and collection names of live products, by their folded form */
async function erpNames(executor: DbExecutor): Promise<{ categories: Map<string, string>; collections: Map<string, string> }> {
  const rows = await executor.select({ category: items.category, collections: items.collections }).from(items)
    .where(and(eq(items.isDeleted, 0), eq(items.type, 'product')));
  const categories = new Map<string, string>();
  const collections = new Map<string, string>();
  const keep = (map: Map<string, string>, name: string) => {
    const trimmed = name.trim();
    const folded = normalizeSearchText(trimmed);
    if (folded && !map.has(folded)) map.set(folded, trimmed);
  };
  for (const r of rows) {
    keep(categories, r.category ?? '');
    for (const c of r.collections ?? []) keep(collections, c);
  }
  return { categories, collections };
}

export async function importWooRedirects(req: Request): Promise<StorefrontRedirectImportResult> {
  const conn = await requireWcConnection();
  // read the site first, outside the transaction: the shop may be slow, and nothing is locked meanwhile
  const products = await readList(conn, 'products', 'id,slug,permalink');
  const categories = await readList(conn, 'products/categories', 'id,slug,name');
  const tags = await readList(conn, 'products/tags', 'id,slug,name');

  return orm.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'storefront_redirects'}))`);
    const names = await erpNames(tx);
    const { candidates, unmatched } = redirectCandidates({
      products: products.rows, categories: categories.rows, tags: tags.rows,
      itemByProduct: await itemsByWooProduct(tx, products.rows.map(p => p.id)),
      categoryNames: names.categories, collectionNames: names.collections,
    });
    const keys = candidates.map(c => c.fromPath);
    const saved = keys.length === 0 ? [] : await tx.select().from(storefrontRedirects).where(inArray(storefrontRedirects.fromPath, keys)).for('update');
    const plan = planRedirectImport(candidates, saved);
    const user = String((req.user as { username?: string } | undefined)?.username ?? '');
    for (let start = 0; start < plan.inserts.length; start += INSERT_CHUNK) {
      await tx.insert(storefrontRedirects).values(plan.inserts.slice(start, start + INSERT_CHUNK)
        .map(c => ({ ...c, source: 'woocommerce', isActive: 1, createdBy: user, updatedBy: user })));
    }
    for (const { row, candidate } of plan.updates) {
      await tx.update(storefrontRedirects).set({
        targetKind: candidate.targetKind, targetItemId: candidate.targetItemId, target: candidate.target, updatedBy: user,
        updatedAt: systemNowUtcIso(), version: nextVersion(row.version),
      }).where(eq(storefrontRedirects.id, row.id));
    }
    const created = plan.inserts.length;
    const updated = plan.updates.length;
    const result: StorefrontRedirectImportResult = {
      read: { products: products.rows.length, categories: categories.rows.length, tags: tags.rows.length },
      created, updated, unchanged: plan.unchanged, keptManual: plan.kept, unmatched, truncated: products.truncated || categories.truncated || tags.truncated,
    };
    await logActivity({
      req, tx, action: 'SETTING_CHANGE', entity: 'فروشگاه سایت', entityId: 'redirects-import',
      description: `نشانی‌های سایت قبلی از ووکامرس خوانده شد: ${created.toLocaleString('fa-IR')} انتقال تازه، ${updated.toLocaleString('fa-IR')} به‌روز`,
      details: {
        after: result,
        changes: plan.updates.slice(0, AUDIT_CHANGES_MAX).map(({ row, candidate }) => ({
          id: row.id, fromPath: row.fromPath,
          before: { targetKind: row.targetKind, targetItemId: row.targetItemId, target: row.target },
          after: { targetKind: candidate.targetKind, targetItemId: candidate.targetItemId, target: candidate.target },
        })),
      },
    });
    return result;
  });
}
