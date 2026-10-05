import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  projectBomAllocations,
  productionProjects,
  items,
  warehouses,
  transactions
} from '../../db/schema.js';
import { eq, and, desc, asc, type SQL } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../document.service.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { withOrderedLocks } from '../../lib/lockOrder.js';
import { NotFoundError, ConflictError, ValidationError } from '../../errors/customErrors.js';

import { businessTodayIsoDate } from '../../lib/businessClock.js';
export interface BomAllocationItemInput {
  itemId: number;
  quantity: number;
  location?: string;
  notes?: string;
}

export interface BomReceiptAllocationInput {
  receiptTransactionId?: number;
  documentId?: number;
  itemId: number;
  quantity: number;
  location?: string;
  notes?: string;
}

export interface ProjectBomAllocationRecord {
  id: number;
  projectId: number;
  projectCode: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  sourceTransactionId: number | null;
  sourceLocation: string;
  status: 'allocated' | 'consumed' | 'released';
  userId: number | null;
  username: string;
  notes: string;
  allocatedAt: string | null;
  consumedAt: string | null;
  releasedAt: string | null;
  transactionDetails?: {
    date: string;
    documentType: string;
    documentRef: string;
    quantity: number;
  } | null;
}

type AllocationRow = typeof projectBomAllocations.$inferSelect;
type TransactionRow = typeof transactions.$inferSelect;
type ProjectRow = typeof productionProjects.$inferSelect;
type ItemRow = typeof items.$inferSelect;

interface AllocationOperator {
  id: number | null;
  name: string;
}

/** ردیف تخصیص به شکل خروجی API؛ با ردیف کاردکس منبع اگر خوانده شده باشد */
function toAllocationRecord(alloc: AllocationRow, tx?: TransactionRow | null): ProjectBomAllocationRecord {
  const record: ProjectBomAllocationRecord = {
    id: alloc.id,
    projectId: alloc.projectId,
    projectCode: alloc.projectCode,
    itemId: alloc.itemId,
    itemCode: alloc.itemCode,
    itemName: alloc.itemName,
    quantity: fin(alloc.quantity).toNumber(),
    unit: alloc.unit || 'عدد',
    sourceTransactionId: alloc.sourceTransactionId,
    sourceLocation: alloc.sourceLocation || 'main',
    status: (alloc.status || 'allocated') as ProjectBomAllocationRecord['status'],
    userId: alloc.userId,
    username: alloc.username || '',
    notes: alloc.notes || '',
    allocatedAt: alloc.allocatedAt,
    consumedAt: alloc.consumedAt,
    releasedAt: alloc.releasedAt,
  };
  if (tx === undefined) return record;
  return {
    ...record,
    transactionDetails: tx
      ? {
          date: tx.date || '',
          documentType: tx.documentType || '',
          documentRef: tx.documentRef || '',
          quantity: fin(tx.quantity).toNumber(),
        }
      : null,
  };
}

function operatorOf(userId?: number, username?: string): AllocationOperator {
  return {
    id: typeof userId === 'number' && !isNaN(userId) && userId > 0 ? userId : null,
    name: username || 'سیستم',
  };
}

async function inTransaction<T>(externalTx: DbExecutor | undefined, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return externalTx ? fn(externalTx) : orm.transaction(fn);
}

/**
 * قفل کالاها و پروژه به ترتیب سلسله‌مراتب (Items 40 → Production 50)، خواندن پروژه و انبار پیش‌فرض
 * (فعال با کمترین شناسه، v7.0.36 / P2-3).
 */
async function lockProjectForAllocation(txEngine: DbExecutor, projectId: number, itemIds: number[]): Promise<{ project: ProjectRow; defaultWh: string }> {
  await withOrderedLocks(txEngine, [
    { table: items, ids: itemIds, name: 'items' },
    { table: productionProjects, id: projectId, name: 'productionProjects' }
  ], async () => true);

  const [project] = await txEngine
    .select()
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));

  if (!project) {
    throw new NotFoundError(`پروژه تولید با شناسه ${projectId} یافت نشد.`);
  }

  const activeWHs = await txEngine
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1))
    .orderBy(asc(warehouses.id));
  return { project, defaultWh: activeWHs[0]?.code || 'main' };
}

async function lockActiveItem(txEngine: DbExecutor, itemId: number): Promise<ItemRow> {
  const [item] = await txEngine
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)))
    .for('update');
  if (!item) {
    throw new NotFoundError(`کالا با شناسه ${itemId} یافت نشد.`);
  }
  return item;
}

/** بهای واحد حرکت انبار تخصیص: میانگین موزون، وگرنه آخرین قیمت خرید */
function allocationUnitPrice(item: ItemRow): number {
  return Number(item.weightedAverageCost) || Number((item as { lastPurchasePrice?: number }).lastPurchasePrice) || 0;
}

/** ثبت ردیف تخصیص، رویداد outbox آن و خروجی API */
async function recordAllocation(txEngine: DbExecutor, params: {
  project: ProjectRow;
  item: ItemRow;
  quantity: number;
  location: string;
  sourceTransactionId: number | null;
  notes: string;
  action: 'ALLOCATED' | 'RECEIPT_ALLOCATED';
  operator: AllocationOperator;
}): Promise<ProjectBomAllocationRecord> {
  const { project, item, quantity, location, sourceTransactionId, operator } = params;
  const [allocRecord] = await txEngine
    .insert(projectBomAllocations)
    .values({
      projectId: project.id,
      projectCode: project.projectCode,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      quantity,
      unit: item.unit || 'عدد',
      sourceTransactionId,
      sourceLocation: location,
      status: 'allocated',
      userId: operator.id,
      username: operator.name,
      notes: params.notes,
      allocatedAt: new Date().toISOString(),
    })
    .returning();

  const domainEvent = domainEventBus.createEvent(
    DomainEventType.STOCK_ADJUSTED,
    'Project',
    String(allocRecord.id),
    {
      allocationId: allocRecord.id,
      projectId: project.id,
      projectCode: project.projectCode,
      itemId: item.id,
      itemCode: item.code,
      quantity,
      location,
      sourceTransactionId,
      action: params.action,
    },
    { userId: operator.id ?? undefined, userName: operator.name }
  );
  await OutboxService.saveToOutbox(txEngine, domainEvent);

  return toAllocationRecord(allocRecord);
}

/** فهرست تخصیص‌ها با ردیف کاردکس منبع (جدیدترین اول) */
async function listAllocations(conditions: SQL[]): Promise<ProjectBomAllocationRecord[]> {
  const rawList = await orm
    .select({ alloc: projectBomAllocations, tx: transactions })
    .from(projectBomAllocations)
    .leftJoin(transactions, eq(projectBomAllocations.sourceTransactionId, transactions.id))
    .where(and(eq(projectBomAllocations.isDeleted, 0), ...conditions))
    .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id));
  return rawList.map(({ alloc, tx }) => toAllocationRecord(alloc, tx));
}

/**
 * v7.0.115: مراحل مشترک دو مسیر تخصیص (قفل، پروژه، انبار پیش‌فرض، کالا، ثبت ردیف و رویداد، خروجی) در توابع بالا
 * یک بار نوشته شده‌اند؛ هر مسیر فقط حرکت انبار خودش را دارد.
 */
export class ProjectBomAllocationService {
  /**
   * Allocates raw materials received via receiving/purchase transactions directly to a project BOM.
   * Creates explicit allocation records linked to the receiving transaction.
   */
  static async allocateReceiptItemsForProjectBom(params: {
    projectId: number;
    allocations: BomReceiptAllocationInput[];
    userId?: number;
    username?: string;
    externalTx?: DbExecutor;
  }): Promise<{
    allocatedCount: number;
    allocations: ProjectBomAllocationRecord[];
  }> {
    const operator = operatorOf(params.userId, params.username);

    return inTransaction(params.externalTx, async (txEngine) => {
      const { project, defaultWh } = await lockProjectForAllocation(txEngine, params.projectId, params.allocations.map(a => a.itemId));
      const results: ProjectBomAllocationRecord[] = [];

      for (const req of params.allocations) {
        const qty = fin(req.quantity).toNumber();
        if (qty <= 0) continue;

        const targetLocation = req.location || defaultWh;
        const item = await lockActiveItem(txEngine, req.itemId);

        // v8.0.32 (TD-287، تصمیم مالک محصول — گزینه الف): مواد فقط با رسید خرید وارد انبار می‌شوند و سپس تخصیص می‌یابند.
        // پیش‌تر بی‌رسید یک حرکت «ورود» بی‌تأمین‌کننده و بی‌سند حسابداری ساخته می‌شد (موجودی از هیچ)، و تخصیصِ رسیدِ ثبت‌شده
        // موجودی را از انبار برنمی‌داشت در حالی که آزادسازی آن دوباره به انبار اضافه می‌کرد. اکنون رسید ثبت‌شده همین کالا الزامی
        // است و تخصیص مانند تخصیص عادی مواد را از انبار خارج می‌کند (آزادسازی و مصرف یکسان رفتار می‌کنند).
        const receiptConditions = req.receiptTransactionId
          ? [eq(transactions.id, req.receiptTransactionId)]
          : req.documentId ? [eq(transactions.documentId, req.documentId), eq(transactions.itemId, item.id)] : null;
        const [receipt] = receiptConditions
          ? await txEngine.select({ id: transactions.id, itemId: transactions.itemId, type: transactions.type, documentRef: transactions.documentRef })
            .from(transactions)
            .where(and(...receiptConditions, eq(transactions.type, 'in'), eq(transactions.isDeleted, 0)))
            .limit(1)
          : [];
        if (!receipt || receipt.itemId !== item.id) {
          throw new ValidationError(
            `تخصیص از رسید برای «${item.name}» فقط با رسید ثبت‌شده همین کالا ممکن است؛ مواد را ابتدا با رسید خرید وارد انبار کنید و سپس به پروژه تخصیص دهید.`
          );
        }

        const stockResult = await DocumentService.applyStockMovement(txEngine, {
          itemId: item.id,
          inOut: 'out',
          quantity: qty,
          price: allocationUnitPrice(item),
          date: await businessTodayIsoDate(),
          documentType: 'تخصیص مواد BOM',
          documentRef: `پروژه ${project.projectCode}`,
          user: operator.name,
          targetLoc: targetLocation,
          notes: req.notes || `تخصیص از رسید ${receipt.documentRef || receipt.id} به پروژه ${project.title} (${project.projectCode})`,
        });
        const resolvedTxId: number | null = stockResult.transactionId;

        results.push(await recordAllocation(txEngine, {
          project,
          item,
          quantity: qty,
          location: targetLocation,
          sourceTransactionId: resolvedTxId,
          notes: req.notes || `تخصیص از محل رسید خرید/انبار به پروژه ${project.projectCode}`,
          action: 'RECEIPT_ALLOCATED',
          operator,
        }));
      }

      return { allocatedCount: results.length, allocations: results };
    });
  }

  /**
   * Allocates raw materials / parts to a production project.
   * Atomically:
   * 1. Checks item stock and negative stock policy
   * 2. Deducts stock from specified warehouse location
   * 3. Inserts transaction log of type 'out'
   * 4. Creates projectBomAllocations record linking to the source transaction ID
   * 5. Emits domain event
   */
  static async allocateMaterialsForProject(params: {
    projectId: number;
    allocations: BomAllocationItemInput[];
    userId?: number;
    username?: string;
    externalTx?: DbExecutor;
  }): Promise<{
    allocatedCount: number;
    allocations: ProjectBomAllocationRecord[];
  }> {
    const operator = operatorOf(params.userId, params.username);

    return inTransaction(params.externalTx, async (txEngine) => {
      const { project, defaultWh } = await lockProjectForAllocation(txEngine, params.projectId, params.allocations.map(a => a.itemId));
      const results: ProjectBomAllocationRecord[] = [];

      for (const req of params.allocations) {
        const qty = fin(req.quantity).toNumber();
        if (qty <= 0) continue;

        const targetLocation = req.location || defaultWh;
        const item = await lockActiveItem(txEngine, req.itemId);

        // Apply stock movement using centralized DocumentService (ensures locking, negative stock policy, WAC integrity, outbox events)
        const stockResult = await DocumentService.applyStockMovement(txEngine, {
          itemId: item.id,
          inOut: 'out',
          quantity: qty,
          price: allocationUnitPrice(item),
          date: await businessTodayIsoDate(),
          documentType: 'تخصیص مواد BOM',
          documentRef: `پروژه ${project.projectCode}`,
          user: operator.name,
          targetLoc: targetLocation,
          notes: req.notes || `تخصیص به پروژه تولید ${project.title} (${project.projectCode})`,
        });

        results.push(await recordAllocation(txEngine, {
          project,
          item,
          quantity: qty,
          location: targetLocation,
          sourceTransactionId: stockResult.transactionId,
          notes: req.notes || '',
          action: 'ALLOCATED',
          operator,
        }));
      }

      return { allocatedCount: results.length, allocations: results };
    });
  }

  /**
   * Marks allocated materials as consumed in production.
   */
  static async consumeAllocation(
    allocationId: number,
    opts?: { userId?: number; username?: string; externalTx?: DbExecutor }
  ): Promise<ProjectBomAllocationRecord> {
    const executeConsume = async (txEngine: DbExecutor) => {
      const [alloc] = await txEngine
        .select()
        .from(projectBomAllocations)
        .where(
          and(
            eq(projectBomAllocations.id, allocationId),
            eq(projectBomAllocations.isDeleted, 0)
          )
        )
        .for('update');

      if (!alloc) {
        throw new NotFoundError(`رکورد تخصیص با شناسه ${allocationId} یافت نشد.`);
      }

      if (alloc.status !== 'allocated') {
        throw new ConflictError(`رکورد تخصیص در وضعیت '${alloc.status}' قرار دارد و قابل مصرف نیست.`);
      }

      const consumedAt = new Date().toISOString();
      await txEngine
        .update(projectBomAllocations)
        .set({
          status: 'consumed',
          consumedAt,
        })
        .where(eq(projectBomAllocations.id, allocationId));

      return {
        ...alloc,
        quantity: fin(alloc.quantity).toNumber(),
        status: 'consumed',
        consumedAt,
      } as ProjectBomAllocationRecord;
    };

    if (opts?.externalTx) {
      return await executeConsume(opts.externalTx);
    }
    return await orm.transaction(executeConsume);
  }

  /**
   * Releases allocated materials back to warehouse inventory (compensatory return).
   */
  static async releaseAllocation(
    allocationId: number,
    opts?: { reason?: string; userId?: number; username?: string; externalTx?: DbExecutor }
  ): Promise<ProjectBomAllocationRecord> {
    const operatorName = opts?.username || 'سیستم';
    const reason = opts?.reason || 'آزادسازی تخصیص مواد اولیه پروژه';

    const executeRelease = async (txEngine: DbExecutor) => {
      // Pre-read allocation to get itemId for locking in hierarchy order: Items (Level 40) -> Production (Level 50)
      const [preAlloc] = await txEngine.select({ itemId: projectBomAllocations.itemId }).from(projectBomAllocations).where(eq(projectBomAllocations.id, allocationId));
      if (preAlloc?.itemId) {
        await withOrderedLocks(txEngine, [
          { table: items, id: preAlloc.itemId, name: 'items' },
          { table: projectBomAllocations, id: allocationId, name: 'projectBomAllocations' }
        ], async () => true);
      }

      const [alloc] = await txEngine
        .select()
        .from(projectBomAllocations)
        .where(
          and(
            eq(projectBomAllocations.id, allocationId),
            eq(projectBomAllocations.isDeleted, 0)
          )
        );

      if (!alloc) {
        throw new NotFoundError(`رکورد تخصیص با شناسه ${allocationId} یافت نشد.`);
      }

      if (alloc.status !== 'allocated') {
        throw new ConflictError(`فقط رکوردهای در وضعیت 'allocated' قابل آزادسازی به انبار هستند.`);
      }

      const qty = fin(alloc.quantity).toNumber();
      const loc = alloc.sourceLocation || 'main';

      // 1. Fetch item and restore stock through centralized DocumentService
      const [item] = await txEngine
        .select()
        .from(items)
        .where(eq(items.id, alloc.itemId))
        .for('update');

      // v8.0.33 (TD-288): مواد به بهای کاردکس خروج همان تخصیص برمی‌گردند (همان قاعده ابطال خروج، TD-254)، نه به میانگین موزون
      // روز؛ پیش‌تر پس از خرید گران‌تر، آزادسازی ارزش از هیچ می‌ساخت. تخصیصِ رسیدِ پیش از v8.0.32 (حرکت منبع «ورود») موجودی را
      // از انبار برنداشته بود و آزادسازی آن موجودی اضافه نمی‌کند.
      const [source] = alloc.sourceTransactionId
        ? await txEngine.select({ type: transactions.type, unitPrice: transactions.unitPrice }).from(transactions).where(eq(transactions.id, alloc.sourceTransactionId))
        : [];
      const stockLeftWarehouse = source?.type !== 'in';
      const returnUnitCost = source?.type === 'out' ? fin(source.unitPrice ?? 0) : fin(item?.weightedAverageCost ?? 0);

      if (item && stockLeftWarehouse) {
        await DocumentService.applyStockMovement(txEngine, {
          itemId: item.id,
          inOut: 'in',
          quantity: qty,
          price: returnUnitCost.toNumber(),
          date: await businessTodayIsoDate(),
          documentType: 'آزادسازی تخصیص BOM',
          documentRef: `پروژه ${alloc.projectCode}`,
          user: operatorName,
          targetLoc: loc,
          notes: `${reason} (تخصیص شماره ${alloc.id})`,
        });
      }

      // 3. Mark allocation as released
      const releasedAt = new Date().toISOString();
      await txEngine
        .update(projectBomAllocations)
        .set({
          status: 'released',
          releasedAt,
          notes: alloc.notes ? `${alloc.notes} | ${reason}` : reason,
        })
        .where(eq(projectBomAllocations.id, allocationId));

      return {
        ...alloc,
        quantity: qty,
        status: 'released',
        releasedAt,
      } as ProjectBomAllocationRecord;
    };

    if (opts?.externalTx) {
      return await executeRelease(opts.externalTx);
    }
    return await orm.transaction(executeRelease);
  }

  /**
   * Retrieves all BOM allocations for a specific project.
   */
  static async getProjectAllocations(projectId: number): Promise<ProjectBomAllocationRecord[]> {
    return listAllocations([eq(projectBomAllocations.projectId, projectId)]);
  }

  /**
   * Returns global BOM allocations with filtering and traceability.
   */
  static async getAllAllocations(params?: {
    projectId?: number;
    itemId?: number;
    status?: string;
    search?: string;
  }): Promise<ProjectBomAllocationRecord[]> {
    const conditions: SQL[] = [];

    if (params?.projectId) {
      conditions.push(eq(projectBomAllocations.projectId, params.projectId));
    }
    if (params?.itemId) {
      conditions.push(eq(projectBomAllocations.itemId, params.itemId));
    }
    if (params?.status) {
      conditions.push(eq(projectBomAllocations.status, params.status));
    }

    let list = await listAllocations(conditions);

    if (params?.search) {
      const q = params.search.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.projectCode.toLowerCase().includes(q) ||
          a.itemCode.toLowerCase().includes(q) ||
          a.itemName.toLowerCase().includes(q) ||
          a.username.toLowerCase().includes(q)
      );
    }

    return list;
  }
}
