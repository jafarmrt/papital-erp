import type { Request } from 'express';
import { and, asc, eq, inArray, ne, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customerTagLinks, customerTags, customers } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import {
  CUSTOMER_TAGS_PER_PARTY_MAX, customerTagNameError, isCustomerTagColor,
  type CustomerTag, type CustomerTagColor, type CustomerTagRow,
} from '../../lib/customers/customerTags.js';

/**
 * v10.1.23 (N-02 بخش ۳، ت۱۳ طرح ارتباط با مشتری): برچسب‌های طرف حساب. ساخت، ویرایش و حذف (نرم) برچسب و تغییر برچسب‌های
 * یک طرف حساب هر کدام در تراکنش خود با ردیف ممیزی همان `tx` نوشته می‌شوند. نام برچسب زنده یکتاست (`lower(btrim(name))`،
 * نمایه `uq_customer_tags_name_active`، مهاجرت 0115). برچسب حذف‌شده روی هیچ طرف حسابی خوانده نمی‌شود.
 */
export const CUSTOMER_TAG_AUDIT_ENTITY = 'برچسب مشتری';
const NAME_UNIQUE_INDEX = 'uq_customer_tags_name_active';

type TagTableRow = typeof customerTags.$inferSelect;

export interface CustomerTagInput {
  name: string;
  color?: string;
}

function takenMessage(name: string): string {
  return `برچسب «${name.trim()}» از قبل هست؛ نام دیگری انتخاب کنید.`;
}

function checkedInput(input: CustomerTagInput, current?: TagTableRow): { name: string; color: CustomerTagColor } {
  const nameError = customerTagNameError(input.name);
  if (nameError) throw new ValidationError(nameError, undefined, 'CUSTOMER_TAG_NAME_INVALID');
  const color = input.color ?? current?.color ?? 'slate';
  if (!isCustomerTagColor(color)) throw new ValidationError('رنگ برچسب از فهرست رنگ‌ها نیست.', undefined, 'CUSTOMER_TAG_COLOR_INVALID');
  return { name: input.name.trim(), color };
}

async function assertNameFree(tx: DbExecutor, name: string, excludeId?: number): Promise<void> {
  const conditions: SQL[] = [eq(customerTags.isDeleted, 0), sql`lower(btrim(${customerTags.name})) = lower(btrim(${name}::text))`];
  if (excludeId !== undefined) conditions.push(ne(customerTags.id, excludeId));
  const [taken] = await tx.select({ id: customerTags.id }).from(customerTags).where(and(...conditions)).limit(1);
  if (taken) throw new ConflictError(takenMessage(name), undefined, 'CUSTOMER_TAG_NAME_TAKEN');
}

/** نقض نمایه یکتا در پنجره رقابتی همان ۴۰۹ فارسی می‌شود */
async function guardName<T>(name: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
      const pg = e as { code?: unknown; constraint?: unknown };
      if (pg.code === '23505' && pg.constraint === NAME_UNIQUE_INDEX) throw new ConflictError(takenMessage(name), undefined, 'CUSTOMER_TAG_NAME_TAKEN');
    }
    throw err;
  }
}

async function lockLiveTag(tx: DbExecutor, id: number): Promise<TagTableRow> {
  const [row] = await tx.select().from(customerTags).where(and(eq(customerTags.id, id), eq(customerTags.isDeleted, 0))).for('update');
  if (!row) throw new NotFoundError('برچسب یافت نشد.', undefined, 'CUSTOMER_TAG_NOT_FOUND');
  return row;
}

const snapshot = (row: TagTableRow) => ({ name: row.name, color: row.color });

/** شرط «طرف حساب زنده‌ای که این برچسب را دارد» روی ستون شناسه طرف حساب */
function liveTagOfCustomer(customerIdColumn: SQL | AnyColumn, tagId: number): SQL {
  return sql`EXISTS (SELECT 1 FROM customer_tag_links ctl JOIN customer_tags ct ON ct.id = ctl.tag_id AND ct.is_deleted = 0
    WHERE ctl.customer_id = ${customerIdColumn} AND ctl.tag_id = ${tagId})`;
}

/** شرط پالایش فهرست طرف حساب‌ها با یک برچسب */
export function customerHasTagCondition(tagId: number): SQL {
  return liveTagOfCustomer(customers.id, tagId);
}

/** شرط پالایش پرونده‌های فروش با برچسب طرف حساب پرونده (پرونده بی شناسه طرف حساب برچسبی ندارد) */
export function leadCustomerHasTagCondition(leadCustomerIdColumn: SQL | AnyColumn, tagId: number): SQL {
  return liveTagOfCustomer(leadCustomerIdColumn, tagId);
}

export async function listCustomerTags(): Promise<CustomerTagRow[]> {
  const rows = await orm.select({
    id: customerTags.id, name: customerTags.name, color: customerTags.color, version: customerTags.version,
    customerCount: sql<string>`(SELECT count(*) FROM customer_tag_links ctl JOIN customers c ON c.id = ctl.customer_id AND c.is_deleted = 0
      WHERE ctl.tag_id = customer_tags.id)::text`,
  }).from(customerTags).where(eq(customerTags.isDeleted, 0)).orderBy(asc(customerTags.name), asc(customerTags.id));
  return rows.map((r) => ({ ...r, color: isCustomerTagColor(r.color) ? r.color : 'slate', customerCount: Number(r.customerCount) }));
}

/** برچسب‌های زنده هر طرف حساب، برای سطرهای یک صفحه از فهرست */
export async function tagsByCustomer(customerIds: ReadonlyArray<number>, executor: DbExecutor): Promise<Map<number, CustomerTag[]>> {
  const map = new Map<number, CustomerTag[]>();
  if (customerIds.length === 0) return map;
  const rows = await executor.select({ customerId: customerTagLinks.customerId, id: customerTags.id, name: customerTags.name, color: customerTags.color })
    .from(customerTagLinks)
    .innerJoin(customerTags, and(eq(customerTags.id, customerTagLinks.tagId), eq(customerTags.isDeleted, 0)))
    .where(inArray(customerTagLinks.customerId, [...new Set(customerIds)]))
    .orderBy(asc(customerTags.name), asc(customerTags.id));
  for (const r of rows) {
    const tag: CustomerTag = { id: r.id, name: r.name, color: isCustomerTagColor(r.color) ? r.color : 'slate' };
    map.set(r.customerId, [...(map.get(r.customerId) ?? []), tag]);
  }
  return map;
}

export async function createCustomerTag(req: Request, input: CustomerTagInput): Promise<TagTableRow> {
  const values = checkedInput(input);
  return guardName(values.name, () => orm.transaction(async (tx) => {
    await assertNameFree(tx, values.name);
    const [created] = await tx.insert(customerTags).values({ ...values, createdById: req.user?.id ?? null }).returning();
    await logActivity({
      req, tx, action: 'CREATE', entity: CUSTOMER_TAG_AUDIT_ENTITY, entityId: created.id,
      description: `ساخت برچسب مشتری «${created.name}»`, details: { after: snapshot(created) },
    });
    return created;
  }));
}

export async function updateCustomerTag(req: Request, id: number, input: CustomerTagInput & { version: number }): Promise<TagTableRow> {
  return guardName(input.name, () => orm.transaction(async (tx) => {
    const before = await lockLiveTag(tx, id);
    if (before.version !== input.version) throw new OptimisticLockError({ entityType: 'CustomerTag', entityId: id, expectedVersion: input.version });
    const values = checkedInput(input, before);
    if (values.name.toLowerCase() !== before.name.trim().toLowerCase()) await assertNameFree(tx, values.name, id);
    const [after] = await tx.update(customerTags)
      .set({ ...values, version: nextVersion(before.version), updatedAt: sql`now()` })
      .where(eq(customerTags.id, id)).returning();
    await logActivity({
      req, tx, action: 'UPDATE', entity: CUSTOMER_TAG_AUDIT_ENTITY, entityId: id,
      description: `ویرایش برچسب مشتری «${after.name}»`, details: { before: snapshot(before), after: snapshot(after) },
    });
    return after;
  }));
}

/** حذف نرم؛ پیوندهای طرف حساب‌ها می‌مانند ولی برچسب حذف‌شده جایی خوانده نمی‌شود */
export async function deleteCustomerTag(req: Request, id: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const before = await lockLiveTag(tx, id);
    const [{ n }] = await tx.select({ n: sql<string>`count(*)::text` }).from(customerTagLinks).where(eq(customerTagLinks.tagId, id));
    await tx.update(customerTags).set({ isDeleted: 1, version: nextVersion(before.version), updatedAt: sql`now()` }).where(eq(customerTags.id, id));
    await logActivity({
      req, tx, action: 'DELETE', entity: CUSTOMER_TAG_AUDIT_ENTITY, entityId: id,
      description: `حذف برچسب مشتری «${before.name}»`, details: { before: snapshot(before), linkedCustomers: Number(n) },
    });
  });
}

/**
 * برچسب‌های یک طرف حساب را برابر `tagIds` می‌کند، در تراکنش ساخت یا ویرایش طرف حساب. هر شناسه باید برچسب زنده باشد
 * (برچسب‌ها `FOR SHARE` خوانده می‌شوند تا هم‌زمان حذف نشوند)، وگرنه ۴۲۲ و هیچ نوشتنی. نام برچسب‌های پیش و پس برمی‌گردد.
 */
export async function setCustomerTags(
  tx: DbExecutor,
  customerId: number,
  tagIds: ReadonlyArray<number>,
  userId: number | null,
): Promise<{ before: string[]; after: string[] }> {
  const wanted = [...new Set(tagIds.map(Number))];
  if (wanted.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError('شناسه برچسب نامعتبر است.', undefined, 'CUSTOMER_TAG_INVALID');
  }
  if (wanted.length > CUSTOMER_TAGS_PER_PARTY_MAX) {
    throw new ValidationError(`یک طرف حساب حداکثر ${CUSTOMER_TAGS_PER_PARTY_MAX.toLocaleString('fa-IR')} برچسب دارد.`, undefined, 'CUSTOMER_TAG_INVALID');
  }
  const live = wanted.length === 0 ? [] : await tx.select({ id: customerTags.id, name: customerTags.name }).from(customerTags)
    .where(and(inArray(customerTags.id, wanted), eq(customerTags.isDeleted, 0))).orderBy(asc(customerTags.id)).for('share');
  if (live.length !== wanted.length) {
    const found = new Set(live.map((t) => t.id));
    throw new ValidationError('برچسب انتخاب‌شده دیگر نیست؛ فهرست برچسب‌ها را دوباره باز کنید.', { missing: wanted.filter((id) => !found.has(id)) }, 'CUSTOMER_TAG_INVALID');
  }

  const current = await tx.select({ linkId: customerTagLinks.id, tagId: customerTagLinks.tagId, name: customerTags.name, isDeleted: customerTags.isDeleted })
    .from(customerTagLinks).innerJoin(customerTags, eq(customerTags.id, customerTagLinks.tagId))
    .where(eq(customerTagLinks.customerId, customerId));
  const before = current.filter((c) => c.isDeleted === 0).map((c) => c.name).sort();
  const wantedSet = new Set(wanted);
  const removed = current.filter((c) => !wantedSet.has(c.tagId)).map((c) => c.linkId);
  if (removed.length > 0) await tx.delete(customerTagLinks).where(inArray(customerTagLinks.id, removed));
  const existing = new Set(current.map((c) => c.tagId));
  const added = wanted.filter((id) => !existing.has(id));
  if (added.length > 0) await tx.insert(customerTagLinks).values(added.map((tagId) => ({ customerId, tagId, createdById: userId })));
  return { before, after: live.map((t) => t.name).sort() };
}

/** نام برچسب‌های زنده یک طرف حساب، برای عکس ممیزی */
export async function customerTagNames(executor: DbExecutor, customerId: number): Promise<string[]> {
  return ((await tagsByCustomer([customerId], executor)).get(customerId) ?? []).map((t) => t.name);
}
