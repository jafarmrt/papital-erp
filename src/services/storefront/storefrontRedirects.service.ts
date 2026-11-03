import type { Request } from 'express';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, storefrontProducts, storefrontRedirects } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { foldedContains } from '../../lib/search/searchSql.js';
import {
  REDIRECTS_MAX, REDIRECT_NOTE_MAX, REDIRECT_TARGET_KIND_TITLES, legacyPathError, legacyPathKey, redirectTargetError,
  type RedirectSource, type RedirectTargetKind,
} from '../../lib/storefront/storefrontSeoRules.js';
import type {
  StorefrontPublicRedirect, StorefrontRedirectInput, StorefrontRedirectPage, StorefrontRedirectRow,
} from '../../lib/storefront/storefrontSeoContracts.js';

/**
 * v11 phase 8.5 (package 18, start plan 8.5 §2): the old addresses of the WooCommerce site and where each goes on the new
 * site, so a link in an Instagram post, a search result or a buyer's bookmark keeps working after the switch. The list is
 * filtered and paged on the server; every write is one row under its version with one audit row in the same
 * transaction, and every write (and the reading of the WooCommerce site) takes the table's transaction lock, so two saves
 * of one old address never both pass the uniqueness check. Removing is a soft delete.
 */
export const REDIRECT_PAGE_MAX = 100;
const LOCK_NAME = 'storefront_redirects';

const lockRedirects = (tx: DbExecutor) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`);
const userOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');

export interface RedirectListQuery {
  page: number;
  limit: number;
  q: string;
  source: RedirectSource | '';
}

type RawRow = typeof storefrontRedirects.$inferSelect;

async function rowsWithTargets(executor: DbExecutor, rows: RawRow[]): Promise<StorefrontRedirectRow[]> {
  const itemIds = [...new Set(rows.map(r => r.targetItemId).filter((id): id is number => id !== null))];
  const targets = itemIds.length === 0 ? [] : await executor.select({
    itemId: items.id, code: items.code, name: items.name, slug: storefrontProducts.slug, published: storefrontProducts.isPublished,
  }).from(items).leftJoin(storefrontProducts, eq(storefrontProducts.itemId, items.id)).where(inArray(items.id, itemIds));
  const byItem = new Map(targets.map(t => [t.itemId, t]));
  return rows.map(r => {
    const target = r.targetItemId === null ? undefined : byItem.get(r.targetItemId);
    return {
      id: r.id, fromPath: r.fromPath, targetKind: r.targetKind as RedirectTargetKind, targetItemId: r.targetItemId, target: r.target,
      note: r.note, isActive: r.isActive === 1, source: r.source as RedirectSource,
      targetCode: target?.code ?? '', targetName: target?.name ?? '', targetSlug: target?.published === 1 ? (target.slug ?? '') : '',
      version: r.version,
    };
  });
}

export async function listRedirects(query: RedirectListQuery): Promise<StorefrontRedirectPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(REDIRECT_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [eq(storefrontRedirects.isDeleted, 0)];
  if (query.source) conditions.push(eq(storefrontRedirects.source, query.source));
  // the old address by its key (a pasted link or an encoded path finds its row), the target, the note and the product
  const key = legacyPathKey(query.q);
  const searched = foldedContains([storefrontRedirects.fromPath, storefrontRedirects.target, storefrontRedirects.note, items.code, items.name], query.q);
  const byKey = key ? sql`${storefrontRedirects.fromPath} = ${key}` : undefined;
  if (searched || byKey) conditions.push((byKey && searched ? sql`(${byKey} OR ${searched})` : (byKey ?? searched)) as SQL);
  const where = and(...conditions);
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontRedirects)
    .leftJoin(items, eq(items.id, storefrontRedirects.targetItemId)).where(where);
  const rows = await orm.select({ row: storefrontRedirects }).from(storefrontRedirects)
    .leftJoin(items, eq(items.id, storefrontRedirects.targetItemId)).where(where)
    .orderBy(desc(storefrontRedirects.id)).limit(limit).offset((page - 1) * limit);
  return { data: await rowsWithTargets(orm, rows.map(r => r.row)), total, page, limit };
}

interface CheckedInput {
  fromPath: string;
  targetKind: RedirectTargetKind;
  targetItemId: number | null;
  target: string;
  note: string;
  isActive: boolean;
}

async function checkedInput(tx: DbExecutor, input: StorefrontRedirectInput): Promise<CheckedInput> {
  const pathProblem = legacyPathError(input.fromPath);
  if (pathProblem) throw new ValidationError(pathProblem, { field: 'fromPath' }, 'STOREFRONT_REDIRECT_FROM_INVALID');
  const fromPath = legacyPathKey(input.fromPath) as string;
  const target = input.targetKind === 'product' ? '' : input.target.trim();
  const targetProblem = redirectTargetError(input.targetKind, target);
  if (targetProblem) throw new ValidationError(targetProblem, { field: 'target' }, 'STOREFRONT_REDIRECT_TARGET_INVALID');
  const note = input.note.trim();
  if (note.length > REDIRECT_NOTE_MAX) {
    throw new ValidationError(`یادداشت حداکثر ${REDIRECT_NOTE_MAX.toLocaleString('fa-IR')} نویسه است.`, { field: 'note' }, 'STOREFRONT_REDIRECT_NOTE_TOO_LONG');
  }
  let targetItemId: number | null = null;
  if (input.targetKind === 'product') {
    if (!input.targetItemId) throw new ValidationError('محصول مقصد را انتخاب کنید.', { field: 'targetItemId' }, 'STOREFRONT_REDIRECT_TARGET_INVALID');
    const [item] = await tx.select({ id: items.id }).from(items)
      .where(and(eq(items.id, input.targetItemId), eq(items.isDeleted, 0), eq(items.type, 'product'))).for('share');
    if (!item) throw new ValidationError('محصول مقصد پیدا نشد.', { field: 'targetItemId' }, 'STOREFRONT_REDIRECT_TARGET_INVALID');
    targetItemId = item.id;
  }
  return { fromPath, targetKind: input.targetKind, targetItemId, target, note, isActive: input.isActive };
}

async function assertFromFree(tx: DbExecutor, fromPath: string, exceptId: number | null): Promise<void> {
  const [taken] = await tx.select({ id: storefrontRedirects.id }).from(storefrontRedirects)
    .where(and(eq(storefrontRedirects.fromPath, fromPath), eq(storefrontRedirects.isDeleted, 0), exceptId === null ? sql`true` : sql`${storefrontRedirects.id} <> ${exceptId}`))
    .limit(1);
  if (taken) throw new ConflictError(`برای نشانی «${fromPath}» پیش‌تر انتقالی ثبت شده است.`, { id: taken.id }, 'STOREFRONT_REDIRECT_FROM_TAKEN');
}

const auditView = (r: Pick<RawRow, 'fromPath' | 'targetKind' | 'targetItemId' | 'target' | 'note' | 'isActive'>) => ({
  fromPath: r.fromPath, targetKind: r.targetKind, targetItemId: r.targetItemId, target: r.target, note: r.note, isActive: r.isActive === 1,
});

async function oneRow(id: number): Promise<StorefrontRedirectRow> {
  const [row] = await orm.select().from(storefrontRedirects).where(and(eq(storefrontRedirects.id, id), eq(storefrontRedirects.isDeleted, 0)));
  if (!row) throw new NotFoundError('انتقال نشانی پیدا نشد.', undefined, 'STOREFRONT_REDIRECT_NOT_FOUND');
  return (await rowsWithTargets(orm, [row]))[0];
}

export async function createRedirect(req: Request, input: StorefrontRedirectInput): Promise<StorefrontRedirectRow> {
  const id = await orm.transaction(async (tx) => {
    await lockRedirects(tx);
    const values = await checkedInput(tx, input);
    await assertFromFree(tx, values.fromPath, null);
    const [created] = await tx.insert(storefrontRedirects).values({
      ...values, isActive: values.isActive ? 1 : 0, source: 'manual', createdBy: userOf(req), updatedBy: userOf(req),
    }).returning({ id: storefrontRedirects.id });
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: `redirect-${created.id}`,
      description: `انتقال نشانی قدیمی «${values.fromPath}» به ${REDIRECT_TARGET_KIND_TITLES[values.targetKind]} ثبت شد`,
      details: { after: auditView({ ...values, isActive: values.isActive ? 1 : 0 }) },
    });
    return created.id;
  });
  return oneRow(id);
}

async function lockedRow(tx: DbExecutor, id: number, version: number): Promise<RawRow> {
  const [current] = await tx.select().from(storefrontRedirects)
    .where(and(eq(storefrontRedirects.id, id), eq(storefrontRedirects.isDeleted, 0))).for('update');
  if (!current) throw new NotFoundError('انتقال نشانی پیدا نشد.', undefined, 'STOREFRONT_REDIRECT_NOT_FOUND');
  if (current.version !== version) {
    throw new OptimisticLockError({ entityType: 'StorefrontRedirect', entityId: id, expectedVersion: version, currentVersion: current.version });
  }
  return current;
}

/** An edit by hand makes the row a manual one, so the next reading of the WooCommerce site leaves it as the owner set it */
export async function updateRedirect(req: Request, id: number, input: StorefrontRedirectInput & { version: number }): Promise<StorefrontRedirectRow> {
  await orm.transaction(async (tx) => {
    await lockRedirects(tx);
    const current = await lockedRow(tx, id, input.version);
    const values = await checkedInput(tx, input);
    await assertFromFree(tx, values.fromPath, id);
    const after = { ...values, isActive: values.isActive ? 1 : 0 };
    if (JSON.stringify(auditView(current)) === JSON.stringify(auditView(after))) return;
    await tx.update(storefrontRedirects).set({
      ...after, source: 'manual', updatedBy: userOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(current.version),
    }).where(eq(storefrontRedirects.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'فروشگاه سایت', entityId: `redirect-${id}`,
      description: `انتقال نشانی قدیمی «${values.fromPath}» ویرایش شد`, details: { before: auditView(current), after: auditView(after) },
    });
  });
  return oneRow(id);
}

/** A switch sends its target state (`AGENTS.md` §6.9): a repeat changes nothing */
export async function setRedirectActive(req: Request, id: number, active: boolean, version: number): Promise<StorefrontRedirectRow> {
  await orm.transaction(async (tx) => {
    await lockRedirects(tx);
    const current = await lockedRow(tx, id, version);
    if ((current.isActive === 1) === active) return;
    await tx.update(storefrontRedirects).set({
      isActive: active ? 1 : 0, updatedBy: userOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(current.version),
    }).where(eq(storefrontRedirects.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'فروشگاه سایت', entityId: `redirect-${id}`,
      description: `انتقال نشانی قدیمی «${current.fromPath}» ${active ? 'روشن' : 'خاموش'} شد`,
      details: { before: { isActive: current.isActive === 1 }, after: { isActive: active } },
    });
  });
  return oneRow(id);
}

export async function deleteRedirect(req: Request, id: number, version: number): Promise<void> {
  await orm.transaction(async (tx) => {
    await lockRedirects(tx);
    const current = await lockedRow(tx, id, version);
    await tx.update(storefrontRedirects).set({
      isDeleted: 1, updatedBy: userOf(req), updatedAt: systemNowUtcIso(), version: nextVersion(current.version),
    }).where(eq(storefrontRedirects.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: 'فروشگاه سایت', entityId: `redirect-${id}`,
      description: `انتقال نشانی قدیمی «${current.fromPath}» حذف شد`, details: { before: auditView(current) },
    });
  });
}

/**
 * `GET /api/storefront/v1/redirects`: every live, switched-on redirect whose target is on the site: a product only while it
 * is published (by its current slug), the other kinds as saved. A product that left the site drops out, so its old
 * address falls back to the site's own guess (a search) instead of a page that 404s.
 */
export async function publicRedirects(): Promise<StorefrontPublicRedirect[]> {
  const rows = await orm.select({
    from: storefrontRedirects.fromPath, kind: storefrontRedirects.targetKind, target: storefrontRedirects.target,
    slug: storefrontProducts.slug, published: storefrontProducts.isPublished, itemDeleted: items.isDeleted,
  }).from(storefrontRedirects)
    .leftJoin(items, eq(items.id, storefrontRedirects.targetItemId))
    .leftJoin(storefrontProducts, eq(storefrontProducts.itemId, storefrontRedirects.targetItemId))
    .where(and(eq(storefrontRedirects.isDeleted, 0), eq(storefrontRedirects.isActive, 1)))
    .orderBy(asc(storefrontRedirects.id)).limit(REDIRECTS_MAX);
  const out: StorefrontPublicRedirect[] = [];
  for (const r of rows) {
    const kind = r.kind as RedirectTargetKind;
    if (kind === 'product') {
      if (r.published !== 1 || r.itemDeleted !== 0 || !r.slug) continue;
      out.push({ from: r.from, kind, target: r.slug });
    } else {
      out.push({ from: r.from, kind, target: r.target });
    }
  }
  return out;
}
