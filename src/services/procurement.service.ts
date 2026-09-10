import { sql, eq, and, desc, inArray, or, ilike } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { purchaseRequisitions, productionProjects, documentRefCounters, items, documents, workflowInstances, workflowTransitions } from '../db/schema.js';
import { resolveJalaliFiscalYear } from '../lib/businessClock.js';
import { getTodayJalaliDate } from '../utils.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { ValidationError, NotFoundError } from '../errors/customErrors.js';
import { WorkflowTransitionExecutor } from './workflow/workflowTransitionExecutor.js';
import { DocumentService } from './document.service.js';
import type { PurchaseRequisition, PurchaseRequisitionItemRow } from '../types.js';

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

    let matchedTransition = transitions.find(t => 
      targetActionKeys.includes(t.actionKey) && (!t.fromStateId || t.fromStateId === wfInst.currentStateId)
    ) || transitions.find(t => targetActionKeys.includes(t.actionKey));

    if (!matchedTransition && (actionKey === 'mark_received' || actionKey === 'receive_items')) {
      matchedTransition = transitions.find(t => t.actionKey === 'receive_items' || t.actionKey === 'mark_received');
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
      const warehouseLoc = group.targetWarehouse || 'انبار اصلی';

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
        date: getTodayJalaliDate(),
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
    const newStatus = allOrdered ? 'ordered' : 'under_review';

    const [finalUpdatedReq] = await orm.update(purchaseRequisitions).set({
      status: newStatus,
      items: updatedItems,
      updatedAt: new Date().toISOString()
    }).where(eq(purchaseRequisitions.id, req.id)).returning();

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

    return {
      totalRequisitions: rows.length,
      pendingCount,
      underReviewCount,
      managerApprovalCount,
      orderedCount,
      receivedCount,
      urgentCount
    };
  }
}
