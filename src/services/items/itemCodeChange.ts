import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Request } from 'express';
import type { DbExecutor } from '../../db/drizzle.js';
import { itemCodeHistory, items } from '../../db/schema.js';
import { BadRequestError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { codeFormatError } from '../../lib/items/itemCodeFormat.js';
import { ITEM_CODE_CHANGE_REASON_MAX } from '../../lib/items/itemCodeChange.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { checkOccVersion, nextVersion, OptimisticLockError } from '../../lib/occHelper.js';
import { advanceItemCodeCounter } from './itemCodeCounter.js';
import { assertItemCodeAvailable, guardItemIdentity } from './itemIdentity.js';

/**
 * v10.1.9 (D-15, TD-1264, approved WooCommerce plan §3, answers q7 and q11): an item's code is the WooCommerce SKU, so it
 * changes only through this operation (permission `products.change_code`, a required reason), never through
 * `PUT /items/:id` (422 `ITEM_CODE_CHANGE_SEPARATE`). Each change writes an `item_code_history` row and an audit row in its
 * transaction; documents, Kardex, reservations and vouchers hold the item by id and keep pointing to it.
 */

export const ITEM_CODE_CHANGE_SEPARATE = 'ITEM_CODE_CHANGE_SEPARATE';

export interface ItemCodeChangeInput {
  code: string;
  reason: string;
  version: number;
}

export interface ItemCodeChangeActor {
  id?: number;
  username?: string;
  fullName?: string;
}

/** `PUT /items/:id` keeps the stored code; a different code is the change-code operation's (spaces around it ignored) */
export function assertCodeUnchangedByEdit(sentCode: unknown, storedCode: string): void {
  if (sentCode === undefined || sentCode === null) return;
  if (String(sentCode).trim() === String(storedCode).trim()) return;
  throw new ValidationError(
    'کد کالا با ویرایش کالا عوض نمی‌شود؛ از «تغییر کد» در فهرست کالاها استفاده کنید.',
    { storedCode },
    ITEM_CODE_CHANGE_SEPARATE,
  );
}

export async function changeItemCode(
  tx: DbExecutor,
  itemId: number,
  input: ItemCodeChangeInput,
  actor: ItemCodeChangeActor,
  req?: Request,
): Promise<{ item: typeof items.$inferSelect; previousCode: string }> {
  const [prev] = await tx.select().from(items)
    .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)))
    .for('no key update');
  if (!prev) throw new NotFoundError('کالای مورد نظر یافت نشد.');
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new BadRequestError('نسخه کالا ارسال نشده است؛ صفحه را بازخوانی کنید و دوباره تلاش کنید.');
  }
  checkOccVersion(prev, { entityType: 'Item', entityId: itemId, expectedVersion: input.version });

  const code = input.code.trim();
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('دلیل تغییر کد را بنویسید.', undefined, 'ITEM_CODE_CHANGE_REASON_REQUIRED');
  if (reason.length > ITEM_CODE_CHANGE_REASON_MAX) {
    throw new ValidationError('دلیل تغییر کد بیش از اندازه بلند است.', undefined, 'ITEM_CODE_CHANGE_REASON_REQUIRED');
  }
  if (code === prev.code.trim()) {
    throw new ValidationError('کد تازه با کد فعلی کالا یکی است.', undefined, 'ITEM_CODE_UNCHANGED');
  }
  const formatError = codeFormatError(code, prev.type === 'product' ? 'product' : 'raw_material', prev.category ?? '');
  if (formatError) throw new ValidationError(formatError, undefined, 'ITEM_CODE_FORMAT');
  await assertItemCodeAvailable(tx, code, itemId);

  const [updated] = await guardItemIdentity(prev.name, () => tx.update(items)
    .set({ code, version: nextVersion(prev.version) })
    .where(and(eq(items.id, itemId), eq(items.version, prev.version)))
    .returning());
  if (!updated) throw new OptimisticLockError({ entityType: 'Item', entityId: itemId, expectedVersion: input.version });
  await advanceItemCodeCounter(tx, updated.type, updated.code);

  await tx.insert(itemCodeHistory).values({
    itemId,
    oldCode: prev.code,
    newCode: code,
    reason,
    userId: actor.id ?? null,
    username: actor.fullName || actor.username || '',
  });
  await logActivity({
    req,
    tx,
    action: 'CHANGE_CODE',
    entity: 'کالا',
    entityId: itemId,
    description: `تغییر کد کالای «${updated.name}» از ${prev.code} به ${code}`,
    details: {
      before: { code: prev.code },
      after: { code },
      changes: { code: { before: prev.code, after: code } },
      reason,
      version: updated.version,
    },
  });
  return { item: updated, previousCode: prev.code };
}

export interface ItemCodeHistoryRow {
  oldCode: string;
  newCode: string;
  reason: string;
  username: string;
  createdAt: string;
}

/** Code changes of one item, newest first */
export async function listItemCodeHistory(db: DbExecutor, itemId: number): Promise<ItemCodeHistoryRow[]> {
  const rows = await db.select({
    oldCode: itemCodeHistory.oldCode,
    newCode: itemCodeHistory.newCode,
    reason: itemCodeHistory.reason,
    username: itemCodeHistory.username,
    createdAt: itemCodeHistory.createdAt,
  }).from(itemCodeHistory)
    .where(eq(itemCodeHistory.itemId, itemId))
    .orderBy(desc(itemCodeHistory.createdAt), desc(itemCodeHistory.id));
  return rows.map(row => ({ ...row, createdAt: serverTimestampToUtcIso(row.createdAt) ?? row.createdAt }));
}

export interface ResolvedItemCode {
  itemId: number;
  /** set when the code is no live item's current code and was found as this item's earlier code */
  oldCode?: string;
}

/**
 * Live items by exact code: the current code first (the lowest id among equals, as before), else an earlier code of a live
 * item from `item_code_history`, the latest change from that code winning (approved plan, answer q7).
 */
export async function resolveItemsByCode(db: DbExecutor, codes: string[]): Promise<Map<string, ResolvedItemCode>> {
  const wanted = [...new Set(codes.filter(Boolean))];
  const found = new Map<string, ResolvedItemCode>();
  if (wanted.length === 0) return found;

  const current = await db.select({ id: items.id, code: items.code }).from(items)
    .where(and(eq(items.isDeleted, 0), inArray(items.code, wanted)))
    .orderBy(asc(items.id));
  for (const row of current) {
    if (row.code && !found.has(row.code)) found.set(row.code, { itemId: row.id });
  }

  const rest = wanted.filter(code => !found.has(code));
  if (rest.length === 0) return found;
  const earlier = await db.select({ oldCode: itemCodeHistory.oldCode, itemId: itemCodeHistory.itemId })
    .from(itemCodeHistory)
    .innerJoin(items, and(eq(items.id, itemCodeHistory.itemId), eq(items.isDeleted, 0)))
    .where(inArray(itemCodeHistory.oldCode, rest))
    .orderBy(desc(itemCodeHistory.createdAt), desc(itemCodeHistory.id));
  for (const row of earlier) {
    if (!found.has(row.oldCode)) found.set(row.oldCode, { itemId: row.itemId, oldCode: row.oldCode });
  }
  return found;
}
