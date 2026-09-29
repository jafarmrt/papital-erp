import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  projectBomAllocations,
  productionProjects,
  items,
  warehouses,
  transactions
} from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { fin } from '../../utils/financialMath.js';
import { DocumentService } from '../document.service.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { withOrderedLocks } from '../../lib/lockOrder.js';
import { NotFoundError, ConflictError } from '../../errors/customErrors.js';

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
    const operatorName = params.username || 'سیستم';
    const operatorId = typeof params.userId === 'number' && !isNaN(params.userId) && params.userId > 0 ? params.userId : null;

    const executeReceiptAlloc = async (txEngine: DbExecutor) => {
      // Strictly observe Lock Hierarchy using withOrderedLocks: Items (Level 40) -> Production (Level 50)
      const requestedItemIds = params.allocations.map(a => a.itemId);
      await withOrderedLocks(txEngine, [
        { table: items, ids: requestedItemIds, name: 'items' },
        { table: productionProjects, id: params.projectId, name: 'productionProjects' }
      ], async () => true);

      const [project] = await txEngine
        .select()
        .from(productionProjects)
        .where(and(eq(productionProjects.id, params.projectId), eq(productionProjects.isDeleted, 0)));

      if (!project) {
        throw new NotFoundError(`پروژه تولید با شناسه ${params.projectId} یافت نشد.`);
      }

      const activeWHs = await txEngine
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, 1));
      const defaultWh = activeWHs[0]?.code || 'main';

      const results: ProjectBomAllocationRecord[] = [];

      for (const req of params.allocations) {
        const qty = fin(req.quantity).toNumber();
        if (qty <= 0) continue;

        const targetLocation = req.location || defaultWh;

        // Fetch item
        const [item] = await txEngine
          .select()
          .from(items)
          .where(and(eq(items.id, req.itemId), eq(items.isDeleted, 0)))
          .for('update');

        if (!item) {
          throw new NotFoundError(`کالا با شناسه ${req.itemId} یافت نشد.`);
        }

        let resolvedTxId: number | null = req.receiptTransactionId || null;

        // If documentId is provided without receiptTransactionId, look up matching receipt transaction
        if (!resolvedTxId && req.documentId) {
          const matchingTxs = await txEngine
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.documentId, req.documentId),
                eq(transactions.itemId, item.id),
                eq(transactions.isDeleted, 0)
              )
            )
            .limit(1);

          if (matchingTxs.length > 0) {
            resolvedTxId = matchingTxs[0].id;
          }
        }

        // If no existing transaction specified, create receiving-allocation transaction log
        if (!resolvedTxId) {
          const txDate = await businessTodayIsoDate();
          const itemUnitPrice = Number(item.weightedAverageCost) || Number((item as { lastPurchasePrice?: number }).lastPurchasePrice) || 0;
          const stockResult = await DocumentService.applyStockMovement(txEngine, {
            itemId: item.id,
            documentId: req.documentId || null,
            inOut: 'in',
            quantity: qty,
            price: itemUnitPrice,
            date: txDate,
            documentType: 'رسید مستقیم BOM پروژه',
            documentRef: `پروژه ${project.projectCode}`,
            user: operatorName,
            targetLoc: targetLocation,
            notes: req.notes || `رسید و تخصیص مستقیم مواد اولیه به پروژه ${project.title} (${project.projectCode})`,
          });

          resolvedTxId = stockResult.transactionId;
        }

        // Insert explicit allocation record linking to the receiving transaction
        const [allocRecord] = await txEngine
          .insert(projectBomAllocations)
          .values({
            projectId: project.id,
            projectCode: project.projectCode,
            itemId: item.id,
            itemCode: item.code,
            itemName: item.name,
            quantity: qty,
            unit: item.unit || 'عدد',
            sourceTransactionId: resolvedTxId,
            sourceLocation: targetLocation,
            status: 'allocated',
            userId: operatorId,
            username: operatorName,
            notes: req.notes || `تخصیص از محل رسید خرید/انبار به پروژه ${project.projectCode}`,
            allocatedAt: new Date().toISOString(),
          })
          .returning();

        // Emit domain event for outbox
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
            quantity: qty,
            location: targetLocation,
            sourceTransactionId: resolvedTxId,
            action: 'RECEIPT_ALLOCATED',
          },
          { userId: operatorId ?? undefined, userName: operatorName }
        );
        await OutboxService.saveToOutbox(txEngine, domainEvent);

        results.push({
          id: allocRecord.id,
          projectId: allocRecord.projectId,
          projectCode: allocRecord.projectCode,
          itemId: allocRecord.itemId,
          itemCode: allocRecord.itemCode,
          itemName: allocRecord.itemName,
          quantity: fin(allocRecord.quantity).toNumber(),
          unit: allocRecord.unit || 'عدد',
          sourceTransactionId: allocRecord.sourceTransactionId,
          sourceLocation: allocRecord.sourceLocation || 'main',
          status: (allocRecord.status || 'allocated') as ProjectBomAllocationRecord['status'],
          userId: allocRecord.userId,
          username: allocRecord.username || '',
          notes: allocRecord.notes || '',
          allocatedAt: allocRecord.allocatedAt,
          consumedAt: allocRecord.consumedAt,
          releasedAt: allocRecord.releasedAt,
        });
      }

      return {
        allocatedCount: results.length,
        allocations: results,
      };
    };

    if (params.externalTx) {
      return await executeReceiptAlloc(params.externalTx);
    }
    return await orm.transaction(executeReceiptAlloc);
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
    const operatorName = params.username || 'سیستم';
    const operatorId = typeof params.userId === 'number' && !isNaN(params.userId) && params.userId > 0 ? params.userId : null;

    const executeAllocation = async (txEngine: DbExecutor) => {
      // Strictly observe Lock Hierarchy using withOrderedLocks: Items (Level 40) -> Production (Level 50)
      const requestedItemIds = params.allocations.map(a => a.itemId);
      await withOrderedLocks(txEngine, [
        { table: items, ids: requestedItemIds, name: 'items' },
        { table: productionProjects, id: params.projectId, name: 'productionProjects' }
      ], async () => true);

      const [project] = await txEngine
        .select()
        .from(productionProjects)
        .where(and(eq(productionProjects.id, params.projectId), eq(productionProjects.isDeleted, 0)));

      if (!project) {
        throw new NotFoundError(`پروژه تولید با شناسه ${params.projectId} یافت نشد.`);
      }

      const activeWHs = await txEngine
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, 1));
      const defaultWh = activeWHs[0]?.code || 'main';

      const results: ProjectBomAllocationRecord[] = [];

      for (const req of params.allocations) {
        const qty = fin(req.quantity).toNumber();
        if (qty <= 0) continue;

        const targetLocation = req.location || defaultWh;

        // Fetch item with row lock
        const [item] = await txEngine
          .select()
          .from(items)
          .where(and(eq(items.id, req.itemId), eq(items.isDeleted, 0)))
          .for('update');

        if (!item) {
          throw new NotFoundError(`کالا با شناسه ${req.itemId} یافت نشد.`);
        }

        // Apply stock movement using centralized DocumentService (ensures locking, negative stock policy, WAC integrity, outbox events)
        const txDate = await businessTodayIsoDate();
        const itemUnitPrice = Number(item.weightedAverageCost) || Number((item as { lastPurchasePrice?: number }).lastPurchasePrice) || 0;

        const stockResult = await DocumentService.applyStockMovement(txEngine, {
          itemId: item.id,
          inOut: 'out',
          quantity: qty,
          price: itemUnitPrice,
          date: txDate,
          documentType: 'تخصیص مواد BOM',
          documentRef: `پروژه ${project.projectCode}`,
          user: operatorName,
          targetLoc: targetLocation,
          notes: req.notes || `تخصیص به پروژه تولید ${project.title} (${project.projectCode})`,
        });

        // Insert explicit allocation record
        const [allocRecord] = await txEngine
          .insert(projectBomAllocations)
          .values({
            projectId: project.id,
            projectCode: project.projectCode,
            itemId: item.id,
            itemCode: item.code,
            itemName: item.name,
            quantity: qty,
            unit: item.unit || 'عدد',
            sourceTransactionId: stockResult.transactionId,
            sourceLocation: targetLocation,
            status: 'allocated',
            userId: operatorId,
            username: operatorName,
            notes: req.notes || '',
            allocatedAt: new Date().toISOString(),
          })
          .returning();

        // Emit domain event for outbox
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
            quantity: qty,
            location: targetLocation,
            sourceTransactionId: stockResult.transactionId,
            action: 'ALLOCATED',
          },
          { userId: operatorId ?? undefined, userName: operatorName }
        );
        await OutboxService.saveToOutbox(txEngine, domainEvent);

        results.push({
          id: allocRecord.id,
          projectId: allocRecord.projectId,
          projectCode: allocRecord.projectCode,
          itemId: allocRecord.itemId,
          itemCode: allocRecord.itemCode,
          itemName: allocRecord.itemName,
          quantity: fin(allocRecord.quantity).toNumber(),
          unit: allocRecord.unit || 'عدد',
          sourceTransactionId: allocRecord.sourceTransactionId,
          sourceLocation: allocRecord.sourceLocation || 'main',
          status: (allocRecord.status || 'allocated') as ProjectBomAllocationRecord['status'],
          userId: allocRecord.userId,
          username: allocRecord.username || '',
          notes: allocRecord.notes || '',
          allocatedAt: allocRecord.allocatedAt,
          consumedAt: allocRecord.consumedAt,
          releasedAt: allocRecord.releasedAt,
        });
      }

      return {
        allocatedCount: results.length,
        allocations: results,
      };
    };

    if (params.externalTx) {
      return await executeAllocation(params.externalTx);
    }
    return await orm.transaction(executeAllocation);
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

      if (item) {
        await DocumentService.applyStockMovement(txEngine, {
          itemId: item.id,
          inOut: 'in',
          quantity: qty,
          price: Number(item.weightedAverageCost || 0),
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
    const rawList = await orm
      .select({
        alloc: projectBomAllocations,
        tx: transactions,
      })
      .from(projectBomAllocations)
      .leftJoin(
        transactions,
        eq(projectBomAllocations.sourceTransactionId, transactions.id)
      )
      .where(
        and(
          eq(projectBomAllocations.projectId, projectId),
          eq(projectBomAllocations.isDeleted, 0)
        )
      )
      .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id));

    return rawList.map(({ alloc, tx }) => ({
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
      transactionDetails: tx
        ? {
            date: tx.date || '',
            documentType: tx.documentType || '',
            documentRef: tx.documentRef || '',
            quantity: fin(tx.quantity).toNumber(),
          }
        : null,
    }));
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
    const conditions = [eq(projectBomAllocations.isDeleted, 0)];

    if (params?.projectId) {
      conditions.push(eq(projectBomAllocations.projectId, params.projectId));
    }
    if (params?.itemId) {
      conditions.push(eq(projectBomAllocations.itemId, params.itemId));
    }
    if (params?.status) {
      conditions.push(eq(projectBomAllocations.status, params.status));
    }

    const rawList = await orm
      .select({
        alloc: projectBomAllocations,
        tx: transactions,
      })
      .from(projectBomAllocations)
      .leftJoin(
        transactions,
        eq(projectBomAllocations.sourceTransactionId, transactions.id)
      )
      .where(and(...conditions))
      .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id));

    let list = rawList.map(({ alloc, tx }) => ({
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
      transactionDetails: tx
        ? {
            date: tx.date || '',
            documentType: tx.documentType || '',
            documentRef: tx.documentRef || '',
            quantity: fin(tx.quantity).toNumber(),
          }
        : null,
    }));

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
