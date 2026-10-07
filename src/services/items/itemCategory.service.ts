import type { Request } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { categories, items } from '../../db/schema.js';
import { DEFAULT_CATEGORIES } from '../../data/defaultCategories.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { nextVersion } from '../../lib/occHelper.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { assertCategoryNameAvailable, categoryNameKey, guardCategoryName, itemCategoryCondition } from './itemCategoryIdentity.js';

/**
 * v9.0.197 (TD-659، B05-13، تصمیم ت۸ الف): دسته‌بندی کالا حذف نرم می‌شود (`is_deleted`، مهاجرت 0071) و ساخت، ویرایش، حذف و
 * «بازگردانی دسته‌های پیش‌فرض» هر کدام در تراکنش خود یک ردیف ممیزی «دسته‌بندی کالا» با قبل و بعد می‌نویسند. پیش‌تر حذف
 * فیزیکی بود و هیچ تغییر دسته‌ای ممیزی نمی‌شد.
 *
 * v9.0.198 (TD-658، B05-12، ت۸ الف): نام دسته فعال یکتاست (`itemCategoryIdentity.ts`، مهاجرت 0072)؛ تغییر نام، کالاهای فعال
 * دسته را در همان تراکنش به نام تازه می‌برد (قفل کالاها به ترتیب شناسه، نسخه کالا یک گام جلو) و تغییر نوع دسته‌ای که کالای
 * فعال دارد رد می‌شود. پیش‌تر تغییر نام کالاها را به نامی بی‌دسته وصل می‌گذاشت و حذف بعدی دسته پذیرفته می‌شد.
 */
export const CATEGORY_AUDIT_ENTITY = 'دسته‌بندی کالا';

export interface CategoryInput {
  name: string;
  prefix: string;
  type: 'product' | 'raw_material';
  defaultUnit?: string;
}

type CategoryRow = typeof categories.$inferSelect;

function snapshot(row: Pick<CategoryRow, 'name' | 'prefix' | 'type' | 'defaultUnit'>) {
  return { name: row.name, prefix: row.prefix, type: row.type, defaultUnit: row.defaultUnit ?? 'عدد' };
}

function changedFields(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof typeof after>) {
    if (before[key] !== after[key]) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

async function lockActiveCategory(tx: DbExecutor, id: number): Promise<CategoryRow> {
  const [row] = await tx.select().from(categories).where(and(eq(categories.id, id), eq(categories.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('دسته بندی مورد نظر یافت نشد.');
  return row;
}

async function activeItemsOfCategory(tx: DbExecutor, name: string) {
  return tx.select({ id: items.id, version: items.version }).from(items)
    .where(and(itemCategoryCondition(name), eq(items.isDeleted, 0))).orderBy(asc(items.id));
}

/** کالاهای فعال دسته به نام تازه می‌روند: قفل به ترتیب شناسه (همان قفل گردش انبار)، سپس نوشتن با نسخه بعدی هر کالا */
async function moveItemsToCategoryName(tx: DbExecutor, rows: Array<{ id: number; version: number }>, newName: string): Promise<void> {
  await lockStockItems(tx, rows.map(r => r.id));
  const idsByVersion = new Map<number, number[]>();
  for (const r of rows) idsByVersion.set(r.version, [...(idsByVersion.get(r.version) ?? []), r.id]);
  for (const [version, ids] of idsByVersion) {
    await tx.update(items).set({ category: newName, version: nextVersion(version) })
      .where(and(inArray(items.id, ids), eq(items.version, version)));
  }
}

export async function listActiveCategories(executor: DbExecutor = orm): Promise<CategoryRow[]> {
  return executor.select().from(categories).where(eq(categories.isDeleted, 0)).orderBy(asc(categories.type), asc(categories.id));
}

export async function createCategory(req: Request, input: CategoryInput): Promise<CategoryRow> {
  return guardCategoryName(input.name, () => orm.transaction(async (tx) => {
    await assertCategoryNameAvailable(tx, input.name);
    const [created] = await tx.insert(categories).values({ ...input, defaultUnit: input.defaultUnit || 'عدد' }).returning();
    await logActivity({
      req, tx, action: 'CREATE', entity: CATEGORY_AUDIT_ENTITY, entityId: created.id,
      description: `ساخت دسته‌بندی «${created.name}»`,
      details: { after: snapshot(created) },
    });
    return created;
  }));
}

export async function updateCategory(req: Request, id: number, input: CategoryInput): Promise<void> {
  await guardCategoryName(input.name, () => orm.transaction(async (tx) => {
    const prev = await lockActiveCategory(tx, id);
    const next = { ...input, defaultUnit: input.defaultUnit || 'عدد' };
    const renamed = next.name !== prev.name;
    if (renamed) await assertCategoryNameAvailable(tx, next.name, id);
    const itemRows = renamed || next.type !== prev.type ? await activeItemsOfCategory(tx, prev.name) : [];
    if (next.type !== prev.type && itemRows.length > 0) {
      throw new ValidationError(`نوع دسته‌بندی «${prev.name}» تغییر نمی‌کند، زیرا ${itemRows.length} کالای فعال در آن هست؛ کالاها را نخست به دسته دیگری ببرید.`, undefined, 'CATEGORY_TYPE_HAS_ITEMS');
    }
    await tx.update(categories).set(next).where(eq(categories.id, id));
    if (renamed && itemRows.length > 0) await moveItemsToCategoryName(tx, itemRows, next.name);
    const before = snapshot(prev);
    const after = snapshot(next);
    await logActivity({
      req, tx, action: 'UPDATE', entity: CATEGORY_AUDIT_ENTITY, entityId: id,
      description: renamed && itemRows.length > 0
        ? `ویرایش دسته‌بندی «${prev.name}» و انتقال ${itemRows.length} کالا به نام «${next.name}»`
        : `ویرایش دسته‌بندی «${prev.name}»`,
      details: {
        before, after, changes: changedFields(before, after),
        ...(renamed && itemRows.length > 0 ? { movedItems: { count: itemRows.length, itemIds: itemRows.map(r => r.id) } } : {}),
      },
    });
  }));
}

export async function deleteCategory(req: Request, id: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const cat = await lockActiveCategory(tx, id);
    const [hasItems] = await tx.select({ id: items.id }).from(items)
      .where(and(itemCategoryCondition(cat.name), eq(items.isDeleted, 0))).limit(1);
    if (hasItems) {
      throw new ValidationError('امکان حذف این دسته بندی وجود ندارد؛ زیرا کالاهای فعال در سیستم به آن ارجاع داده‌اند.');
    }
    await tx.update(categories).set({ isDeleted: 1 }).where(eq(categories.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: CATEGORY_AUDIT_ENTITY, entityId: id,
      description: `حذف دسته‌بندی «${cat.name}»`,
      details: { before: snapshot(cat) },
    });
  });
}

/**
 * «بازگردانی دسته‌های پیش‌فرض»: هر دسته فهرست seed اگر فعال است پیشوند، نوع و واحدش به پیش‌فرض برمی‌گردد، اگر حذف شده
 * بازگردانده می‌شود و اگر نیست ساخته می‌شود؛ یک ردیف ممیزی همه تغییرها را با قبل و بعد نگه می‌دارد. دسته با کلید نام
 * (`categoryNameKey`) پیدا می‌شود و نامش دست نمی‌خورد؛ نوع دسته‌ای که کالای فعال دارد مثل ویرایش دستی تغییر نمی‌کند
 * (`typeKept` در ممیزی، v9.0.198، TD-658).
 */
export async function resetDefaultCategories(req: Request): Promise<CategoryRow[]> {
  return orm.transaction(async (tx) => {
    const rows = await tx.select().from(categories).orderBy(asc(categories.id)).for('update');
    const byKey = new Map<string, CategoryRow>();
    for (const row of rows) {
      const key = categoryNameKey(row.name);
      const known = byKey.get(key);
      if (!known || (known.isDeleted === 1 && row.isDeleted === 0)) byKey.set(key, row);
    }
    const changes: Array<{
      name: string; action: 'CREATED' | 'UPDATED' | 'RESTORED'; before?: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot>; typeKept?: true;
    }> = [];
    for (const def of DEFAULT_CATEGORIES) {
      const existing = byKey.get(categoryNameKey(def.name));
      if (!existing) {
        await tx.insert(categories).values({ ...def });
        changes.push({ name: def.name, action: 'CREATED', after: snapshot(def) });
        continue;
      }
      const typeKept = existing.type !== def.type && (await activeItemsOfCategory(tx, existing.name)).length > 0;
      const target = { name: existing.name, prefix: def.prefix, type: typeKept ? existing.type : def.type, defaultUnit: def.defaultUnit };
      const before = snapshot(existing);
      const after = snapshot(target);
      if (existing.isDeleted === 0 && Object.keys(changedFields(before, after)).length === 0) continue;
      await tx.update(categories).set({ prefix: target.prefix, type: target.type, defaultUnit: target.defaultUnit, isDeleted: 0 }).where(eq(categories.id, existing.id));
      changes.push({ name: existing.name, action: existing.isDeleted === 1 ? 'RESTORED' : 'UPDATED', before, after, ...(typeKept ? { typeKept: true as const } : {}) });
    }
    if (changes.length > 0) {
      await logActivity({
        req, tx, action: 'UPDATE', entity: CATEGORY_AUDIT_ENTITY,
        description: `بازگردانی دسته‌بندی‌های پیش‌فرض: ${changes.length} تغییر`,
        details: { changes },
      });
    }
    return listActiveCategories(tx);
  });
}
