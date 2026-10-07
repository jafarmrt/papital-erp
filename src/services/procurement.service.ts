import { terminateOpenWorkflows } from './workflow/workflowTermination.js';
import { sql, eq, and, desc, inArray, or, ilike } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { purchaseRequisitions, documentRefCounters, items, documents, documentItems, workflowInstances, workflowPendingApprovals, workflowTasks } from '../db/schema.js';
import { businessFiscalYear, businessTodayIsoDate } from '../lib/businessClock.js';
import { errorMessageOf } from '../utils.js';
import { requireStorageDate } from '../lib/storageDate.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../errors/customErrors.js';
import { WorkflowTransitionExecutor } from './workflow/workflowTransitionExecutor.js';
import { hasWorkflowTransitionAction } from './workflow/workflowTransitionActions.js';
import { DocumentService } from './document.service.js';
import { userHasRoleOrPermission } from '../middleware/authorize.js';
import { BACKDATE_PERMISSION } from './inventory/stockMovementDate.js';

/** اقدام‌های گردش‌کار «دریافت کالا»ی درخواست خرید */
const RECEIVE_ACTION_KEYS = ['receive_items', 'mark_received', 'receive'];
/** v9.0.267 (TD-689): مجوزهایی که درخواست خرید را تأیید می‌کنند (همان گارد مسیر اقدام گردش‌کار) */
const REQUISITION_APPROVE_PERMISSIONS = ['procurement.approve', 'procurement.manage'];
/** v8.0.71 (TD-326): درخواست ردشده دریافت یا سفارش داده نمی‌شود، مگر پس از بازگشایی */
const CLOSED_REQUISITION_STATUSES = new Set(['rejected', 'cancelled']);
import type { PurchaseRequisition, PurchaseRequisitionItemRow, ProcurementOrder } from '../types.js';
import { containsLikePattern } from '../lib/sqlLike.js';
import { applyDeliveredLines, isSettledRequisitionRow, type RequisitionItemWithReceipt } from './procurement/requisitionReceipt.js';
import { assertProcurementIncomingDocument, RECEIVED_REQUISITION_STATUSES, requisitionOrderDocuments } from './procurement/requisitionReceiveAction.js';
import { describeOverOrders, findOverOrders } from './procurement/requisitionOrder.js';
import { money } from '../lib/money.js';
import { fin } from '../lib/financialDecimal.js';
import { REQUISITION_PRIORITIES, type RequisitionPriority } from '../lib/procurement/requisitionFields.js';
import { ensureRequisitionApproved, requisitionWorkflowGraph, type RequisitionActor, type WorkflowStateRef, type WorkflowTransitionRef } from './procurement/requisitionApproval.js';
import { buildRequisitionRows, resolveRequisitionProject, type RequisitionRowFields } from './procurement/requisitionRows.js';

type DbClient = DbExecutor;


/** ردیف درخواست خرید پس از تحویل انبار (receivedQty در ردیف JSONB نوشته می‌شود) */

/** سند خرید صادرشده از درخواست: ردیف documents، یا شناسه و شماره وقتی ردیف خوانده نشد */
type CreatedProcurementDocument = typeof documents.$inferSelect | { id: number; refNumber: string };

/** v9.0.266 (TD-688): بدنه ثبت درخواست خرید (قرارداد `createRequisitionSchema`) */
export interface CreateRequisitionInput {
  title: string;
  projectId?: number | null;
  priority?: RequisitionPriority;
  requiredDate?: string;
  notes?: string;
  items: RequisitionRowFields[];
}

export interface UpdateRequisitionInput {
  title?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  requiredDate?: string;
  notes?: string;
  items?: PurchaseRequisitionItemRow[];
  assignedToId?: number | null;
  assignedToName?: string;
}

export interface GetRequisitionsFilter {
  status?: string;
  projectId?: number;
  priority?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface SplitOrderGroup {
  supplierId?: number | null;
  supplierName: string;
  targetWarehouse?: string;
  docType?: 'receipt' | 'proforma'; // 'receipt' (سند خرید) or 'proforma' (پیش‌فاکتور خرید)
  status?: 'draft' | 'proforma' | 'final';
  notes?: string;
  items: {
    itemId: number;
    itemCode?: string;
    itemName?: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
  }[];
}

export interface ConvertToOrdersInput {
  requisitionId: number;
  orderGroups: SplitOrderGroup[];
  closeRequisition?: boolean;
  closureReason?: string;
  notes?: string;
  /** v8.0.38 (TD-289): دلیل سفارش بیش از درخواست؛ بدون آن سفارش بیش از مانده درخواست رد می‌شود */
  overOrderReason?: string;
}


/** v7.0.68 (P2-6): مبلغ برآوردی در پاسخ سرویس عدد است (ستون Decimal). */
function toRequisitionDto(row: typeof purchaseRequisitions.$inferSelect): PurchaseRequisition {
  return { ...row, totalEstimatedAmount: row.totalEstimatedAmount?.toNumber() ?? 0 } as unknown as PurchaseRequisition;
}
export class ProcurementService {
  /**
   * Atomic sequential code generation for Purchase Requisitions (e.g. PR-1405-0001)
   * V6 Sub-phase 6.4 (TD-158 / RULE 04): Standardized Read-Calculate-Update pattern with row-level lock.
   */
  static async generateRequisitionCode(tx: DbClient = orm): Promise<string> {
    // v8.0.48 (TD-311): سال امروزِ ساعت توافقی؛ پیش‌تر در دی تا اسفند سال بعد بود
    const fiscalYear = await businessFiscalYear();
    const docType = 'PR';

    // 1. Try to fetch and lock existing counter row
    const [counter] = await tx
      .select()
      .from(documentRefCounters)
      .where(and(
        eq(documentRefCounters.docType, docType),
        eq(documentRefCounters.fiscalYear, fiscalYear)
      ))
      .for('update');

    let seq: number;
    if (counter) {
      seq = (counter.lastRefNumber || 0) + 1;
      await tx
        .update(documentRefCounters)
        .set({ lastRefNumber: seq })
        .where(and(
          eq(documentRefCounters.docType, docType),
          eq(documentRefCounters.fiscalYear, fiscalYear)
        ));
    } else {
      // Cold-start seed or concurrency race handling via onConflictDoNothing
      const inserted = await tx
        .insert(documentRefCounters)
        .values({ docType, fiscalYear, lastRefNumber: 1 })
        .onConflictDoNothing({
          target: [documentRefCounters.docType, documentRefCounters.fiscalYear]
        })
        .returning({ lastRefNumber: documentRefCounters.lastRefNumber });

      if (inserted.length > 0) {
        seq = 1;
      } else {
        // Another concurrent worker inserted the initial seed — lock and increment safely
        const [retryCounter] = await tx
          .select()
          .from(documentRefCounters)
          .where(and(
            eq(documentRefCounters.docType, docType),
            eq(documentRefCounters.fiscalYear, fiscalYear)
          ))
          .for('update');

        seq = (retryCounter?.lastRefNumber || 0) + 1;
        await tx
          .update(documentRefCounters)
          .set({ lastRefNumber: seq })
          .where(and(
            eq(documentRefCounters.docType, docType),
            eq(documentRefCounters.fiscalYear, fiscalYear)
          ));
      }
    }

    const padded = String(seq).padStart(4, '0');
    return `PR-${fiscalYear}-${padded}`;
  }

  /**
   * Create a new purchase requisition and optionally start the workflow instance
   */
  static async createRequisition(
    input: CreateRequisitionInput,
    user: { id?: number; username?: string; role?: string }
  ): Promise<PurchaseRequisition> {
    if (!input.title || input.title.trim() === '') {
      throw new ValidationError('عنوان درخواست خرید الزامی است.');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ValidationError('حداقل یک قلم کالا برای درخواست خرید باید مشخص شود.');
    }

    const priority = input.priority ?? 'normal';
    if (!(REQUISITION_PRIORITIES as readonly string[]).includes(priority)) {
      throw new ValidationError('اولویت درخواست خرید یکی از «فوری»، «بالا»، «عادی» یا «پایین» است.');
    }

    const createdReq = await orm.transaction(async (tx) => {
      // v9.0.266 (TD-688): ردیف‌ها و پروژه با یک قاعده برای ثبت و ویرایش؛ مقدار جمع برآورد با FinancialDecimal (AGENTS §1.8)
      const { rows: sanitizedItems, total: totalEst } = await buildRequisitionRows(tx, input.items);
      const { projectId, projectCode, projectName } = await resolveRequisitionProject(tx, input.projectId);
      const code = await this.generateRequisitionCode(tx);

      const [inserted] = await tx.insert(purchaseRequisitions).values({
        code,
        title: input.title.trim(),
        projectId,
        projectCode,
        projectName,
        status: 'pending',
        priority,
        // v7.0.135 (TD-232): تاریخ نیاز میلادی ISO (پیش‌فرض امروز کسب‌وکار)
        requiredDate: requireStorageDate(input.requiredDate, 'تاریخ نیاز') || await businessTodayIsoDate(),
        requestedById: user.id || null,
        requestedByName: user.username || 'سیستم',
        notes: input.notes || '',
        totalEstimatedAmount: money(totalEst),
        items: sanitizedItems,
        isDeleted: 0
      }).returning();

      // Start workflow instance if definition exists
      // v8.0.77 (TD-324): در همان تراکنش، درون savepoint — شکست گردش‌کار فقط همان را برمی‌گرداند، نه درخواست را
      try {
        const wfInstance = await tx.transaction((sp) => WorkflowTransitionExecutor.startInstance({
          workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
          entityType: 'purchase_requisition',
          entityId: String(inserted.id),
          userId: user.id,
          userName: user.username,
          tx: sp
        }));

        if (wfInstance && wfInstance.id) {
          await tx.update(purchaseRequisitions)
            .set({ workflowInstanceId: wfInstance.id })
            .where(eq(purchaseRequisitions.id, inserted.id));
          inserted.workflowInstanceId = wfInstance.id;
        }
      } catch (err: unknown) {
        logger.warn(`[ProcurementService] Workflow start warning for PR ${inserted.id}: ${String(err)}`);
      }

      await logActivity({
        tx,
        userId: user.id,
        username: user.username || 'سیستم',
        action: 'CREATE',
        entity: 'درخواست خرید',
        entityId: inserted.id,
        description: `ثبت درخواست خرید جدید ${inserted.code} - ${inserted.title}`,
        details: {
          code: inserted.code,
          title: inserted.title,
          projectId: inserted.projectId,
          itemCount: sanitizedItems.length,
          totalEstimatedAmount: totalEst.toNumber()
        }
      });

      return toRequisitionDto(inserted);
    });

    return createdReq;
  }

  /**
   * List purchase requisitions with filtering and pagination
   */
  static async getRequisitions(filter: GetRequisitionsFilter = {}): Promise<{ data: PurchaseRequisition[]; total: number }> {
    const conditions = [eq(purchaseRequisitions.isDeleted, 0)];

    if (filter.status && filter.status !== 'all') {
      conditions.push(eq(purchaseRequisitions.status, filter.status));
    }

    if (filter.projectId) {
      conditions.push(eq(purchaseRequisitions.projectId, filter.projectId));
    }

    if (filter.priority && filter.priority !== 'all') {
      conditions.push(eq(purchaseRequisitions.priority, filter.priority));
    }

    if (filter.search && filter.search.trim()) {
      const q = containsLikePattern(filter.search.trim());
      conditions.push(
        or(
          ilike(purchaseRequisitions.code, q),
          ilike(purchaseRequisitions.title, q),
          ilike(purchaseRequisitions.projectCode, q),
          ilike(purchaseRequisitions.projectName, q)
        )!
      );
    }

    const whereClause = and(...conditions);
    const limit = Math.min(filter.limit || 50, 100);
    const page = Math.max(filter.page || 1, 1);
    const offset = (page - 1) * limit;

    const [countRes] = await orm
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseRequisitions)
      .where(whereClause);

    const rows = await orm
      .select()
      .from(purchaseRequisitions)
      .where(whereClause)
      .orderBy(desc(purchaseRequisitions.id))
      .limit(limit)
      .offset(offset);

    return {
      data: rows.map(toRequisitionDto),
      total: countRes?.count || 0
    };
  }

  /**
   * Get single requisition by ID with latest details
   */
  static async getRequisitionById(id: number): Promise<PurchaseRequisition> {
    const [req] = await orm
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)));

    if (!req) {
      throw new NotFoundError(`درخواست خرید با شناسه #${id} یافت نشد.`);
    }

    return toRequisitionDto(req);
  }

  /**
   * Update requisition items, assignments, or estimates
   */
  static async updateRequisition(
    id: number,
    updates: UpdateRequisitionInput,
    user: { id?: number; username?: string }
  ): Promise<PurchaseRequisition> {
    const existing = await this.getRequisitionById(id);

    let newItems = existing.items;
    let newTotalEst = fin(existing.totalEstimatedAmount);

    if (updates.items && Array.isArray(updates.items)) {
      newTotalEst = fin(0);
      newItems = updates.items.map((item, idx) => {
        const qty = Number(item.requestedQty || item.requested_qty || 0);
        const ordered = Number(item.orderedQty || item.ordered_qty || 0);
        const price = Number(item.unitPriceEstimate || item.unit_price_estimate || 0);
        newTotalEst = newTotalEst.add(fin(qty).multiply(price));
        return {
          id: item.id || `item-${Date.now()}-${idx}`,
          itemId: item.itemId ?? item.item_id ?? null,
          itemCode: item.itemCode || item.item_code || '',
          itemName: item.itemName || item.item_name || 'کالای سفارشی',
          category: item.category || '',
          unit: item.unit || 'عدد',
          requestedQty: qty,
          orderedQty: ordered,
          remainingQty: Math.max(0, qty - ordered),
          unitPriceEstimate: price,
          targetSupplierId: item.targetSupplierId ?? item.target_supplier_id ?? null,
          targetSupplierName: item.targetSupplierName || item.target_supplier_name || '',
          status: item.status || (ordered >= qty ? 'ordered' : 'pending'),
          linkedDocumentIds: item.linkedDocumentIds || item.linked_document_ids || [],
          notes: item.notes || ''
        };
      });
    }

    const [updated] = await orm.update(purchaseRequisitions).set({
      title: updates.title !== undefined ? updates.title.trim() : existing.title,
      priority: updates.priority || existing.priority,
      requiredDate: (updates.requiredDate ? requireStorageDate(updates.requiredDate, 'تاریخ نیاز') : '') || existing.requiredDate,
      notes: updates.notes !== undefined ? updates.notes : existing.notes,
      items: newItems,
      totalEstimatedAmount: money(newTotalEst),
      assignedToId: updates.assignedToId !== undefined ? updates.assignedToId : existing.assignedToId,
      assignedToName: updates.assignedToName !== undefined ? updates.assignedToName : existing.assignedToName,
      updatedAt: new Date().toISOString()
    }).where(eq(purchaseRequisitions.id, id)).returning();

    await logActivity({
      userId: user.id,
      username: user.username || 'سیستم',
      action: 'UPDATE',
      entity: 'درخواست خرید',
      entityId: id,
      description: `ویرایش درخواست خرید ${updated.code}`,
      details: {
        code: updated.code,
        before: { title: existing.title, itemsCount: existing.items.length },
        after: { title: updated.title, itemsCount: newItems.length, totalEstimatedAmount: newTotalEst.toNumber() }
      }
    });

    return toRequisitionDto(updated);
  }

  /**
   * Delete requisition (soft delete)
   */
  static async deleteRequisition(id: number, user: { id?: number; username?: string }): Promise<void> {
    const existing = await this.getRequisitionById(id);
    // v9.0.40 (TD-447، ت۵): حذف و بستن فرایند در جریان درخواست در یک تراکنش، زیر قفل ردیف درخواست (وضعیت زیر قفل دوباره خوانده می‌شود)
    await orm.transaction(async (tx) => {
      const [locked] = await tx.select({ status: purchaseRequisitions.status }).from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      if (!locked) throw new NotFoundError('درخواست خرید یافت نشد.');
      if (locked.status === 'ordered' || locked.status === 'received') {
        throw new ValidationError('درخواست‌های خریدی که سفارش آنها صادر شده یا کالا تحویل شده قابل حذف نیستند.');
      }

      await tx.update(purchaseRequisitions).set({
        isDeleted: 1,
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, id));
      await terminateOpenWorkflows(tx, {
        entityType: 'purchase_requisition', entityId: id, actionKey: 'terminate', actionTitle: 'بستن فرایند با حذف درخواست خرید',
        comment: 'حذف درخواست خرید', userId: user.id, userName: user.username,
      });

      await logActivity({
        userId: user.id,
        username: user.username || 'سیستم',
        action: 'DELETE',
        entity: 'درخواست خرید',
        entityId: id,
        description: `حذف درخواست خرید ${existing.code}`,
        details: { code: existing.code, title: existing.title },
        tx,
      });
    });
  }

  /**
   * v7.0.111 (TD-238): وضعیت‌ها و انتقال‌های فرایند درخواست خرید — از تصویر خود فرایند فقط وقتی با شناسه‌های پایگاه‌داده
   * ساخته شده (isUsableSnapshot، AGENTS.md §14.3)، وگرنه از جدول‌های جاری تعریف؛ تصویر قدیمی بدون شناسه به کار نمی‌رود.
   */
  static async workflowGraphOf(
    wfInst: Pick<typeof workflowInstances.$inferSelect, 'snapshotDsl' | 'workflowDefinitionId'>,
    db: DbExecutor = orm
  ): Promise<{ states: WorkflowStateRef[]; transitions: WorkflowTransitionRef[] }> {
    return requisitionWorkflowGraph(wfInst, db);
  }

  /**
   * Execute workflow transition on purchase requisition
   *
   * v8.0.71 (TD-326): کل اقدام در یک تراکنش و زیر قفل ردیف درخواست اجرا می‌شود و درخواست زیر همان قفل دوباره خوانده
   * می‌شود. «دریافت کالا»ی درخواستِ دریافت‌شده یا ردشده رد می‌شود، و نمونه گردش‌کار تنبل در همان تراکنش ساخته می‌شود؛
   * پیش‌تر دو «دریافت» هم‌زمان درخواست بی‌نمونه دو نمونه و دو رسید می‌ساختند.
   *
   * v9.0.2 (TD-415): وضعیت درخواست و دریافت کالا را اقدام پس از انتقال تدارکات (applyRequisitionTransition) در همان
   * تراکنش انتقال می‌نویسد، همان که برای انتقال از کارتابل هم اجرا می‌شود؛ این‌جا فقط درخواست پس از انتقال خوانده می‌شود.
   */
  static async executeWorkflowAction(
    requisitionId: number,
    actionKey: string,
    user: { id?: number; username?: string; role?: string; permissions?: string[] },
    comment?: string
  ): Promise<{ success: boolean; requisition: PurchaseRequisition; message?: string }> {
    if (!hasWorkflowTransitionAction('purchase_requisition')) {
      // بی اقدام ثبت‌شده، گام جابه‌جا می‌شد ولی درخواست نه وضعیت می‌گرفت و نه کالایش دریافت می‌شد
      throw new AppError('اقدام گردش‌کار درخواست خرید در راه‌اندازی سرور ثبت نشده است (registerWorkflowDomainActions).', 500, 'WF_DOMAIN_ACTIONS_NOT_REGISTERED');
    }
    const isReceive = RECEIVE_ACTION_KEYS.includes(actionKey);
    // v8.0.4 (TD-257): نهایی‌سازی رسید پیش‌نویس با تاریخ پیش از آخرین گردش کالا فقط با مجوز همین کاربر
    const allowBackdate = isReceive ? await userHasRoleOrPermission(user, BACKDATE_PERMISSION) : false;

    const outcome = await orm.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      if (!locked) {
        throw new NotFoundError(`درخواست خرید با شناسه #${requisitionId} یافت نشد.`);
      }
      const req = toRequisitionDto(locked);
      if (isReceive && RECEIVED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} قبلاً دریافت شده است و کالای آن دوباره وارد انبار نمی‌شود.`);
      }
      // v8.0.124 (TD-405): کالای درخواستِ دریافت‌شده وارد انبار شده است؛ هیچ اقدام گردش‌کاری آن را برنمی‌گرداند، هر گامی
      // که نمونه گردش‌کار داشته باشد (پیش‌تر «خودترمیمی» گام را به «دریافت‌شده» می‌برد و همین جلوی اقدام را می‌گرفت)
      if (RECEIVED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} دریافت شده است و اقدام «${actionKey}» روی آن اجرا نمی‌شود.`, undefined, 'WF_ACTION_NOT_IN_STEP');
      }
      if (isReceive && CLOSED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} رد شده است و کالای آن وارد انبار نمی‌شود؛ ابتدا درخواست را بازگشایی کنید.`);
      }

      if (!req.workflowInstanceId) {
        // Lazy start workflow instance if not present
        const instance = await WorkflowTransitionExecutor.startInstance({
          workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
          entityType: 'purchase_requisition',
          entityId: String(req.id),
          userId: user.id,
          userName: user.username,
          tx
        });
        req.workflowInstanceId = instance.id;
        await tx.update(purchaseRequisitions)
          .set({ workflowInstanceId: instance.id })
          .where(eq(purchaseRequisitions.id, req.id));
      }

      const [wfInst] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, req.workflowInstanceId));
      if (!wfInst) {
        throw new ValidationError('نمونه فرآیند گردش کار مرتبط یافت نشد');
      }

      const { states, transitions } = await this.workflowGraphOf(wfInst, tx);

      // v8.0.124 (TD-405): گام نمونه گردش‌کار مرجع است و از وضعیت درخواست بازنویسی نمی‌شود. پیش‌تر «خودترمیمی» گام را
      // بی انتقال و بی تاریخچه به گام هم‌نام وضعیت درخواست می‌برد و امضاها و کارهای گام پیشین بی‌اثر می‌ماند؛ اکنون اقدام
      // فقط انتقالی از همین گام را اجرا می‌کند و وضعیت درخواست از گام مقصد آن می‌آید (TD-379).

      const ACTION_KEY_ALIASES: Record<string, string[]> = {
        mark_received: ['receive_items', 'mark_received', 'receive'],
        receive_items: ['receive_items', 'mark_received', 'receive'],
        approve_request: ['direct_admin_order', 'approve_order', 'approve_request', 'direct_order'],
        approve_order: ['approve_order', 'direct_admin_order', 'approve_request', 'direct_order'],
        direct_admin_order: ['direct_admin_order', 'approve_order', 'approve_request', 'direct_order'],
        direct_order: ['direct_admin_order', 'direct_order', 'approve_order', 'approve_request'],
        submit_for_approval: ['send_to_manager', 'submit_to_procurement', 'submit_for_approval'],
        send_to_manager: ['send_to_manager', 'submit_for_approval'],
        submit_to_procurement: ['submit_to_procurement', 'submit_for_review'],
        reject_request: ['reject_request', 'reject_manager', 'reject_procurement', 'reject', 'cancel'],
        reject_manager: ['reject_manager', 'reject_request', 'reject', 'reject_procurement'],
        reject_procurement: ['reject_procurement', 'reject_manager', 'reject_request', 'reject'],
        reopen: ['reopen']
      };

      const targetActionKeys = ACTION_KEY_ALIASES[actionKey] || [actionKey];

      // Find valid transition from current state only (never pick a transition with mismatched fromStateId)
      let matchedTransition = transitions.find(t =>
        targetActionKeys.includes(t.actionKey) && (!t.fromStateId || t.fromStateId === wfInst.currentStateId)
      );

      // v8.0.101 (TD-390، تصمیم مالک محصول «تأیید با نام او»): «دریافت کالا»ی درخواستِ تأییدنشده نخست انتقال تأیید گام
      // جاری را به نام دریافت‌کننده اجرا می‌کند (نقش و مجوز او سنجیده و در تاریخچه ثبت می‌شود) و سپس کالا را دریافت می‌کند.
      // پیش‌تر گام فرایند بی امضا و بی ثبت مستقیم به «سفارش‌شده» برده می‌شد.
      if (!matchedTransition && (actionKey === 'mark_received' || actionKey === 'receive_items')) {
        const approveKeys = ACTION_KEY_ALIASES.approve_request;
        const approveTransition = transitions.find(t => approveKeys.includes(t.actionKey) && t.fromStateId === wfInst.currentStateId);
        if (approveTransition) {
          const approval = await WorkflowTransitionExecutor.executeTransition({
            instanceId: wfInst.id,
            transitionId: approveTransition.id,
            userId: user.id,
            userName: user.username,
            userRole: user.role,
            userPermissions: user.permissions || [],
            comment: comment || 'تأیید هنگام دریافت کالا',
            snapshotData: { id: req.id, code: req.code, totalAmount: Number(req.totalEstimatedAmount || 0), priority: req.priority, status: req.status },
            allowBackdate,
            tx
          });
          if (!('toState' in approval) || !approval.toState) {
            throw new ConflictError(`تأیید درخواست خرید ${req.code} هنوز امضاهای دیگری می‌خواهد؛ کالا پس از تکمیل تأیید دریافت می‌شود.`, undefined, 'WF_APPROVAL_PENDING');
          }
          wfInst.currentStateId = approval.toState.id;
          matchedTransition = transitions.find(t =>
            targetActionKeys.includes(t.actionKey) && (!t.fromStateId || t.fromStateId === wfInst.currentStateId)
          );
        }
      }

      if (!matchedTransition) {
        // v8.0.99 (TD-379): اقدامی که انتقالی از گام جاری ندارد رد می‌شود. پیش‌تر «میان‌بر» وضعیت درخواست را مستقیم
        // عوض می‌کرد: درخواستِ دریافت‌شده «بازگشایی» و دوباره سفارش و وارد انبار می‌شد و درخواستِ ردشده بی بازگشایی تأیید.
        const stepTitle = states.find(s => s.id === wfInst.currentStateId)?.title || req.status;
        throw new ConflictError(`اقدام «${actionKey}» در گام فعلی درخواست خرید ${req.code} («${stepTitle}») مجاز نیست.`, undefined, 'WF_ACTION_NOT_IN_STEP');
      }
      const transitionTitle = matchedTransition.title || actionKey;
      await WorkflowTransitionExecutor.executeTransition({
        instanceId: req.workflowInstanceId,
        transitionId: matchedTransition.id,
        userId: user.id,
        userName: user.username,
        userRole: user.role,
        userPermissions: user.permissions || [],
        comment,
        snapshotData: {
          id: req.id,
          code: req.code,
          totalAmount: Number(req.totalEstimatedAmount || 0),
          priority: req.priority,
          status: req.status
        },
        allowBackdate,
        tx
      });

      // وضعیت و ردیف‌ها را اقدام پس از انتقال (applyRequisitionTransition) در همین تراکنش نوشته است
      const [updatedReq] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, req.id));
      return { req, updatedReq, mappedStatus: updatedReq.status, transitionTitle };
    });
    const { req, updatedReq, mappedStatus, transitionTitle } = outcome;

    await logActivity({
      userId: user.id,
      username: user.username || 'سیستم',
      action: 'UPDATE',
      entity: 'درخواست خرید',
      entityId: req.id,
      description: `اقدام گردش کار «${transitionTitle}» روی درخواست خرید ${req.code}`,
      details: {
        actionKey,
        fromStatus: req.status,
        toStatus: mappedStatus,
        comment
      }
    });

    const statusTitleMap: Record<string, string> = {
      pending: 'در انتظار بررسی و تایید',
      under_review: 'در انتظار بررسی و تایید',
      manager_approval: 'در انتظار بررسی و تایید',
      ordered: 'تایید شده (در حال خرید)',
      received: 'خرید و تحویل انبار شد',
      rejected: 'رد شده'
    };

    return {
      success: true,
      requisition: toRequisitionDto(updatedReq),
      message: `وضعیت درخواست با موفقیت به «${statusTitleMap[mappedStatus] || mappedStatus}» تغییر یافت.`
    };
  }

  /**
   * Split & Convert Requisition Items into Purchase Documents (Orders/Receipts/Proformas)
   *
   * v8.0.38 (TD-289، تصمیم مالک محصول — گزینه ب): سفارش بیش از درخواست مجاز است، ولی فقط با دلیل. اگر این تبدیل کالایی را
   * بیش از مانده درخواست سفارش دهد (درخواستِ کامل‌سفارش‌شده یا مقدار بیشتر از مانده) و دلیلی نیامده باشد، با کد
   * OVER_ORDER_REASON_REQUIRED رد می‌شود و پیام فهرست کالاها را می‌گوید (فرم هشدار می‌دهد و دلیل می‌خواهد). با دلیل، سفارش
   * ثبت و دلیل روی ردیف درخواست (overOrders)، در یادداشت درخواست و سند سفارش و در گزارش فعالیت ثبت می‌شود. پیش‌تر درخواستِ
   * کامل‌سفارش‌شده بی‌هیچ هشداری دوباره سفارش داده می‌شد. همه سفارش‌ها و به‌روزرسانی درخواست در یک تراکنش و زیر قفل ردیف
   * درخواست است، تا دو تبدیل هم‌زمان از بررسی نگذرند و شکست یک بسته سفارش‌های دیگر را نیمه‌کاره باقی نگذارد.
   */
  static async convertToPurchaseOrders(
    params: ConvertToOrdersInput,
    user: RequisitionActor
  ): Promise<{ createdDocuments: CreatedProcurementDocument[]; requisition: PurchaseRequisition }> {
    const { requisitionId, orderGroups } = params;
    if (!orderGroups || !Array.isArray(orderGroups) || orderGroups.length === 0) {
      throw new ValidationError('حداقل یک گروه سفارش خرید باید تعیین شود.');
    }
    const overOrderReason = params.overOrderReason?.trim() || '';
    const username = user.username || 'کارشناس تدارکات';
    const today = await businessTodayIsoDate();
    // v9.0.267 (TD-689، ت۱): حق تأیید پیش از تراکنش سنجیده می‌شود (TD-324: بی اتصال دوم درون تراکنش)
    const mayApprove = await userHasRoleOrPermission(user, ...REQUISITION_APPROVE_PERMISSIONS);

    const converted = await orm.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      if (!locked) {
        throw new NotFoundError(`درخواست خرید با شناسه #${requisitionId} یافت نشد.`);
      }
      const req = toRequisitionDto(locked);
      // v8.0.71 (TD-326): درخواستِ دریافت‌شده یا ردشده دوباره سفارش داده نمی‌شود؛ پیش‌تر سفارش و تحویل درخواستی که «دریافت
      // کالا» همه‌اش را وارد انبار کرده بود، کالا را دو بار وارد انبار می‌کرد
      if (RECEIVED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} قبلاً دریافت شده است و دوباره سفارش داده نمی‌شود.`);
      }
      if (CLOSED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} رد شده است و سفارش داده نمی‌شود؛ ابتدا درخواست را بازگشایی کنید.`);
      }
      // v9.0.267 (TD-689، ت۱): سفارش فقط از گام «تأییدشده»؛ دارنده حق تأیید نخست تأیید را به نام خودش اجرا می‌کند
      await ensureRequisitionApproved(tx, req, user, {
        mayApprove,
        comment: 'تأیید هنگام صدور سفارش خرید',
        snapshotData: { id: req.id, code: req.code, totalAmount: Number(req.totalEstimatedAmount || 0), priority: req.priority, status: req.status },
      });
      const updatedItems = (Array.isArray(req.items) ? req.items : []).map(it => ({ ...it }));

      const overOrders = findOverOrders(updatedItems, orderGroups.flatMap(g => g.items || []));
      if (overOrders.length > 0 && !overOrderReason) {
        throw new AppError(
          `سفارش بیش از درخواست خرید ${req.code}: ${describeOverOrders(overOrders)}. برای ثبت، دلیل سفارش بیش از درخواست را وارد کنید.`,
          422, 'OVER_ORDER_REASON_REQUIRED', { overOrders }
        );
      }
      const overOrderedIds = new Set(overOrders.map(o => o.itemId));
      const createdDocuments: CreatedProcurementDocument[] = [];
      const documentIdsByItem = new Map<number, number[]>();

      for (const group of orderGroups) {
        if (!group.items || group.items.length === 0) continue;

        const supplierName = group.supplierName?.trim() || 'تامین‌کننده تدارکات';
        // v8.0.10 (TD-267): سفارش خرید همیشه سند ورودی (رسید) است؛ «پیش‌فاکتور خرید» رسید با وضعیت پیش‌فاکتور است. پیش‌تر
        // نوع proforma ساخته می‌شد و نهایی‌سازی پیش‌فاکتور آن را فاکتور فروش می‌کرد: کالا از انبار خارج و فروش ثبت می‌شد
        const docType = 'receipt';
        const docStatus = group.docType === 'proforma' ? 'proforma' : (group.status || 'draft');
        const warehouseLoc = group.targetWarehouse || '';

        // Format items for DocumentService
        const docLines = group.items.map(i => ({
          itemId: i.itemId,
          quantity: Number(i.quantity),
          unit_price: Number(i.unitPrice || 0),
          discount: 0,
          location: warehouseLoc
        }));

        const overOrderNote = group.items.some(i => overOrderedIds.has(Number(i.itemId))) ? `[سفارش بیش از درخواست: ${overOrderReason}]` : '';
        const docNotes = `[تدارکات: درخواست ${req.code}] ${req.projectName ? `[پروژه: ${req.projectName}]` : ''} ${overOrderNote} ${group.notes || ''}`.replace(/\s+/g, ' ').trim();

        const createdDocId = await DocumentService.createDocument({
          docType,
          date: today,
          status: docStatus,
          buyer_name: supplierName,
          notes: docNotes,
          location: warehouseLoc,
          inOut: 'in',
          currency: 'IRR',
          user: username,
          items: docLines,
          externalTx: tx
        });

        const [createdDocRecord] = await tx.select().from(documents).where(eq(documents.id, createdDocId));
        createdDocuments.push(createdDocRecord || { id: createdDocId, refNumber: `DOC-${createdDocId}` });

        // Update matching items in the requisition
        for (const groupItem of group.items) {
          const docIds = documentIdsByItem.get(Number(groupItem.itemId)) ?? [];
          if (!docIds.includes(createdDocId)) documentIdsByItem.set(Number(groupItem.itemId), [...docIds, createdDocId]);

          const targetReqItem = updatedItems.find(r =>
            (r.itemId && r.itemId === groupItem.itemId) ||
            (r.itemCode && groupItem.itemCode && r.itemCode === groupItem.itemCode)
          );

          if (targetReqItem) {
            const ordQty = (targetReqItem.orderedQty || 0) + Number(groupItem.quantity);
            targetReqItem.orderedQty = ordQty;
            targetReqItem.remainingQty = Math.max(0, (targetReqItem.requestedQty || 0) - ordQty);
            targetReqItem.targetSupplierName = supplierName;
            targetReqItem.targetSupplierId = group.supplierId || targetReqItem.targetSupplierId;
            targetReqItem.status = targetReqItem.remainingQty <= 0 ? 'ordered' : 'pending';

            if (!targetReqItem.linkedDocumentIds) targetReqItem.linkedDocumentIds = [];
            if (createdDocId && !targetReqItem.linkedDocumentIds.includes(createdDocId)) {
              targetReqItem.linkedDocumentIds = [...targetReqItem.linkedDocumentIds, createdDocId];
            }
          }
        }
      }

      // v8.0.38 (TD-289): هر سفارش بیش از درخواست با دلیل روی ردیف همان کالا ثبت می‌شود
      for (const over of overOrders) {
        const row = updatedItems.find(r => Number(r.itemId) === over.itemId);
        if (!row) continue;
        row.overOrders = [...(Array.isArray(row.overOrders) ? row.overOrders : []), {
          quantity: over.excess, reason: overOrderReason, user: username, date: today, documentIds: documentIdsByItem.get(over.itemId) ?? [],
        }];
      }

      // Determine overall requisition status
      const allOrdered = updatedItems.every(i => (i.orderedQty || 0) >= (i.requestedQty || 0));
      const shouldCloseRequisition = Boolean(params.closeRequisition || allOrdered);

      if (shouldCloseRequisition) {
        // If closing formally, mark remaining items as closed/ordered with optional note
        // v9.0.268 (TD-690): ردیف بسته‌شده نشان `closed` می‌گیرد؛ دیگر سفارش داده و بی سفارش دریافت نمی‌شود
        for (const item of updatedItems) {
          if ((item.remainingQty || 0) > 0) {
            item.remainingQty = 0;
            item.status = 'ordered';
            item.closed = true;
            if (params.closureReason) {
              item.closureNote = params.closureReason;
            }
          }
        }
      }

      let updatedReqNotes = req.notes || '';
      if (overOrders.length > 0) {
        updatedReqNotes = `${updatedReqNotes}\n[سفارش بیش از درخواست (${username}، ${today}): ${overOrderReason} — ${describeOverOrders(overOrders)}]`.trim();
      }
      if (params.closureReason) {
        updatedReqNotes = `${updatedReqNotes}\n[تکمیل/بستن خرید: ${params.closureReason}]`.trim();
      }

      // v9.0.267 (TD-689): وضعیت درخواست فقط از گام گردش‌کار می‌آید (applyRequisitionTransition)؛ تبدیل گام را جابه‌جا
      // نمی‌کند. پیش‌تر تبدیل بخشی وضعیت را «در حال بررسی» و تراکنش دومی گام را مستقیم «در انتظار» می‌نوشت (A02-15)
      const [finalUpdatedReq] = await tx.update(purchaseRequisitions).set({
        items: updatedItems,
        notes: updatedReqNotes,
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, req.id)).returning();

      await logActivity({
        tx,
        userId: user.id,
        username: user.username || 'سیستم',
        action: 'UPDATE',
        entity: 'درخواست خرید',
        entityId: req.id,
        description: `تبدیل و صدور ${createdDocuments.length} سفارش خرید برای درخواست ${req.code}${overOrders.length > 0 ? ` (سفارش بیش از درخواست با دلیل: ${overOrderReason})` : ''}`,
        details: {
          code: req.code,
          createdDocsCount: createdDocuments.length,
          docNumbers: createdDocuments.map(d => d.refNumber || d.id),
          status: finalUpdatedReq.status,
          ...(overOrders.length > 0 ? { overOrders, overOrderReason } : {})
        }
      });

      return { createdDocuments, finalUpdatedReq };
    });
    const { createdDocuments, finalUpdatedReq } = converted;

    return {
      createdDocuments,
      requisition: toRequisitionDto(finalUpdatedReq)
    };
  }

  /**
   * Consolidate items across multiple requisitions into a single requisition or purchase group
   */
  static async consolidateRequisitions(
    requisitionIds: number[],
    newTitle: string,
    user: { id?: number; username?: string }
  ): Promise<PurchaseRequisition> {
    if (!requisitionIds || requisitionIds.length < 2) {
      throw new ValidationError('برای تجمیع حداقل دو درخواست خرید باید انتخاب شود.');
    }

    const reqs = await orm.select().from(purchaseRequisitions)
      .where(and(inArray(purchaseRequisitions.id, requisitionIds), eq(purchaseRequisitions.isDeleted, 0)));

    if (reqs.length === 0) {
      throw new ValidationError('درخواست‌های انتخابی یافت نشدند.');
    }

    // Consolidate items by itemId / itemCode
    const itemMap = new Map<string, PurchaseRequisitionItemRow>();

    for (const r of reqs) {
      const itemsList = Array.isArray(r.items) ? (r.items as PurchaseRequisitionItemRow[]) : [];
      for (const item of itemsList) {
        const key = item.itemId ? `id-${item.itemId}` : `code-${item.itemCode || item.itemName}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, { ...item, notes: `تجمیع از ${r.code}` });
        } else {
          const existing = itemMap.get(key)!;
          existing.requestedQty = Number(existing.requestedQty) + Number(item.requestedQty);
          existing.remainingQty = (existing.remainingQty || 0) + (item.remainingQty || item.requestedQty);
          existing.notes = `${existing.notes || ''} + ${r.code}`.trim();
        }
      }
    }

    const consolidatedItems = Array.from(itemMap.values());

    return this.createRequisition({
      title: newTitle || `تجمیع درخواست‌های خرید (${reqs.map(r => r.code).join('، ')})`,
      priority: 'normal',
      notes: `تجمیع شده از درخواست‌های: ${reqs.map(r => r.code).join('، ')}`,
      items: consolidatedItems
    }, user);
  }

  /**
   * Get purchase orders/invoices created from procurement requisitions
   */
  static async getProcurementOrders(params: {
    status?: string; // 'all' | 'draft' | 'final' | 'pending_delivery' | 'delivered'
    requisitionId?: number;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ProcurementOrder[]; total: number; page: number; limit: number }> {
    const { status, requisitionId, search, page = 1, limit = 50 } = params;

    const allCandidateDocs = await orm.select().from(documents).where(and(
      eq(documents.isDeleted, 0),
      or(
        eq(documents.type, 'receipt'),
        eq(documents.type, 'proforma'),
        ilike(documents.notes, '%[تدارکات:%')
      )
    )).orderBy(desc(documents.id));

    const allReqs = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.isDeleted, 0));
    const reqCodeMap = new Map<string, typeof allReqs[0]>();
    allReqs.forEach(r => {
      reqCodeMap.set(r.code, r);
    });

    const filteredDocs: (typeof allCandidateDocs[0] & { _matchedReq?: typeof allReqs[0] })[] = [];

    for (const doc of allCandidateDocs) {
      let isProcurement = false;
      let matchedReq: typeof allReqs[0] | undefined;

      if (doc.notes && doc.notes.includes('[تدارکات:')) {
        isProcurement = true;
        const m = doc.notes.match(/\[تدارکات:\s*درخواست\s+([^\]]+)\]/);
        if (m) {
          const c = m[1].trim();
          matchedReq = reqCodeMap.get(c);
        }
      }

      if (!isProcurement) {
        for (const r of allReqs) {
          if (Array.isArray(r.items) && r.items.some(it => Array.isArray(it.linkedDocumentIds) && it.linkedDocumentIds.includes(doc.id))) {
            isProcurement = true;
            matchedReq = r;
            break;
          }
        }
      }

      if (!isProcurement && doc.type === 'receipt') {
        isProcurement = true;
      }

      if (!isProcurement) continue;

      if (requisitionId && matchedReq?.id !== requisitionId) {
        continue;
      }

      if (status && status !== 'all') {
        if (status === 'pending_delivery' || status === 'draft') {
          if (doc.status === 'final') continue;
        } else if (status === 'delivered' || status === 'final') {
          if (doc.status !== 'final') continue;
        }
      }

      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const mRef = (doc.refNumber || '').toLowerCase().includes(q);
        const mBuyer = (doc.buyerName || '').toLowerCase().includes(q);
        const mNotes = (doc.notes || '').toLowerCase().includes(q);
        const mReq = matchedReq ? (matchedReq.code.toLowerCase().includes(q) || matchedReq.title.toLowerCase().includes(q)) : false;
        if (!mRef && !mBuyer && !mNotes && !mReq) continue;
      }

      const docWithReq = doc as typeof doc & { _matchedReq?: typeof allReqs[0] };
      docWithReq._matchedReq = matchedReq;
      filteredDocs.push(docWithReq);
    }

    const total = filteredDocs.length;
    const offset = (page - 1) * limit;
    const pagedDocs = filteredDocs.slice(offset, offset + limit);

    if (pagedDocs.length === 0) {
      return { data: [], total, page, limit };
    }

    const docIds = pagedDocs.map(d => d.id);
    const lines = await orm.select().from(documentItems).where(inArray(documentItems.documentId, docIds));
    const allItemIds = Array.from(new Set(lines.map(l => l.itemId)));

    let catalogItems: (typeof items.$inferSelect)[] = [];
    if (allItemIds.length > 0) {
      catalogItems = await orm.select().from(items).where(inArray(items.id, allItemIds));
    }
    const itemMap = new Map<number, typeof items.$inferSelect>();
    catalogItems.forEach(it => itemMap.set(it.id, it));

    const result: ProcurementOrder[] = pagedDocs.map(doc => {
      const docLines = lines.filter(l => l.documentId === doc.id);
      const matchedReq = doc._matchedReq;

      let projectN = matchedReq?.projectName || null;
      if (!projectN && doc.notes) {
        const pMatch = doc.notes.match(/\[پروژه:\s*([^\]]+)\]/);
        if (pMatch) projectN = pMatch[1].trim();
      }

      let requisitionC = matchedReq?.code || null;
      if (!requisitionC && doc.notes) {
        const rMatch = doc.notes.match(/\[تدارکات:\s*درخواست\s+([^\]]+)\]/);
        if (rMatch) requisitionC = rMatch[1].trim();
      }

      // v7.0.113 (TD-239): جمع مبلغ سفارش خرید با FinancialDecimal؛ خروجی API عددی می‌ماند
      let totalAmt = fin(0);
      const mappedItems = docLines.map(l => {
        const cat = itemMap.get(l.itemId);
        const lineQty = Number(l.quantity || 0);
        const linePrice = fin(l.unitPrice);
        const lineTotal = linePrice.multiply(lineQty);
        totalAmt = totalAmt.add(lineTotal);

        return {
          id: l.id,
          itemId: l.itemId,
          itemName: cat?.name || `کالای کد ${l.itemId}`,
          itemCode: cat?.code || '',
          unit: cat?.unit || 'عدد',
          quantity: lineQty,
          unitPrice: linePrice.toNumber(),
          totalPrice: lineTotal.toNumber(),
          location: l.location || docLines[0]?.location || ''
        };
      });

      return {
        id: doc.id,
        refNumber: doc.refNumber,
        docType: doc.type,
        status: doc.status === 'final' ? 'final' : 'draft',
        date: doc.date,
        supplierName: doc.buyerName || 'تامین‌کننده تدارکات',
        notes: doc.notes || '',
        requisitionId: matchedReq?.id || null,
        requisitionCode: requisitionC,
        projectName: projectN,
        location: docLines[0]?.location || '',
        totalAmount: totalAmt.toNumber(),
        itemsCount: mappedItems.length,
        items: mappedItems,
        user: doc.user || 'کارشناس تدارکات'
      };
    });

    return { data: result, total, page, limit };
  }

  /**
   * درخواست خرید سفارش تحویل‌شده: با کد درخواست در یادداشت سند، وگرنه درخواستی که این سند را در linkedDocumentIds دارد
   */
  private static async findDeliveredOrderRequisitionId(tx: DbExecutor, reqCode: string | null, documentId: number): Promise<number | null> {
    if (reqCode) {
      const [byCode] = await tx.select({ id: purchaseRequisitions.id }).from(purchaseRequisitions).where(and(
        eq(purchaseRequisitions.code, reqCode),
        eq(purchaseRequisitions.isDeleted, 0)
      ));
      if (byCode) return byCode.id;
    }
    const allReqs = await tx.select({ id: purchaseRequisitions.id, items: purchaseRequisitions.items }).from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.isDeleted, 0));
    const linked = allReqs.find(r => Array.isArray(r.items)
      && (r.items as PurchaseRequisitionItemRow[]).some(it => Array.isArray(it.linkedDocumentIds) && it.linkedDocumentIds.map(Number).includes(documentId)));
    return linked?.id ?? null;
  }

  /**
   * Deliver a specific procurement purchase order to warehouse
   * (finalizes document, increases stock, updates Kardex, and syncs requisition)
   */
  static async deliverOrderToWarehouse(
    documentId: number,
    user: { id?: number; username?: string; role?: string }
  ): Promise<{ success: boolean; message: string }> {
    const [doc] = await orm.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0)));
    if (!doc) {
      throw new NotFoundError(`سند خرید با شناسه ${documentId} یافت نشد.`);
    }

    if (doc.status === 'final') {
      return {
        success: true,
        message: `سند خرید شماره ${doc.refNumber} قبلاً به انبار تحویل و نهایی شده است.`
      };
    }
    assertProcurementIncomingDocument(doc);

    // v8.0.4 (TD-257): سفارشی که تاریخش پیش از آخرین گردش کالاست فقط با مجوز همین کاربر به انبار تحویل می‌شود
    const allowBackdate = await userHasRoleOrPermission(user, BACKDATE_PERMISSION);
    const reqCode = doc.notes?.match(/\[تدارکات:\s*درخواست\s+([^\]]+)\]/)?.[1]?.trim() ?? null;

    // v8.0.36 (TD-290): نهایی‌سازی سند و به‌روزرسانی مقدار دریافتی درخواست خرید در یک تراکنش و زیر قفل ردیف درخواست.
    // پیش‌تر درخواست پس از نهایی‌سازی، بیرون از تراکنش و بی‌قفل خوانده و نوشته می‌شد؛ تحویلِ هم‌زمانِ سفارشی دیگر از همان
    // درخواست مقدار دریافتیِ دیگری را بازنویسی می‌کرد. مقدار هر کالا هم جمع همه سطرهای فعال سند است، نه فقط سطر اول.
    // قفل درخواست پیش از نهایی‌سازی گرفته و وضعیت سند زیر همان قفل دوباره خوانده می‌شود، تا تحویل دوباره همین سفارش (که
    // نهایی‌سازی‌اش بی‌صدا رد می‌شود) مقدار دریافتی را دو بار نشمارد.
    const delivery = await orm.transaction(async (tx) => {
      const linkedReqId = await ProcurementService.findDeliveredOrderRequisitionId(tx, reqCode, documentId);
      const [lockedReq] = linkedReqId === null ? [] : await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, linkedReqId), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      const [current] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, documentId));
      if (current?.status === 'final') return { linkedReq: null, allDelivered: false };

      await DocumentService.finalizeDocument(documentId, user.username || 'کارشناس تدارکات', tx, { allowBackdate });
      if (!lockedReq) return null;

      const docLines = await tx.select({ itemId: documentItems.itemId, quantity: documentItems.quantity }).from(documentItems)
        .where(and(eq(documentItems.documentId, documentId), eq(documentItems.isDeleted, 0)));
      const updatedReqItems = applyDeliveredLines((lockedReq.items || []) as RequisitionItemWithReceipt[], docLines);

      // v9.0.268 (TD-690، B10-03): درخواست فقط وقتی «دریافت‌شده» است که هیچ سفارش زنده‌اش نهایی‌نشده نمانده و هر ردیف
      // دریافت یا بسته شده است. پیش‌تر فقط سندهای موجود درخواست سنجیده می‌شد: تحویل تنها سفارشِ درخواستی که بخشی‌اش
      // سفارش شده بود، درخواست را «دریافت‌شده» می‌کرد و ردیف‌های مانده دیگر سفارش داده نمی‌شدند
      const openOrders = (await requisitionOrderDocuments(tx, { code: lockedReq.code, items: updatedReqItems }))
        .filter(order => order.id !== documentId && order.status !== 'final');
      const allDelivered = openOrders.length === 0 && updatedReqItems.every(isSettledRequisitionRow);

      await tx.update(purchaseRequisitions).set({
        items: updatedReqItems,
        status: allDelivered ? 'received' : lockedReq.status,
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, lockedReq.id));

      return { linkedReq: lockedReq, allDelivered };
    });
    const linkedReq = delivery?.linkedReq ?? null;
    const allDelivered = delivery?.allDelivered ?? false;

    if (linkedReq && allDelivered && linkedReq.workflowInstanceId) {
      const [wfInst] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, linkedReq.workflowInstanceId));
      if (wfInst && wfInst.status === 'IN_PROGRESS') {
        const { states, transitions } = await this.workflowGraphOf(wfInst);
        const receivedState = states.find(s => s.stateKey === 'received');
        const trToReceived = transitions.find(t => t.fromStateId === wfInst.currentStateId && t.toStateId === receivedState?.id);

        if (trToReceived) {
          try {
            await WorkflowTransitionExecutor.executeTransition({
              instanceId: wfInst.id,
              transitionId: trToReceived.id,
              // v9.0.2 (TD-415): بی شناسه کاربر، انتقال به نام کاربر ۱ ثبت نمی‌شود
              userId: user.id,
              userName: user.username || 'انباردار تحویل‌گیرنده',
              comment: `تحویل و ورود خودکار اقلام به انبار با فاکتور خرید ${doc.refNumber}`
            });
          } catch (trErr) {
            logger.warn({ message: `[Procurement] Error executing workflow transition on delivery: ${errorMessageOf(trErr)}` });
            if (receivedState) {
              await orm.update(workflowInstances).set({
                currentStateId: receivedState.id,
                status: 'COMPLETED',
                updatedAt: new Date().toISOString()
              }).where(eq(workflowInstances.id, linkedReq.workflowInstanceId));
              await orm.delete(workflowPendingApprovals).where(eq(workflowPendingApprovals.instanceId, linkedReq.workflowInstanceId));
              await orm.update(workflowTasks)
                .set({ status: 'completed', completedAt: new Date().toISOString() })
                .where(and(eq(workflowTasks.instanceId, linkedReq.workflowInstanceId), eq(workflowTasks.status, 'pending')));
            }
          }
        } else if (receivedState) {
          await orm.update(workflowInstances).set({
            currentStateId: receivedState.id,
            status: 'COMPLETED',
            updatedAt: new Date().toISOString()
          }).where(eq(workflowInstances.id, linkedReq.workflowInstanceId));
          await orm.delete(workflowPendingApprovals).where(eq(workflowPendingApprovals.instanceId, linkedReq.workflowInstanceId));
          await orm.update(workflowTasks)
            .set({ status: 'completed', completedAt: new Date().toISOString() })
            .where(and(eq(workflowTasks.instanceId, linkedReq.workflowInstanceId), eq(workflowTasks.status, 'pending')));
        }
      }
    }

    await logActivity({
      userId: user.id,
      username: user.username || 'سیستم تدارکات',
      action: 'UPDATE',
      entity: 'document',
      description: `تحویل فاکتور خرید ${doc.refNumber} به انبار و صدور رسید قطعی`,
      details: {
        operation: 'DELIVER_PROCUREMENT_ORDER',
        documentId,
        refNumber: doc.refNumber,
        supplierName: doc.buyerName,
        linkedRequisitionCode: reqCode || linkedReq?.code
      }
    });

    return {
      success: true,
      message: `فاکتور خرید شماره ${doc.refNumber} (${doc.buyerName || 'تامین‌کننده'}) با موفقیت به انبار تحویل داده شد، موجودی کاردکس افزایش یافت و سند رسید قطعی انبار صادر گردید.`
    };
  }

  /**
   * Get Procurement Desk Inbox Summary stats
   */
  static async getInboxSummary(): Promise<{
    totalRequisitions: number;
    pendingCount: number;
    underReviewCount: number;
    managerApprovalCount: number;
    orderedCount: number;
    receivedCount: number;
    urgentCount: number;
    pendingDeliveryOrdersCount: number;
    deliveredOrdersCount: number;
    totalOrdersCount: number;
  }> {
    const rows = await orm.select({
      status: purchaseRequisitions.status,
      priority: purchaseRequisitions.priority
    }).from(purchaseRequisitions).where(eq(purchaseRequisitions.isDeleted, 0));

    let pendingCount = 0;
    let underReviewCount = 0;
    let managerApprovalCount = 0;
    let orderedCount = 0;
    let receivedCount = 0;
    let urgentCount = 0;

    for (const r of rows) {
      if (r.status === 'pending') pendingCount++;
      else if (r.status === 'under_review') underReviewCount++;
      else if (r.status === 'manager_approval') managerApprovalCount++;
      else if (r.status === 'ordered') orderedCount++;
      else if (r.status === 'received') receivedCount++;

      if (r.priority === 'urgent' && r.status !== 'received' && r.status !== 'rejected') {
        urgentCount++;
      }
    }

    // Also count purchase orders in pipeline
    const procurementDocs = await orm.select({
      id: documents.id,
      status: documents.status
    }).from(documents).where(and(
      eq(documents.isDeleted, 0),
      or(
        eq(documents.type, 'receipt'),
        eq(documents.type, 'proforma'),
        ilike(documents.notes, '%[تدارکات:%')
      )
    ));

    let pendingDeliveryOrdersCount = 0;
    let deliveredOrdersCount = 0;

    for (const d of procurementDocs) {
      if (d.status === 'final') {
        deliveredOrdersCount++;
      } else {
        pendingDeliveryOrdersCount++;
      }
    }

    return {
      totalRequisitions: rows.length,
      pendingCount,
      underReviewCount,
      managerApprovalCount,
      orderedCount,
      receivedCount,
      urgentCount,
      pendingDeliveryOrdersCount,
      deliveredOrdersCount,
      totalOrdersCount: procurementDocs.length
    };
  }
}
