import type { Request } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { categories, items } from '../../db/schema.js';
import { DEFAULT_CATEGORIES } from '../../data/defaultCategories.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';

/**
 * v9.0.177 (TD-659، B05-13، تصمیم ت۸ الف): دسته‌بندی کالا حذف نرم می‌شود (`is_deleted`، مهاجرت 0071) و ساخت، ویرایش، حذف و
 * «بازگردانی دسته‌های پیش‌فرض» هر کدام در تراکنش خود یک ردیف ممیزی «دسته‌بندی کالا» با قبل و بعد می‌نویسند. پیش‌تر حذف
 * فیزیکی بود و هیچ تغییر دسته‌ای ممیزی نمی‌شد.
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

export async function listActiveCategories(executor: DbExecutor = orm): Promise<CategoryRow[]> {
  return executor.select().from(categories).where(eq(categories.isDeleted, 0)).orderBy(asc(categories.type), asc(categories.id));
}

export async function createCategory(req: Request, input: CategoryInput): Promise<CategoryRow> {
  return orm.transaction(async (tx) => {
    const [created] = await tx.insert(categories).values({ ...input, defaultUnit: input.defaultUnit || 'عدد' }).returning();
    await logActivity({
      req, tx, action: 'CREATE', entity: CATEGORY_AUDIT_ENTITY, entityId: created.id,
      description: `ساخت دسته‌بندی «${created.name}»`,
      details: { after: snapshot(created) },
    });
    return created;
  });
}

export async function updateCategory(req: Request, id: number, input: CategoryInput): Promise<void> {
  await orm.transaction(async (tx) => {
    const prev = await lockActiveCategory(tx, id);
    const next = { ...input, defaultUnit: input.defaultUnit || 'عدد' };
    await tx.update(categories).set(next).where(eq(categories.id, id));
    const before = snapshot(prev);
    const after = snapshot(next);
    await logActivity({
      req, tx, action: 'UPDATE', entity: CATEGORY_AUDIT_ENTITY, entityId: id,
      description: `ویرایش دسته‌بندی «${prev.name}»`,
      details: { before, after, changes: changedFields(before, after) },
    });
  });
}

export async function deleteCategory(req: Request, id: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const cat = await lockActiveCategory(tx, id);
    const [hasItems] = await tx.select({ id: items.id }).from(items)
      .where(and(eq(items.category, cat.name), eq(items.isDeleted, 0))).limit(1);
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
 * بازگردانده می‌شود و اگر نیست ساخته می‌شود؛ یک ردیف ممیزی همه تغییرها را با قبل و بعد نگه می‌دارد.
 */
export async function resetDefaultCategories(req: Request): Promise<CategoryRow[]> {
  return orm.transaction(async (tx) => {
    const rows = await tx.select().from(categories).orderBy(asc(categories.id)).for('update');
    const byName = new Map<string, CategoryRow>();
    for (const row of rows) {
      const known = byName.get(row.name);
      if (!known || (known.isDeleted === 1 && row.isDeleted === 0)) byName.set(row.name, row);
    }
    const changes: Array<{ name: string; action: 'CREATED' | 'UPDATED' | 'RESTORED'; before?: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot> }> = [];
    for (const def of DEFAULT_CATEGORIES) {
      const after = snapshot(def);
      const existing = byName.get(def.name);
      if (!existing) {
        await tx.insert(categories).values({ ...def });
        changes.push({ name: def.name, action: 'CREATED', after });
        continue;
      }
      const before = snapshot(existing);
      if (existing.isDeleted === 0 && Object.keys(changedFields(before, after)).length === 0) continue;
      await tx.update(categories).set({ prefix: def.prefix, type: def.type, defaultUnit: def.defaultUnit, isDeleted: 0 }).where(eq(categories.id, existing.id));
      changes.push({ name: def.name, action: existing.isDeleted === 1 ? 'RESTORED' : 'UPDATED', before, after });
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
