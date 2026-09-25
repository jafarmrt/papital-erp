import { sql, eq, and, desc, inArray, or, ilike } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { purchaseRequisitions, productionProjects, documentRefCounters, items, documents, documentItems, workflowInstances, workflowStates, workflowTransitions, workflowPendingApprovals, workflowTasks } from '../db/schema.js';
import { resolveJalaliFiscalYear, businessTodayIsoDate } from '../lib/businessClock.js';
import { getTodayJalaliDate } from '../utils.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { ValidationError, NotFoundError } from '../errors/customErrors.js';
import { WorkflowTransitionExecutor } from './workflow/workflowTransitionExecutor.js';
import { DocumentService } from './document.service.js';
import type { PurchaseRequisition, PurchaseRequisitionItemRow, ProcurementOrder } from '../types.js';

type DbClient = DbExecutor;

export interface CreateRequisitionInput {
  title: string;
  projectId?: number | null;
  projectCode?: string;
  projectName?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  requiredDate?: string;
  notes?: string;
  items: PurchaseRequisitionItemRow[];
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
}

export class ProcurementService {
  /**
   * Atomic sequential code generation for Purchase Requisitions (e.g. PR-1405-0001)
   */
  static async generateRequisitionCode(tx: DbClient = orm): Promise<string> {
    const fiscalYear = resolveJalaliFiscalYear();
    const docType = 'PR';

    // Atomic upsert into documentRefCounters
    const updated = await tx
      .insert(documentRefCounters)
      .values({ docType, fiscalYear, lastRefNumber: 1 })
      .onConflictDoUpdate({
        target: [documentRefCounters.docType, documentRefCounters.fiscalYear],
        set: { lastRefNumber: sql`${documentRefCounters.lastRefNumber} + 1` }
      })
      .returning({ lastRefNumber: documentRefCounters.lastRefNumber });

    const seq = updated[0]?.lastRefNumber || 1;
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

    // Sanitize and calculate totals
    let totalEst = 0;
    const sanitizedItems: PurchaseRequisitionItemRow[] = input.items.map((item, idx) => {
      const qty = Number(item.requestedQty || item.requested_qty || 0);
      const price = Number(item.unitPriceEstimate || item.unit_price_estimate || 0);
      totalEst += (qty * price);
      return {
        id: item.id || `item-${Date.now()}-${idx}`,
        itemId: item.itemId ?? item.item_id ?? null,
        itemCode: item.itemCode || item.item_code || '',
        itemName: item.itemName || item.item_name || 'کالای سفارشی',
        category: item.category || '',
        unit: item.unit || 'عدد',
        requestedQty: qty,
        orderedQty: 0,
        remainingQty: qty,
        unitPriceEstimate: price,
        targetSupplierId: item.targetSupplierId ?? item.target_supplier_id ?? null,
        targetSupplierName: item.targetSupplierName || item.target_supplier_name || '',
        status: 'pending',
        linkedDocumentIds: [],
        notes: item.notes || ''
      };
    });

    let projectCode = input.projectCode || '';
    let projectName = input.projectName || '';

    if (input.projectId && (!projectCode || !projectName)) {
      const [proj] = await orm.select().from(productionProjects).where(eq(productionProjects.id, input.projectId));
      if (proj) {
        projectCode = proj.projectCode || '';
        projectName = proj.title || '';
      }
    }

    const createdReq = await orm.transaction(async (tx) => {
      const code = await this.generateRequisitionCode(tx);

      const [inserted] = await tx.insert(purchaseRequisitions).values({
        code,
        title: input.title.trim(),
        projectId: input.projectId || null,
        projectCode,
        projectName,
        status: 'pending',
        priority: input.priority || 'normal',
        requiredDate: input.requiredDate || getTodayJalaliDate(),
        requestedById: user.id || null,
        requestedByName: user.username || 'سیستم',
        notes: input.notes || '',
        totalEstimatedAmount: totalEst,
        items: sanitizedItems,
        isDeleted: 0
      }).returning();

      // Start workflow instance if definition exists
      try {
        const wfInstance = await WorkflowTransitionExecutor.startInstance({
          workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
          entityType: 'purchase_requisition',
          entityId: String(inserted.id),
          userId: user.id,
          userName: user.username
        });

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
          totalEstimatedAmount: totalEst
        }
      });

      return inserted as unknown as PurchaseRequisition;
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
      const q = `%${filter.search.trim()}%`;
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
      data: rows as unknown as PurchaseRequisition[],
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

    return req as unknown as PurchaseRequisition;
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
    let newTotalEst = existing.totalEstimatedAmount || 0;

    if (updates.items && Array.isArray(updates.items)) {
      newTotalEst = 0;
      newItems = updates.items.map((item, idx) => {
        const qty = Number(item.requestedQty || item.requested_qty || 0);
        const ordered = Number(item.orderedQty || item.ordered_qty || 0);
        const price = Number(item.unitPriceEstimate || item.unit_price_estimate || 0);
        newTotalEst += (qty * price);
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
      requiredDate: updates.requiredDate || existing.requiredDate,
      notes: updates.notes !== undefined ? updates.notes : existing.notes,
      items: newItems,
      totalEstimatedAmount: newTotalEst,
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
        after: { title: updated.title, itemsCount: newItems.length, totalEstimatedAmount: newTotalEst }
      }
    });

    return updated as unknown as PurchaseRequisition;
  }

  /**
   * Delete requisition (soft delete)
   */
  static async deleteRequisition(id: number, user: { id?: number; username?: string }): Promise<void> {
    const existing = await this.getRequisitionById(id);
    if (existing.status === 'ordered' || existing.status === 'received') {
      throw new ValidationError('درخواست‌های خریدی که سفارش آنها صادر شده یا کالا تحویل شده قابل حذف نیستند.');
    }

    await orm.update(purchaseRequisitions).set({
      isDeleted: 1,
      updatedAt: new Date().toISOString()
    }).where(eq(purchaseRequisitions.id, id));

    await logActivity({
      userId: user.id,
      username: user.username || 'سیستم',
      action: 'DELETE',
      entity: 'درخواست خرید',
      entityId: id,
      description: `حذف درخواست خرید ${existing.code}`,
      details: { code: existing.code, title: existing.title }
    });
  }

  /**
   * Execute workflow transition on purchase requisition
   */
  static async executeWorkflowAction(
    requisitionId: number,
    actionKey: string,
    user: { id?: number; username?: string; role?: string; permissions?: string[] },
    comment?: string
  ): Promise<{ success: boolean; requisition: PurchaseRequisition; message?: string }> {
    const req = await this.getRequisitionById(requisitionId);

    if (!req.workflowInstanceId) {
      // Lazy start workflow instance if not present
      const instance = await WorkflowTransitionExecutor.startInstance({
        workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
        entityType: 'purchase_requisition',
        entityId: String(req.id),
        userId: user.id,
        userName: user.username
      });
      req.workflowInstanceId = instance.id;
      await orm.update(purchaseRequisitions)
        .set({ workflowInstanceId: instance.id })
        .where(eq(purchaseRequisitions.id, req.id));
    }

    const [wfInst] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, req.workflowInstanceId));
    if (!wfInst) {
      throw new ValidationError('نمونه فرآیند گردش کار مرتبط یافت نشد');
    }

    const transitions = ((wfInst.snapshotDsl as any)?.transitions as any[]) || 
      await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, wfInst.workflowDefinitionId));
    const states = ((wfInst.snapshotDsl as any)?.states as any[]) ||
      await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, wfInst.workflowDefinitionId));

    // Auto-heal / synchronize workflow instance state if desynchronized from requisition business status
    const statusToStateKeyMap: Record<string, string> = {
      pending: 'pending',
      under_review: 'pending',
      manager_approval: 'pending',
      ordered: 'ordered',
      approved: 'ordered',
      received: 'received',
      completed: 'received',
      rejected: 'rejected',
      cancelled: 'rejected'
    };
    const expectedStateKey = statusToStateKeyMap[req.status] || 'pending';
    const currentStateObj = states.find((s: any) => s.id === wfInst.currentStateId);

    if (currentStateObj && currentStateObj.stateKey !== expectedStateKey) {
      const correctState = states.find((s: any) => s.stateKey === expectedStateKey);
      if (correctState) {
        await orm.update(workflowInstances).set({
          currentStateId: correctState.id,
          updatedAt: new Date().toISOString()
        }).where(eq(workflowInstances.id, wfInst.id));
        wfInst.currentStateId = correctState.id;
      }
    }

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
      reject_request: ['reject_manager', 'reject_procurement', 'reject', 'cancel'],
      reject_manager: ['reject_manager', 'reject_request', 'reject', 'reject_procurement'],
      reject_procurement: ['reject_procurement', 'reject_manager', 'reject_request', 'reject'],
      reopen: ['reopen']
    };

    const targetActionKeys = ACTION_KEY_ALIASES[actionKey] || [actionKey];

    // Find valid transition from current state only (never pick a transition with mismatched fromStateId)
    let matchedTransition = transitions.find(t => 
      targetActionKeys.includes(t.actionKey) && (!t.fromStateId || t.fromStateId === wfInst.currentStateId)
    );

    // If receiving items while still at pending, auto-advance to ordered state first so receive_items can execute
    if (!matchedTransition && (actionKey === 'mark_received' || actionKey === 'receive_items')) {
      const orderedState = states.find((s: any) => s.stateKey === 'ordered');
      if (orderedState && wfInst.currentStateId !== orderedState.id) {
        await orm.update(workflowInstances).set({
          currentStateId: orderedState.id,
          updatedAt: new Date().toISOString()
        }).where(eq(workflowInstances.id, wfInst.id));
        wfInst.currentStateId = orderedState.id;
        matchedTransition = transitions.find(t => 
          targetActionKeys.includes(t.actionKey) && (!t.fromStateId || t.fromStateId === orderedState.id)
        );
      }
    }

    let mappedStatus = req.status;
    let transitionTitle = actionKey;

    if (matchedTransition) {
      transitionTitle = matchedTransition.title || actionKey;
      const result = await WorkflowTransitionExecutor.executeTransition({
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
        }
      });

      const toStateKey = result.toState?.stateKey;
      if (toStateKey) {
        if (toStateKey === 'draft') mappedStatus = 'pending';
        else if (toStateKey === 'procurement_review') mappedStatus = 'under_review';
        else if (toStateKey === 'manager_approval') mappedStatus = 'manager_approval';
        else if (toStateKey === 'ordered') mappedStatus = 'ordered';
        else if (toStateKey === 'received') mappedStatus = 'received';
        else if (toStateKey === 'rejected') mappedStatus = 'rejected';
      }
    } else {
      // Graceful direct workshop transition fallback
      if (['approve_request', 'approve_order', 'direct_admin_order', 'direct_order'].includes(actionKey)) {
        mappedStatus = 'ordered';
        transitionTitle = 'تایید مستقیم و صدور سفارش خرید';
      } else if (['receive_items', 'mark_received', 'receive'].includes(actionKey)) {
        mappedStatus = 'received';
        transitionTitle = 'تحویل و ورود به انبار';
      } else if (['reject_request', 'reject_manager', 'reject_procurement', 'reject'].includes(actionKey)) {
        mappedStatus = 'rejected';
        transitionTitle = 'رد درخواست خرید';
      } else if (['reopen'].includes(actionKey)) {
        mappedStatus = 'pending';
        transitionTitle = 'بازگشایی مجدد درخواست';
      } else {
        throw new ValidationError(`گذار با شناسه اقدام «${actionKey}» برای وضعیت فعلی درخواست یافت نشد`);
      }
    }

    let updatedItems = req.items;
    if (mappedStatus === 'received') {
      updatedItems = (req.items || []).map(i => ({
        ...i,
        receivedQty: i.requestedQty,
        remainingQty: 0,
        status: 'received'
      }));

      // 1. Finalize all linked draft/proforma purchase documents to increase warehouse stock and write Kardex
      const docIdsToFinalize = new Set<number>();
      for (const it of (req.items || [])) {
        if (Array.isArray(it.linkedDocumentIds)) {
          for (const id of it.linkedDocumentIds) {
            const numId = Number(id);
            if (numId > 0) docIdsToFinalize.add(numId);
          }
        }
      }

      const relatedDocs = await orm.select().from(documents).where(and(
        ilike(documents.notes, `%${req.code}%`),
        eq(documents.isDeleted, 0)
      ));
      for (const rd of relatedDocs) {
        if (rd.status !== 'final') {
          docIdsToFinalize.add(rd.id);
        }
      }

      for (const docId of docIdsToFinalize) {
        try {
          await DocumentService.finalizeDocument(docId, user.username || 'سیستم تدارکات');
        } catch (err: any) {
          logger.warn({ message: `[Procurement] Error finalizing linked document #${docId}: ${err.message}` });
        }
      }

      // 2. For any items never converted to a document, auto-generate a finalized warehouse receipt document
      const unhandledItems = (req.items || []).filter(i => {
        const hasDocs = Array.isArray(i.linkedDocumentIds) && i.linkedDocumentIds.length > 0;
        return !hasDocs && i.itemId && Number(i.requestedQty || 0) > 0;
      });

      if (unhandledItems.length > 0) {
        try {
          const docLines = unhandledItems.map(i => ({
            itemId: i.itemId,
            quantity: Number(i.requestedQty),
            unit_price: Number(i.unitPriceEstimate || 0),
            discount: 0,
            location: ''
          }));

          const newDocId = await DocumentService.createDocument({
            docType: 'receipt',
            date: await businessTodayIsoDate(),
            status: 'final',
            buyer_name: 'تامین‌کننده تدارکات',
            notes: `[تدارکات: تحویل مستقیم به انبار] درخواست ${req.code} ${req.projectName ? `[پروژه: ${req.projectName}]` : ''}`.trim(),
            location: '',
            inOut: 'in',
            currency: 'IRR',
            user: user.username || 'کارشناس تدارکات',
            items: docLines
          });

          // Link newDocId to these items
          updatedItems = updatedItems.map(it => {
            if (unhandledItems.some(u => u.id === it.id)) {
              const prevLinked = Array.isArray(it.linkedDocumentIds) ? it.linkedDocumentIds : [];
              return { ...it, linkedDocumentIds: [...prevLinked, newDocId] };
            }
            return it;
          });
        } catch (err: any) {
          logger.warn({ message: `[Procurement] Error auto-generating receipt document for unhandled items: ${err.message}` });
        }
      }
    }

    const [updatedReq] = await orm.update(purchaseRequisitions)
      .set({
        status: mappedStatus,
        items: updatedItems,
        updatedAt: new Date().toISOString()
      })
      .where(eq(purchaseRequisitions.id, req.id))
      .returning();

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
      requisition: updatedReq as unknown as PurchaseRequisition,
      message: `وضعیت درخواست با موفقیت به «${statusTitleMap[mappedStatus] || mappedStatus}» تغییر یافت.`
    };
  }

  /**
   * Split & Convert Requisition Items into Purchase Documents (Orders/Receipts/Proformas)
   */
  static async convertToPurchaseOrders(
    params: ConvertToOrdersInput,
    user: { id?: number; username?: string; role?: string }
  ): Promise<{ createdDocuments: any[]; requisition: PurchaseRequisition }> {
    const { requisitionId, orderGroups } = params;
    if (!orderGroups || !Array.isArray(orderGroups) || orderGroups.length === 0) {
      throw new ValidationError('حداقل یک گروه سفارش خرید باید تعیین شود.');
    }

    const req = await this.getRequisitionById(requisitionId);
    const createdDocuments: any[] = [];
    const updatedItems = [...req.items];

    for (const group of orderGroups) {
      if (!group.items || group.items.length === 0) continue;

      const supplierName = group.supplierName?.trim() || 'تامین‌کننده تدارکات';
      const docType = group.docType === 'proforma' ? 'proforma' : 'receipt';
      const docStatus = group.status || 'draft';
      const warehouseLoc = group.targetWarehouse || '';

      // Format items for DocumentService
      const docLines = group.items.map(i => ({
        itemId: i.itemId,
        quantity: Number(i.quantity),
        unit_price: Number(i.unitPrice || 0),
        discount: 0,
        location: warehouseLoc
      }));

      const docNotes = `[تدارکات: درخواست ${req.code}] ${req.projectName ? `[پروژه: ${req.projectName}]` : ''} ${group.notes || ''}`.trim();

      const createdDocId = await DocumentService.createDocument({
        docType,
        date: await businessTodayIsoDate(),
        status: docStatus,
        buyer_name: supplierName,
        notes: docNotes,
        location: warehouseLoc,
        inOut: 'in',
        currency: 'IRR',
        user: user.username || 'کارشناس تدارکات',
        items: docLines
      });

      const [createdDocRecord] = await orm.select().from(documents).where(eq(documents.id, createdDocId));
      createdDocuments.push(createdDocRecord || { id: createdDocId, refNumber: `DOC-${createdDocId}` });

      // Update matching items in the requisition
      for (const groupItem of group.items) {
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
            targetReqItem.linkedDocumentIds.push(createdDocId);
          }
        }
      }
    }

    // Determine overall requisition status
    const allOrdered = updatedItems.every(i => (i.orderedQty || 0) >= (i.requestedQty || 0));
    const shouldCloseRequisition = Boolean(params.closeRequisition || allOrdered);

    if (shouldCloseRequisition) {
      // If closing formally, mark remaining items as closed/ordered with optional note
      for (const item of updatedItems) {
        if ((item.remainingQty || 0) > 0) {
          item.remainingQty = 0;
          item.status = 'ordered';
          if (params.closureReason) {
            item.closureNote = params.closureReason;
          }
        }
      }
    }

    const newStatus = shouldCloseRequisition ? 'ordered' : 'under_review';

    let updatedReqNotes = req.notes || '';
    if (params.closureReason) {
      updatedReqNotes = `${updatedReqNotes}\n[تکمیل/بستن خرید: ${params.closureReason}]`.trim();
    }

    const [finalUpdatedReq] = await orm.update(purchaseRequisitions).set({
      status: newStatus,
      items: updatedItems,
      notes: updatedReqNotes,
      updatedAt: new Date().toISOString()
    }).where(eq(purchaseRequisitions.id, req.id)).returning();

    // Keep workflow instance state synchronized with new status
    if (newStatus === 'ordered' || newStatus === 'under_review') {
      let wfId = req.workflowInstanceId;
      if (!wfId) {
        try {
          const instance = await WorkflowTransitionExecutor.startInstance({
            workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
            entityType: 'purchase_requisition',
            entityId: String(req.id),
            userId: user.id,
            userName: user.username
          });
          wfId = instance.id;
          await orm.update(purchaseRequisitions).set({ workflowInstanceId: wfId }).where(eq(purchaseRequisitions.id, req.id));
        } catch (wfErr: any) {
          logger.warn({ message: `[Procurement] Error starting workflow for req #${req.id}: ${wfErr.message}` });
        }
      }
      if (wfId) {
        const [wf] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, wfId));
        if (wf) {
          const wStates = await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, wf.workflowDefinitionId));
          const targetStateKey = newStatus === 'ordered' ? 'ordered' : 'pending';
          const targetState = wStates.find((s: any) => s.stateKey === targetStateKey);
          if (targetState && wf.currentStateId !== targetState.id) {
            await orm.update(workflowInstances).set({
              currentStateId: targetState.id,
              updatedAt: new Date().toISOString()
            }).where(eq(workflowInstances.id, wf.id));
          }
        }
      }
    }

    await logActivity({
      userId: user.id,
      username: user.username || 'سیستم',
      action: 'UPDATE',
      entity: 'درخواست خرید',
      entityId: req.id,
      description: `تبدیل و صدور ${createdDocuments.length} سفارش خرید برای درخواست ${req.code}`,
      details: {
        code: req.code,
        createdDocsCount: createdDocuments.length,
        docNumbers: createdDocuments.map(d => d.refNumber || d.ref_number || d.id),
        newStatus
      }
    });

    return {
      createdDocuments,
      requisition: finalUpdatedReq as unknown as PurchaseRequisition
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

    let catalogItems: any[] = [];
    if (allItemIds.length > 0) {
      catalogItems = await orm.select().from(items).where(inArray(items.id, allItemIds));
    }
    const itemMap = new Map<number, any>();
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

      let totalAmt = 0;
      const mappedItems = docLines.map(l => {
        const cat = itemMap.get(l.itemId);
        const lineQty = Number(l.quantity || 0);
        const linePrice = Number(l.unitPrice || 0);
        const lineTotal = lineQty * linePrice;
        totalAmt += lineTotal;

        return {
          id: l.id,
          itemId: l.itemId,
          itemName: cat?.name || `کالای کد ${l.itemId}`,
          itemCode: cat?.code || '',
          unit: cat?.unit || 'عدد',
          quantity: lineQty,
          unitPrice: linePrice,
          totalPrice: lineTotal,
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
        totalAmount: totalAmt,
        itemsCount: mappedItems.length,
        items: mappedItems,
        user: doc.user || 'کارشناس تدارکات'
      };
    });

    return { data: result, total, page, limit };
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

    await DocumentService.finalizeDocument(documentId, user.username || 'کارشناس تدارکات');

    const matchCode = doc.notes?.match(/\[تدارکات:\s*درخواست\s+([^\]]+)\]/);
    const reqCode = matchCode ? matchCode[1].trim() : null;

    let linkedReq: any = null;
    if (reqCode) {
      const [r] = await orm.select().from(purchaseRequisitions).where(and(
        eq(purchaseRequisitions.code, reqCode),
        eq(purchaseRequisitions.isDeleted, 0)
      ));
      linkedReq = r;
    }

    if (!linkedReq) {
      const allReqs = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.isDeleted, 0));
      for (const r of allReqs) {
        if (Array.isArray(r.items) && r.items.some((it: any) => Array.isArray(it.linkedDocumentIds) && it.linkedDocumentIds.includes(documentId))) {
          linkedReq = r;
          break;
        }
      }
    }

    if (linkedReq) {
      const allDocIds = new Set<number>();
      for (const it of (linkedReq.items || [])) {
        if (Array.isArray(it.linkedDocumentIds)) {
          for (const dId of it.linkedDocumentIds) {
            allDocIds.add(Number(dId));
          }
        }
      }
      const otherDocs = await orm.select().from(documents).where(and(
        ilike(documents.notes, `%${linkedReq.code}%`),
        eq(documents.isDeleted, 0)
      ));
      for (const od of otherDocs) {
        allDocIds.add(od.id);
      }

      let allDelivered = true;
      if (allDocIds.size > 0) {
        const checkDocs = await orm.select().from(documents).where(and(
          inArray(documents.id, Array.from(allDocIds)),
          eq(documents.isDeleted, 0)
        ));
        for (const cd of checkDocs) {
          if (cd.id !== documentId && cd.status !== 'final') {
            allDelivered = false;
            break;
          }
        }
      }

      const docLines = await orm.select().from(documentItems).where(eq(documentItems.documentId, documentId));
      const updatedReqItems = (linkedReq.items || []).map((rit: any) => {
        const line = docLines.find(dl => dl.itemId === rit.itemId);
        if (line) {
          const prevRcv = Number(rit.receivedQty || 0);
          const newRcv = prevRcv + Number(line.quantity || 0);
          return {
            ...rit,
            receivedQty: newRcv,
            remainingQty: Math.max(0, Number(rit.requestedQty || 0) - newRcv),
            status: newRcv >= Number(rit.requestedQty || 0) ? 'received' : rit.status
          };
        }
        return rit;
      });

      const nextStatus = allDelivered ? 'received' : linkedReq.status;
      await orm.update(purchaseRequisitions).set({
        items: updatedReqItems,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      }).where(eq(purchaseRequisitions.id, linkedReq.id));

      if (allDelivered && linkedReq.workflowInstanceId) {
        const [wfInst] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, linkedReq.workflowInstanceId));
        if (wfInst && wfInst.status === 'IN_PROGRESS') {
          const states = ((wfInst.snapshotDsl as any)?.states as any[]) || 
            await orm.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, wfInst.workflowDefinitionId));
          const receivedState = states.find((s: any) => s.stateKey === 'received');
          
          const transitions = ((wfInst.snapshotDsl as any)?.transitions as any[]) ||
            await orm.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, wfInst.workflowDefinitionId));
          const trToReceived = transitions.find((t: any) => t.fromStateId === wfInst.currentStateId && t.toStateId === receivedState?.id);

          if (trToReceived) {
            try {
              await WorkflowTransitionExecutor.executeTransition({
                instanceId: wfInst.id,
                transitionId: trToReceived.id,
                userId: user.id || 1,
                userName: user.username || 'انباردار تحویل‌گیرنده',
                comment: `تحویل و ورود خودکار اقلام به انبار با فاکتور خرید ${doc.refNumber}`
              });
            } catch (trErr: any) {
              logger.warn({ message: `[Procurement] Error executing workflow transition on delivery: ${trErr.message}` });
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
    }

    await logActivity({
      userId: user.id || 1,
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
