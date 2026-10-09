import { terminateOpenWorkflows } from './workflow/workflowTermination.js';
import { eq, and } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { purchaseRequisitions, documentRefCounters, documents, documentItems, workflowInstances } from '../db/schema.js';
import { businessFiscalYear, businessTodayIsoDate } from '../lib/businessClock.js';
import { requireStorageDate } from '../lib/storageDate.js';
import { logActivity } from '../lib/auditLogger.js';
import { documentAuditDetails } from './documents/documentAudit.js';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../errors/customErrors.js';
import { WorkflowTransitionExecutor } from './workflow/workflowTransitionExecutor.js';
import { hasWorkflowTransitionAction } from './workflow/workflowTransitionActions.js';
import { DocumentService } from './document.service.js';
import { userHasRoleOrPermission } from '../middleware/authorize.js';
import { BACKDATE_PERMISSION } from './inventory/stockMovementDate.js';

/** v9.0.315 (TD-689): مجوزهایی که درخواست خرید را تأیید می‌کنند (همان گارد مسیر اقدام گردش‌کار) */
const REQUISITION_APPROVE_PERMISSIONS = ['procurement.approve', 'procurement.manage'];
/** v8.0.71 (TD-326): درخواست ردشده دریافت یا سفارش داده نمی‌شود، مگر پس از بازگشایی */
const CLOSED_REQUISITION_STATUSES = new Set(['rejected', 'cancelled']);
import type { PurchaseRequisition, ProcurementOrder } from '../types.js';
import { applyDeliveredLines, isSettledRequisitionRow, type RequisitionItemWithReceipt } from './procurement/requisitionReceipt.js';
import { assertMayReceiveIntoStock, assertProcurementIncomingDocument, RECEIVED_REQUISITION_STATUSES, requisitionOrderDocuments } from './procurement/requisitionReceiveAction.js';
import { describeOverOrders, findOverOrders } from './procurement/requisitionOrder.js';
import { money } from '../lib/money.js';
import { canEditRequisition, REQUISITION_PRIORITIES, requisitionActionLabel, type RequisitionPriority } from '../lib/procurement/requisitionFields.js';
import {
  ensureRequisitionApproved, RECEIVE_ACTION_KEYS, RECEIVED_STEP_KEY, requisitionFlow, requisitionWorkflowGraph, transitionFromStep,
  type RequisitionActor, type WorkflowStateRef, type WorkflowTransitionRef,
} from './procurement/requisitionApproval.js';
import { buildRequisitionRows, resolveRequisitionProject, type RequisitionRowFields } from './procurement/requisitionRows.js';
import { listProcurementOrders, procurementOrderCounts, type ProcurementOrderListParams } from './procurement/procurementOrderList.js';
import { listRequisitions, requisitionDtos, toRequisitionDto, type GetRequisitionsFilter } from './procurement/requisitionList.js';

export type { GetRequisitionsFilter };
import {
  assertRequisitionNotConsolidated, closeConsolidationSources, consolidationHeader, lockConsolidationSources,
  mergeConsolidationRows,
} from './procurement/requisitionConsolidation.js';
import { actorDisplayName } from '../lib/auth/actorDisplayName.js';

type DbClient = DbExecutor;


/** ردیف درخواست خرید پس از تحویل انبار (receivedQty در ردیف JSONB نوشته می‌شود) */

/** سند خرید صادرشده از درخواست: ردیف documents، یا شناسه و شماره وقتی ردیف خوانده نشد */
type CreatedProcurementDocument = typeof documents.$inferSelect | { id: number; refNumber: string };

/** v9.0.314 (TD-688): بدنه ثبت درخواست خرید (قرارداد `createRequisitionSchema`) */
export interface CreateRequisitionInput {
  title: string;
  projectId?: number | null;
  priority?: RequisitionPriority;
  requiredDate?: string;
  notes?: string;
  items: RequisitionRowFields[];
}

/** v9.0.319 (TD-696): بدنه ویرایش درخواست خرید (قرارداد `updateRequisitionSchema`)؛ فیلدی که نیامده بی تغییر می‌ماند */
export interface UpdateRequisitionInput {
  title?: string;
  projectId?: number | null;
  priority?: RequisitionPriority;
  requiredDate?: string;
  notes?: string;
  items?: RequisitionRowFields[];
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
    user: { id?: number; username?: string; fullName?: string; role?: string }
  ): Promise<PurchaseRequisition> {
    return orm.transaction(async (tx) => toRequisitionDto(await this.insertRequisition(tx, input, user)));
  }

  /**
   * ثبت یک درخواست خرید درون تراکنش فراخواننده، با آغاز گردش کار و ردیف ممیزی؛ ثبت از فرم‌ها و تجمیع (v9.0.349، TD-694)
   * هر دو از این‌جا می‌گذرند. `auditDetails` به جزئیات ردیف ممیزی افزوده می‌شود.
   */
  static async insertRequisition(
    tx: DbClient,
    input: CreateRequisitionInput,
    user: { id?: number; username?: string; fullName?: string; role?: string },
    auditDetails: Record<string, unknown> = {},
  ): Promise<typeof purchaseRequisitions.$inferSelect> {
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

    // v9.0.314 (TD-688): ردیف‌ها و پروژه با یک قاعده برای ثبت و ویرایش؛ مقدار جمع برآورد با FinancialDecimal (AGENTS §1.8)
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
      requestedByName: actorDisplayName(user),
      notes: input.notes || '',
      totalEstimatedAmount: money(totalEst),
      items: sanitizedItems,
      isDeleted: 0
    }).returning();

    // v10.0.45 (TD-940، P5-P13 / OBS-R2-34): گردش کار درخواست در همین تراکنش آغاز می‌شود و خطای آغاز (فرایند غیرفعال یا
    // طرح ناسالم) ثبت درخواست را رد می‌کند، همان قاعده TD-451. پیش‌تر خطا فقط در گزارش کارساز می‌آمد و درخواست بی گردش کار
    // ساخته می‌شد: در کارتابل هیچ تأییدکننده‌ای نمی‌آمد و فقط هنگام سفارش یا تحویل گردش کار می‌گرفت.
    const wfInstance = await WorkflowTransitionExecutor.startInstance({
      workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
      entityType: 'purchase_requisition',
      entityId: String(inserted.id),
      userId: user.id,
      userName: user.username,
      tx,
    });
    await tx.update(purchaseRequisitions)
      .set({ workflowInstanceId: wfInstance.id })
      .where(eq(purchaseRequisitions.id, inserted.id));
    inserted.workflowInstanceId = wfInstance.id;

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
        totalEstimatedAmount: totalEst.toNumber(),
        ...auditDetails
      }
    });

    return inserted;
  }

  /**
   * List purchase requisitions with filtering and pagination (v9.0.353, TD-697: status groups, item search and order
   * counts in SQL, the page and limit actually used)
   */
  static async getRequisitions(filter: GetRequisitionsFilter = {}): Promise<{ data: PurchaseRequisition[]; total: number; page: number; limit: number }> {
    return listRequisitions(filter);
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

    const [dto] = await requisitionDtos(orm, [req]);
    return dto;
  }

  /**
   * Update requisition items, assignments, or estimates
   *
   * v9.0.319 (TD-696، B10-09): ویرایش فقط پیش از تأیید (یا پس از رد) و برای درخواستی که هیچ ردیفش سفارش نشده، در یک
   * تراکنش و زیر قفل ردیف درخواست؛ وگرنه ۴۰۹ `REQUISITION_NOT_EDITABLE`. ردیف‌ها با همان قرارداد ثبت ساخته می‌شوند
   * (`buildRequisitionRows`) و شناسه ردیف ذخیره‌شده نگه داشته می‌شود؛ ممیزی پیش و پس از ویرایش با همان `tx`. پیش‌تر
   * ویرایش در هر وضعیتی، بی تراکنش، مقدار درخواستی، سفارش‌شده و دریافتی را صفر و پیوند سفارش‌ها را پاک می‌کرد.
   */
  static async updateRequisition(
    id: number,
    updates: UpdateRequisitionInput,
    user: { id?: number; username?: string }
  ): Promise<PurchaseRequisition> {
    if (updates.priority !== undefined && !(REQUISITION_PRIORITIES as readonly string[]).includes(updates.priority)) {
      throw new ValidationError('اولویت درخواست خرید یکی از «فوری»، «بالا»، «عادی» یا «پایین» است.');
    }
    if (updates.title !== undefined && !updates.title.trim()) {
      throw new ValidationError('عنوان درخواست خرید را وارد کنید.');
    }
    return orm.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      if (!locked) throw new NotFoundError(`درخواست خرید با شناسه #${id} یافت نشد.`);
      assertRequisitionNotConsolidated(locked);
      const existing = toRequisitionDto(locked);
      const liveOrders = await requisitionOrderDocuments(tx, { id: locked.id, items: locked.items as RequisitionItemWithReceipt[] });
      if (!canEditRequisition(existing) || liveOrders.length > 0) {
        throw new ConflictError(
          `درخواست خرید ${existing.code} پس از تأیید یا صدور سفارش ویرایش نمی‌شود؛ برای تغییر، درخواست را رد و دوباره باز کنید.`,
          { status: existing.status }, 'REQUISITION_NOT_EDITABLE',
        );
      }

      const storedRowIds = new Set((Array.isArray(existing.items) ? existing.items : []).map(row => String(row.id ?? '')).filter(Boolean));
      const rebuilt = updates.items === undefined ? null : await buildRequisitionRows(tx, updates.items, storedRowIds);
      const project = updates.projectId === undefined ? null : await resolveRequisitionProject(tx, updates.projectId);

      const [updated] = await tx.update(purchaseRequisitions).set({
        title: updates.title !== undefined ? updates.title.trim() : existing.title,
        priority: updates.priority ?? existing.priority,
        requiredDate: (updates.requiredDate ? requireStorageDate(updates.requiredDate, 'تاریخ نیاز') : '') || existing.requiredDate,
        notes: updates.notes !== undefined ? updates.notes : existing.notes,
        ...(project ? { projectId: project.projectId, projectCode: project.projectCode, projectName: project.projectName } : {}),
        ...(rebuilt ? { items: rebuilt.rows, totalEstimatedAmount: money(rebuilt.total) } : {}),
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, id)).returning();
      const after = toRequisitionDto(updated);

      const snapshot = (r: PurchaseRequisition) => ({
        title: r.title, priority: r.priority, requiredDate: r.requiredDate, notes: r.notes, projectId: r.projectId ?? null,
        totalEstimatedAmount: r.totalEstimatedAmount, items: r.items,
      });
      await logActivity({
        tx,
        userId: user.id,
        username: user.username || 'سیستم',
        action: 'UPDATE',
        entity: 'درخواست خرید',
        entityId: id,
        description: `ویرایش درخواست خرید ${updated.code}`,
        details: { code: updated.code, before: snapshot(existing), after: snapshot(after) }
      });

      return after;
    });
  }

  /**
   * Delete requisition (soft delete)
   */
  static async deleteRequisition(id: number, user: { id?: number; username?: string }): Promise<void> {
    // v9.0.40 (TD-447، ت۵): حذف و بستن فرایند در جریان درخواست در یک تراکنش، زیر قفل ردیف درخواست (وضعیت زیر قفل دوباره خوانده می‌شود)
    await orm.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      if (!locked) throw new NotFoundError('درخواست خرید یافت نشد.');
      assertRequisitionNotConsolidated(locked);
      // v9.0.318 (TD-695، B10-08): درخواستی که سند سفارش زنده دارد حذف نمی‌شود. پیش‌تر فقط وضعیت «سفارش‌شده» و
      // «دریافت‌شده» رد می‌شد: درخواستِ بخشی‌سفارش‌شده یا لغوشده حذف می‌شد و سفارشش بی درخواست تحویل می‌شد
      const liveOrders = await requisitionOrderDocuments(tx, { id: locked.id, items: locked.items as RequisitionItemWithReceipt[] });
      if (liveOrders.length > 0) {
        throw new ConflictError(
          `درخواست خرید ${locked.code} سفارش خرید ثبت‌شده دارد (${liveOrders.map(o => o.refNumber || String(o.id)).join('، ')}) و حذف نمی‌شود؛ ابتدا سفارش‌ها را باطل کنید.`,
          { documentIds: liveOrders.map(o => o.id) }, 'REQUISITION_HAS_ORDERS',
        );
      }
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
        description: `حذف درخواست خرید ${locked.code}`,
        details: { code: locked.code, title: locked.title, before: toRequisitionDto(locked) },
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
      // v9.0.349 (TD-694): گردش کار درخواستِ تجمیع‌شده خاتمه یافته است و نمونه تازه‌ای برایش ساخته نمی‌شود
      assertRequisitionNotConsolidated(req);
      if (isReceive && RECEIVED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} قبلاً دریافت شده است و کالای آن دوباره وارد انبار نمی‌شود.`);
      }
      // v8.0.124 (TD-405): کالای درخواستِ دریافت‌شده وارد انبار شده است؛ هیچ اقدام گردش‌کاری آن را برنمی‌گرداند، هر گامی
      // که نمونه گردش‌کار داشته باشد (پیش‌تر «خودترمیمی» گام را به «دریافت‌شده» می‌برد و همین جلوی اقدام را می‌گرفت)
      if (RECEIVED_REQUISITION_STATUSES.has(req.status)) {
        throw new ConflictError(`درخواست خرید ${req.code} دریافت شده است و اقدام «${requisitionActionLabel(actionKey)}» روی آن اجرا نمی‌شود.`, undefined, 'WF_ACTION_NOT_IN_STEP');
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
        // v9.0.355 (TD-901): نام اقدام و گام، نه کلید یا وضعیت انگلیسی آن‌ها
        const stepTitle = states.find(s => s.id === wfInst.currentStateId)?.title;
        const actionTitle = requisitionActionLabel(actionKey, transitions.find(t => t.actionKey === actionKey)?.title);
        throw new ConflictError(
          `اقدام «${actionTitle}» در گام فعلی درخواست خرید ${req.code}${stepTitle ? ` («${stepTitle}»)` : ''} مجاز نیست.`,
          undefined, 'WF_ACTION_NOT_IN_STEP',
        );
      }
      const transitionTitle = requisitionActionLabel(actionKey, matchedTransition.title);
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
    const username = actorDisplayName(user, 'کارشناس تدارکات');
    const today = await businessTodayIsoDate();
    // v9.0.315 (TD-689، ت۱): حق تأیید پیش از تراکنش سنجیده می‌شود (TD-324: بی اتصال دوم درون تراکنش)
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
      assertRequisitionNotConsolidated(req);
      // v9.0.315 (TD-689، ت۱): سفارش فقط از گام «تأییدشده»؛ دارنده حق تأیید نخست تأیید را به نام خودش اجرا می‌کند
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
          // v9.0.336 (TD-778، O25 بسته ۱۰): سفارش به تأمین‌کننده انتخاب‌شده با شناسه وصل می‌شود؛ بی شناسه با نام یکتا
          partyId: group.supplierId ?? undefined,
          buyer_name: supplierName,
          notes: docNotes,
          location: warehouseLoc,
          inOut: 'in',
          currency: 'IRR',
          user: username,
          items: docLines,
          externalTx: tx
        });

        // v9.0.347 (TD-691، ت۲): پیوند سفارش به درخواست در ستون؛ فهرست، خلاصه و تحویل تدارکات فقط همین سندها را می‌بینند
        await tx.update(documents).set({ procurementRequisitionId: req.id }).where(eq(documents.id, createdDocId));
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
        // v9.0.316 (TD-690): ردیف بسته‌شده نشان `closed` می‌گیرد؛ دیگر سفارش داده و بی سفارش دریافت نمی‌شود
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

      // v9.0.315 (TD-689): وضعیت درخواست فقط از گام گردش‌کار می‌آید (applyRequisitionTransition)؛ تبدیل گام را جابه‌جا
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
   * Consolidate unapproved requisitions without orders into one new requisition; the sources are closed (TD-694)
   */
  static async consolidateRequisitions(
    requisitionIds: number[],
    newTitle: string | undefined,
    user: { id?: number; username?: string; fullName?: string }
  ): Promise<PurchaseRequisition> {
    // v9.0.349 (TD-694، B10-07، ت۳ الف): قفل منبع‌ها به ترتیب شناسه، ساخت درخواست تجمیعی و بستن منبع‌ها با پیوند و خاتمه
    // گردش کار، همه در یک تراکنش. پیش‌تر تجمیع بی تراکنش و قفل بود، منبع‌ها (حتی دریافت‌شده) باز می‌ماندند و شناسه
    // ناموجود بی‌صدا کنار گذاشته می‌شد.
    return orm.transaction(async (tx) => {
      const sources = await lockConsolidationSources(tx, requisitionIds);
      const codes = sources.map(r => r.code).join('، ');
      const header = consolidationHeader(sources);
      const inserted = await this.insertRequisition(tx, {
        title: newTitle?.trim() || `تجمیع درخواست‌های خرید (${codes})`,
        projectId: header.projectId,
        priority: header.priority,
        requiredDate: header.requiredDate,
        notes: `تجمیع شده از درخواست‌های: ${codes}`,
        items: mergeConsolidationRows(sources),
      }, user, { consolidatedFrom: sources.map(r => ({ id: r.id, code: r.code })) });
      await closeConsolidationSources(tx, sources, inserted, user);
      return toRequisitionDto(inserted);
    });
  }

  /**
   * سفارش‌های خرید تدارکات (سندهای دارای پیوند درخواست؛ فیلتر و صفحه‌بندی در SQL، v9.0.347، TD-691 / TD-698)
   */
  static async getProcurementOrders(params: ProcurementOrderListParams): Promise<{ data: ProcurementOrder[]; total: number; page: number; limit: number }> {
    return listProcurementOrders(params);
  }

  /**
   * Deliver a specific procurement purchase order to warehouse
   * (finalizes document, increases stock, updates Kardex, and syncs requisition)
   */
  static async deliverOrderToWarehouse(
    documentId: number,
    user: RequisitionActor
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
    // v9.0.347 (TD-691، B10-04، ت۲): فقط سفارشی که «تبدیل به سفارش» برای درخواستی صادر کرده از این مسیر نهایی می‌شود؛
    // پیش‌تر هر رسید پیش‌نویس انبار با مجوز تدارکات نهایی می‌شد (ورود کالا، کاردکس و سند حسابداری) در حالی که نهایی‌سازی
    // سند خود `documents.edit` یا `warehouse.in` می‌خواهد
    const linkedReqId = doc.procurementRequisitionId ?? null;
    if (linkedReqId === null) {
      throw new AppError(
        `سند «${doc.refNumber ?? doc.id}» سفارش تدارکات نیست و از مسیر تحویل تدارکات نهایی نمی‌شود؛ آن را از «ورود و خروج انبار» نهایی کنید.`,
        422, 'PROCUREMENT_ORDER_NOT_LINKED',
      );
    }

    // v9.0.455 (TD-904، ت۳ الف): ورود کالا مجوز ثبت قطعی سند رسید را هم می‌خواهد (گارد مسیر فقط مجوز تدارکات را می‌سنجد)
    await assertMayReceiveIntoStock(user, String(doc.refNumber ?? doc.id));
    // v8.0.4 (TD-257): سفارشی که تاریخش پیش از آخرین گردش کالاست فقط با مجوز همین کاربر به انبار تحویل می‌شود
    const allowBackdate = await userHasRoleOrPermission(user, BACKDATE_PERMISSION);
    // v9.0.317 (TD-692): حق تأیید پیش از تراکنش سنجیده می‌شود (TD-324)
    const mayApprove = await userHasRoleOrPermission(user, ...REQUISITION_APPROVE_PERMISSIONS);

    // v8.0.36 (TD-290): نهایی‌سازی سند و به‌روزرسانی مقدار دریافتی درخواست خرید در یک تراکنش و زیر قفل ردیف درخواست.
    // پیش‌تر درخواست پس از نهایی‌سازی، بیرون از تراکنش و بی‌قفل خوانده و نوشته می‌شد؛ تحویلِ هم‌زمانِ سفارشی دیگر از همان
    // درخواست مقدار دریافتیِ دیگری را بازنویسی می‌کرد. مقدار هر کالا هم جمع همه سطرهای فعال سند است، نه فقط سطر اول.
    // قفل درخواست پیش از نهایی‌سازی گرفته و وضعیت سند زیر همان قفل دوباره خوانده می‌شود، تا تحویل دوباره همین سفارش (که
    // نهایی‌سازی‌اش بی‌صدا رد می‌شود) مقدار دریافتی را دو بار نشمارد.
    //
    // v9.0.317 (TD-692، B10-05): انتقال «دریافت کالا» در همین تراکنش و با نقش و مجوز تحویل‌دهنده اجرا می‌شود و شکستش کل
    // تحویل را برمی‌گرداند؛ سفارش درخواستِ تأییدنشده تحویل نمی‌شود (ت۱). پیش‌تر انتقال پس از commit، بی نقش و مجوز اجرا
    // می‌شد و شکستش با نوشتن مستقیم `workflow_instances` (COMPLETED)، حذف `workflow_pending_approvals` و بستن
    // `workflow_tasks` دور زده می‌شد (A02-03، A02-04، A02-08).
    await orm.transaction(async (tx) => {
      const [lockedReq] = await tx.select().from(purchaseRequisitions)
        .where(and(eq(purchaseRequisitions.id, linkedReqId), eq(purchaseRequisitions.isDeleted, 0)))
        .for('update');
      const [current] = await tx.select({ status: documents.status }).from(documents).where(eq(documents.id, documentId));
      if (current?.status === 'final') return;
      if (!lockedReq) {
        throw new ConflictError(
          `درخواست خرید سفارش «${doc.refNumber ?? doc.id}» حذف شده است؛ سفارش را از «ورود و خروج انبار» نهایی کنید.`,
          undefined, 'PROCUREMENT_REQUISITION_DELETED',
        );
      }

      const alreadyReceived = RECEIVED_REQUISITION_STATUSES.has(lockedReq.status);
      if (!alreadyReceived) {
        if (CLOSED_REQUISITION_STATUSES.has(lockedReq.status)) {
          throw new ConflictError(`درخواست خرید ${lockedReq.code} رد شده است و سفارش آن به انبار تحویل نمی‌شود؛ ابتدا درخواست را بازگشایی کنید.`, undefined, 'REQUISITION_NOT_APPROVED');
        }
        await ensureRequisitionApproved(tx, lockedReq, user, {
          mayApprove,
          comment: `تأیید هنگام تحویل سفارش خرید ${doc.refNumber}`,
          allowBackdate,
          snapshotData: { id: lockedReq.id, code: lockedReq.code, priority: lockedReq.priority, status: lockedReq.status },
        });
      }

      const finalized = await DocumentService.finalizeDocument(documentId, user.username || 'کارشناس تدارکات', tx, { allowBackdate });

      const docLines = await tx.select({ itemId: documentItems.itemId, quantity: documentItems.quantity }).from(documentItems)
        .where(and(eq(documentItems.documentId, documentId), eq(documentItems.isDeleted, 0)));
      const updatedReqItems = applyDeliveredLines((lockedReq.items || []) as RequisitionItemWithReceipt[], docLines);
      await tx.update(purchaseRequisitions).set({
        items: updatedReqItems,
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, lockedReq.id));

      // v9.0.316 (TD-690، B10-03): درخواست فقط وقتی «دریافت‌شده» است که هیچ سفارش زنده‌اش نهایی‌نشده نمانده و هر ردیف
      // دریافت یا بسته شده است. پیش‌تر فقط سندهای موجود درخواست سنجیده می‌شد: تحویل تنها سفارشِ درخواستی که بخشی‌اش
      // سفارش شده بود، درخواست را «دریافت‌شده» می‌کرد و ردیف‌های مانده دیگر سفارش داده نمی‌شدند
      const openOrders = (await requisitionOrderDocuments(tx, { id: lockedReq.id, items: updatedReqItems }))
        .filter(order => order.status !== 'final');
      if (!alreadyReceived && openOrders.length === 0 && updatedReqItems.every(isSettledRequisitionRow)) {
        // وضعیت «دریافت‌شده» را اقدام پس از انتقال (applyRequisitionTransition) در همین تراکنش می‌نویسد
        const flow = await requisitionFlow(tx, lockedReq, user);
        const receive = transitionFromStep(flow, RECEIVE_ACTION_KEYS, RECEIVED_STEP_KEY);
        if (!receive) {
          throw new ConflictError(
            `گردش کار درخواست خرید ${lockedReq.code} از گام «${flow.stepTitle || flow.stepKey}» اقدامی به «دریافت‌شده» ندارد؛ طرح گردش کار را بررسی کنید.`,
            undefined, 'WF_ACTION_NOT_IN_STEP',
          );
        }
        await WorkflowTransitionExecutor.executeTransition({
          instanceId: flow.instance.id,
          transitionId: receive.id,
          userId: user.id,
          userName: user.username,
          userRole: user.role,
          userPermissions: user.permissions || [],
          comment: `تحویل و ورود کالا به انبار با سفارش خرید ${doc.refNumber}`,
          snapshotData: { id: lockedReq.id, code: lockedReq.code, priority: lockedReq.priority, status: lockedReq.status },
          allowBackdate,
          tx,
        });
      }

      // v9.0.458 (TD-917، یافته P5-P10): یک ردیف ممیزی نهایی‌سازی برای سفارش، با شناسه سند و سند ذخیره‌شده پیش و پس از
      // نهایی‌سازی (همان ردیف `PUT /documents/:id/finalize`، TD-785) و جزئیات تحویل. پیش‌تر ردیف `document` بی شناسه سند و
      // بی پیش و پس بود و خط زمانی سند آن را نمی‌دید.
      await logActivity({
        tx,
        userId: user.id,
        username: user.username || 'سیستم تدارکات',
        action: 'UPDATE',
        entity: 'اسناد انبار',
        entityId: documentId,
        description: `تحویل سفارش خرید ${doc.refNumber} به انبار و نهایی‌سازی رسید (درخواست خرید ${lockedReq.code})`,
        details: {
          ...(finalized ? documentAuditDetails(finalized.before, finalized.after) : {}),
          operation: 'DELIVER_PROCUREMENT_ORDER',
          documentId,
          refNumber: doc.refNumber,
          supplierName: doc.buyerName,
          linkedRequisitionCode: lockedReq.code
        }
      });
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

      // v9.0.349 (TD-694): درخواستِ تجمیع‌شده بسته است و فوری شمرده نمی‌شود
      if (r.priority === 'urgent' && r.status !== 'received' && r.status !== 'rejected' && r.status !== 'consolidated') {
        urgentCount++;
      }
    }

    // v9.0.347 (TD-691): فقط سفارش‌های دارای پیوند درخواست؛ پیش‌تر هر رسید و پیش‌فاکتور فروش هم شمرده می‌شد
    const orders = await procurementOrderCounts();

    return {
      totalRequisitions: rows.length,
      pendingCount,
      underReviewCount,
      managerApprovalCount,
      orderedCount,
      receivedCount,
      urgentCount,
      pendingDeliveryOrdersCount: orders.pendingDelivery,
      deliveredOrdersCount: orders.delivered,
      totalOrdersCount: orders.total
    };
  }
}
