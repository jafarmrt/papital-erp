import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  projectBomAllocations,
  productionProjects,
  items,
  warehouses,
  transactions,
  personnel
} from '../../db/schema.js';
import { eq, and, desc, asc, isNull, ne, or, type SQL } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../document.service.js';
import { issueBomAllocationVoucher, voidBomAllocationVouchers } from '../accounting/bomAllocationVoucher.js';
import { OutboxService } from '../events/outboxService.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { withOrderedLocks } from '../../lib/lockOrder.js';
import { NotFoundError, ConflictError, ValidationError } from '../../errors/customErrors.js';
import { assertOutflowWithinSellable } from '../documents/documentSellableGate.js';
import { releaseReservationsForAllocation, restoreReservationsForAllocation } from '../documents/projectReservationRelease.js';

import { businessTodayIsoDate, systemNowUtcIso } from '../../lib/businessClock.js';
import { isProjectOpenForAllocation, projectStatusLabel } from '../../lib/projects/projectStatus.js';
import { allocationStatusLabel } from '../../lib/projects/allocationLabels.js';
import { logBomAllocation, logBomConsumption, logBomRelease } from './bomAllocationAudit.js';
import { RECIPIENT_INVALID, RECIPIENT_INVALID_MESSAGE, RECIPIENT_TERMINATED_STATUS } from '../../lib/workshop/recipient.js';
import { toAllocationRecord, type ProjectBomAllocationRecord } from './bomAllocationRecord.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';
import { assertProjectWipStaysCovered } from '../accounting/projectDeliveredMaterials.js';
export { toAllocationRecord, type ProjectBomAllocationRecord };
export interface BomAllocationItemInput {
  itemId: number;
  quantity: number;
  location?: string;
  notes?: string;
}


type ProjectRow = typeof productionProjects.$inferSelect;
type ItemRow = typeof items.$inferSelect;

interface AllocationOperator {
  id: number | null;
  name: string;
}


function operatorOf(userId?: number, username?: string): AllocationOperator {
  return {
    id: typeof userId === 'number' && !isNaN(userId) && userId > 0 ? userId : null,
    name: username || 'سیستم',
  };
}

async function inTransaction<T>(externalTx: DbExecutor | undefined, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return externalTx ? fn(externalTx) : idempotentTransaction(fn);
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
  // v9.0.410 (TD-759، تصمیم ت۹ الف): پروژه لغوشده یا تکمیل‌شده مواد تازه نمی‌گیرد؛ پیش‌تر ۴ واحد به پروژه لغوشده ۲۰۰ می‌گرفت و
  // سند ۱۴۰۲ صادر می‌شد. آزادسازی تخصیص‌های پیشین آزاد است
  if (!isProjectOpenForAllocation(project.status)) {
    throw new ValidationError(
      `پروژه «${project.projectCode}» ${projectStatusLabel(project.status)} است و مواد تازه به آن تخصیص نمی‌یابد؛ تخصیص‌های پیشین آن آزادشدنی است.`,
      { projectId, status: project.status }, 'PROJECT_CLOSED_FOR_ALLOCATION'
    );
  }

  const activeWHs = await txEngine
    .select({ code: warehouses.code })
    .from(warehouses)
    .where(eq(warehouses.isActive, 1))
    .orderBy(asc(warehouses.id));
  return { project, defaultWh: activeWHs[0]?.code || 'main' };
}

/**
 * v9.0.451 (TD-905، یافته P5-M02): تخصیص مواد از همان درگاه «قابل فروش» حواله خروج می‌گذرد (TD-775): مقدار هر (کالا، انبار)
 * با min(موجودی انبار، موجودی کل − رزرو دیگران) سنجیده می‌شود و رزرو خود همین پروژه آزاد است. پیش‌تر تخصیص فقط موجودی
 * انبار را می‌دید: با ۱۰ واحد رزروشده پروژه دیگر، حواله ۶ واحدی ۴۰۰ می‌گرفت ولی تخصیص ۶ واحد پذیرفته می‌شد و رزرو پروژه
 * دیگر یا پیش‌فاکتور فروش دیگر خروج نمی‌یافت. کالاها پیش از این قفل شده‌اند (`lockProjectForAllocation`).
 */
async function assertAllocationWithinSellable(
  txEngine: DbExecutor,
  projectId: number,
  defaultWh: string,
  lines: ReadonlyArray<{ itemId: number; quantity: number; location?: string }>
): Promise<void> {
  await assertOutflowWithinSellable(
    txEngine,
    lines.map(line => ({ itemId: line.itemId, quantity: line.quantity, location: line.location || defaultWh })),
    { projectId }
  );
}

async function lockActiveItem(txEngine: DbExecutor, itemId: number): Promise<ItemRow> {
  const [item] = await txEngine
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.isDeleted, 0)))
    .for('no key update'); // v8.0.67 (TD-320): هم‌حالت lockStockItems
  if (!item) {
    throw new NotFoundError(`کالا با شناسه ${itemId} یافت نشد.`);
  }
  return item;
}

/**
 * v10.1.37 (N-01, TD-1283, decision ت۴ الف): the allocation's recipient is a live personnel who has not left, read
 * `FOR SHARE` in the allocation's transaction (else 422 `RECIPIENT_PERSONNEL_INVALID`); none when not sent.
 */
async function liveAllocationRecipient(txEngine: DbExecutor, personnelId: number | null | undefined): Promise<number | null> {
  if (personnelId === undefined || personnelId === null) return null;
  const [row] = await txEngine.select({ id: personnel.id }).from(personnel)
    .where(and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0), or(isNull(personnel.employmentStatus), ne(personnel.employmentStatus, RECIPIENT_TERMINATED_STATUS))))
    .for('share');
  if (!row) throw new ValidationError(RECIPIENT_INVALID_MESSAGE, { personnelId }, RECIPIENT_INVALID);
  return row.id;
}

/**
 * بهای واحد حرکت انبار تخصیص: میانگین موزون کالا، به‌صورت متن دهدهی. OBS-R2-46: پیش‌تر با `Number()` و جایگزین
 * «آخرین قیمت خرید» (ستونی که جدول کالا ندارد) خوانده می‌شد. خروج همیشه به میانگین موزون در کاردکس ثبت می‌شود و
 * کالای بی میانگین موزون خارج نمی‌شود (applyStockMovement)، پس بهای سند تخصیص همان بهای کاردکس حرکت خروج خودش است.
 */
function allocationUnitPrice(item: ItemRow): string {
  return fin(item.weightedAverageCost ?? 0).toString();
}

/** ثبت ردیف تخصیص، رویداد outbox آن و خروجی API */
async function recordAllocation(txEngine: DbExecutor, params: {
  project: ProjectRow;
  item: ItemRow;
  quantity: number;
  location: string;
  sourceTransactionId: number | null;
  notes: string;
  action: 'ALLOCATED';
  operator: AllocationOperator;
  recipientPersonnelId: number | null;
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
      recipientPersonnelId: params.recipientPersonnelId,
      allocatedAt: systemNowUtcIso(),
    })
    .returning();

  const domainEvent = domainEventBus.createEvent(
    DomainEventType.STOCK_ADJUSTED,
    'Project',
    // v10.0.30 (TD-944): the event belongs to the project (its timeline), not to the allocation id
    String(project.id),
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

/**
 * v8.0.34 (TD-286، تصمیم مالک محصول — گزینه الف): سند تخصیص — بدهکار کالای در جریان ساخت / بستانکار موجودی، به بهای کاردکس
 * حرکت خروج همان تخصیص (پیوند source_bom_allocation_id).
 */
async function postAllocationVoucher(txEngine: DbExecutor, record: ProjectBomAllocationRecord, project: ProjectRow, item: ItemRow, operator: AllocationOperator): Promise<void> {
  const [out] = record.sourceTransactionId
    ? await txEngine.select({ unitPrice: transactions.unitPrice, quantity: transactions.quantity }).from(transactions).where(eq(transactions.id, record.sourceTransactionId))
    : [];
  await issueBomAllocationVoucher(txEngine, {
    allocationId: record.id,
    projectId: project.id,
    projectLabel: `${project.title} (${project.projectCode})`,
    itemName: item.name,
    itemType: item.type,
    amount: fin(out?.unitPrice ?? 0).multiply(out?.quantity ?? 0),
    date: await businessTodayIsoDate(),
    userId: operator.id,
    username: operator.name,
  });
}

/**
 * v9.0.452 (TD-918، یافته P5-M01): تخصیص، مانند حواله خروج همان پروژه (TD-233)، رزرو پروژه را به اندازه مقدار خود کم می‌کند و
 * کسر با شماره تخصیص ثبت می‌شود تا آزادسازی همان را برگرداند (TD-237). پیش‌تر پس از تخصیص ۶ از رزرو ۱۰، رزرو هنوز ۱۰ بود و
 * پروژه کالایی را که برده بود دوباره نگه می‌داشت: با رسیدن کالای تازه، فروش ۱ واحد با «رزرو سایر مصارف ۶» رد می‌شد.
 */
async function deductProjectReservation(txEngine: DbExecutor, project: ProjectRow, record: ProjectBomAllocationRecord, operator: AllocationOperator): Promise<void> {
  await releaseReservationsForAllocation(
    txEngine, project.id, record.id, [{ itemId: record.itemId, quantity: record.quantity }], operator.name, operator.id ?? undefined
  );
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
    /** v10.1.37 (N-01, TD-1283): the personnel who receives the materials */
    recipientPersonnelId?: number | null;
    userId?: number;
    username?: string;
    externalTx?: DbExecutor;
    /** TD-943: the request, for the user and IP address of the audit row written with this transaction */
    auditReq?: unknown;
  }): Promise<{
    allocatedCount: number;
    allocations: ProjectBomAllocationRecord[];
  }> {
    const operator = operatorOf(params.userId, params.username);

    return inTransaction(params.externalTx, async (txEngine) => {
      const { project, defaultWh } = await lockProjectForAllocation(txEngine, params.projectId, params.allocations.map(a => a.itemId));
      await assertAllocationWithinSellable(txEngine, project.id, defaultWh, params.allocations);
      const recipientPersonnelId = await liveAllocationRecipient(txEngine, params.recipientPersonnelId);
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

        const record = await recordAllocation(txEngine, {
          project,
          item,
          quantity: qty,
          location: targetLocation,
          sourceTransactionId: stockResult.transactionId,
          notes: req.notes || '',
          action: 'ALLOCATED',
          operator,
          recipientPersonnelId,
        });
        await postAllocationVoucher(txEngine, record, project, item, operator);
        await deductProjectReservation(txEngine, project, record, operator);
        results.push(record);
      }

      const result = { allocatedCount: results.length, allocations: results };
      await logBomAllocation(txEngine, { req: params.auditReq, userId: params.userId, username: params.username }, project.id, result);
      return result;
    });
  }

  /**
   * Marks allocated materials as consumed in production.
   */
  static async consumeAllocation(
    allocationId: number,
    opts?: { userId?: number; username?: string; externalTx?: DbExecutor; auditReq?: unknown }
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
        throw new ConflictError(`این تخصیص «${allocationStatusLabel(alloc.status)}» است و فقط تخصیص «${allocationStatusLabel('allocated')}» مصرف می‌شود.`, { status: alloc.status }, 'ALLOCATION_NOT_OPEN');
      }

      const consumedAt = systemNowUtcIso();
      await txEngine
        .update(projectBomAllocations)
        .set({
          status: 'consumed',
          consumedAt,
        })
        .where(eq(projectBomAllocations.id, allocationId));

      const consumed = {
        ...alloc,
        quantity: fin(alloc.quantity).toNumber(),
        status: 'consumed',
        consumedAt,
      } as ProjectBomAllocationRecord;
      await logBomConsumption(txEngine, { req: opts?.auditReq, userId: opts?.userId, username: opts?.username }, consumed);
      return consumed;
    };

    if (opts?.externalTx) {
      return await executeConsume(opts.externalTx);
    }
    return await idempotentTransaction(executeConsume);
  }

  /**
   * Releases allocated materials back to warehouse inventory (compensatory return).
   */
  static async releaseAllocation(
    allocationId: number,
    opts?: { reason?: string; userId?: number; username?: string; externalTx?: DbExecutor; auditReq?: unknown }
  ): Promise<ProjectBomAllocationRecord> {
    const operatorName = opts?.username || 'سیستم';
    const reason = opts?.reason || 'آزادسازی تخصیص مواد اولیه پروژه';

    const executeRelease = async (txEngine: DbExecutor) => {
      // Pre-read allocation to get itemId for locking in hierarchy order: Items (Level 40) -> Production (Level 50)
      // v9.0.452 (TD-918): the project row before the allocation row, as the reservation restore locks it
      const [preAlloc] = await txEngine
        .select({ itemId: projectBomAllocations.itemId, projectId: projectBomAllocations.projectId })
        .from(projectBomAllocations).where(eq(projectBomAllocations.id, allocationId));
      if (preAlloc?.itemId) {
        await withOrderedLocks(txEngine, [
          { table: items, id: preAlloc.itemId, name: 'items' },
          { table: productionProjects, id: preAlloc.projectId, name: 'productionProjects' },
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
        throw new ConflictError(`این تخصیص «${allocationStatusLabel(alloc.status)}» است و فقط تخصیص «${allocationStatusLabel('allocated')}» به انبار آزاد می‌شود.`, { status: alloc.status }, 'ALLOCATION_NOT_OPEN');
      }
      const qty = fin(alloc.quantity).toNumber();
      const loc = alloc.sourceLocation || 'main';

      // 1. Fetch item and restore stock through centralized DocumentService
      const [item] = await txEngine
        .select()
        .from(items)
        .where(eq(items.id, alloc.itemId))
        .for('no key update');

      // v11 phase 3.2 (S3): the material of a deleted item does not come back to stock. Before, the release put the stock
      // and, with the voided allocation voucher, its value back on an item no list or check shows. The material stays with
      // the project; the allocation can still be recorded as consumed.
      if (item?.isDeleted === 1) {
        throw new ConflictError(
          `کالای «${alloc.itemName}» (${alloc.itemCode}) حذف شده است و مواد این تخصیص به انبار برنمی‌گردد. ` +
          'اگر این مواد در ساخت به کار رفته، تخصیص را با «مصرف شد» ثبت کنید.',
          { itemId: alloc.itemId },
          'ALLOCATION_ITEM_DELETED',
        );
      }

      // v8.0.33 (TD-288): مواد به بهای کاردکس خروج همان تخصیص برمی‌گردند (همان قاعده ابطال خروج، TD-254)، نه به میانگین موزون
      // روز؛ پیش‌تر پس از خرید گران‌تر، آزادسازی ارزش از هیچ می‌ساخت. تخصیصِ رسیدِ پیش از v8.0.32 (حرکت منبع «ورود») موجودی را
      // از انبار برنداشته بود و آزادسازی آن موجودی اضافه نمی‌کند.
      const [source] = alloc.sourceTransactionId
        ? await txEngine.select({ type: transactions.type, unitPrice: transactions.unitPrice }).from(transactions).where(eq(transactions.id, alloc.sourceTransactionId))
        : [];
      const stockLeftWarehouse = source?.type !== 'in';
      const returnUnitCost = source?.type === 'out' ? fin(source.unitPrice ?? 0) : fin(item?.weightedAverageCost ?? 0);

      if (item && stockLeftWarehouse) {
        // v8.0.34 (TD-286): سند تخصیص با قاعده مشترک ابطال باطل می‌شود (پیش‌نویس حذف نرم، تأییدشده معکوس به همان مبلغ)
        await voidBomAllocationVouchers(txEngine, alloc.id, `${reason} (تخصیص شماره ${alloc.id})`, { username: operatorName, userId: opts?.userId });
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

      // v11 phase 6.1ث (decision ت۵۲-۳): the release takes out of the project's 1402 only what its receipts left there
      await assertProjectWipStaysCovered(txEngine, alloc.projectId, 'allocation');

      // v9.0.452 (TD-918): the project's reservation this allocation deducted comes back to the project (rule of TD-237);
      // an allocation before v9.0.452 deducted none and restores nothing
      await restoreReservationsForAllocation(txEngine, alloc.id, operatorName, opts?.userId);

      // 3. Mark allocation as released
      const releasedAt = systemNowUtcIso();
      await txEngine
        .update(projectBomAllocations)
        .set({
          status: 'released',
          releasedAt,
          notes: alloc.notes ? `${alloc.notes} | ${reason}` : reason,
        })
        .where(eq(projectBomAllocations.id, allocationId));

      const released = {
        ...alloc,
        quantity: qty,
        status: 'released',
        releasedAt,
      } as ProjectBomAllocationRecord;
      await logBomRelease(txEngine, { req: opts?.auditReq, userId: opts?.userId, username: opts?.username }, released);
      return released;
    };

    if (opts?.externalTx) {
      return await executeRelease(opts.externalTx);
    }
    return await idempotentTransaction(executeRelease);
  }

  /**
   * Retrieves all BOM allocations for a specific project.
   */
  static async getProjectAllocations(projectId: number): Promise<ProjectBomAllocationRecord[]> {
    return listAllocations([eq(projectBomAllocations.projectId, projectId)]);
  }
}
