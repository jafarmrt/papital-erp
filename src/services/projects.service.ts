import { eq, and, sql, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { productionProjects, projectStages, items, customers, projectProductStageProgress } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../errors/customErrors.js';
import { withOrderedLocks } from '../lib/lockOrder.js';
import { DocumentService } from './document.service.js';
import { businessNowIsoDateTime } from '../lib/businessClock.js';
import { requireStorageDate, optionalStorageDate } from '../lib/storageDate.js';
import { AttachmentStorageService } from './attachments/attachmentStorage.service.js';

export interface CreateProjectInput {
  title: string;
  projectCode?: string;
  customerId?: number | string | null;
  customerName?: string;
  itemId?: number | string | null;
  itemCode?: string;
  itemName?: string;
  quantity?: number | string;
  unit?: string;
  startDate?: string;
  endDate?: string;
  priority?: string;
  description?: string;
  initialStages?: Array<Record<string, unknown>>;
  products?: unknown[];
  inventoryControl?: unknown;
  stageSchedules?: unknown;
  customStages?: unknown[];
  attachments?: unknown[];
  createdBy?: string;
}

export interface UpdateProjectInput {
  title?: string;
  projectCode?: string;
  customerId?: number | string | null;
  customerName?: string;
  itemId?: number | string | null;
  itemCode?: string;
  itemName?: string;
  quantity?: number | string;
  unit?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  priority?: string;
  description?: string;
  products?: unknown[];
  inventoryControl?: unknown;
  stageSchedules?: unknown;
  customStages?: unknown[];
  attachments?: unknown[];
}

export interface AddProjectToInventoryInput {
  projectId: number;
  itemsToAdd: Array<{
    itemId: number | string;
    quantity: number | string;
    location?: string;
    notes?: string;
    unitPrice?: number | string;
  }>;
  markCompleted?: boolean;
  currentUser?: string;
}

export class ProjectService {
  /**
   * Generates a unique project code
   */
  static async generateUniqueProjectCode(requestedCode?: string, executor: DbExecutor = orm): Promise<string> {
    let projectCode = requestedCode ? String(requestedCode).trim() : '';

    if (!projectCode) {
      const countRes = await executor.select({ count: sql<number>`count(*)` }).from(productionProjects);
      const totalNum = Number(countRes[0]?.count || 0) + 1;
      const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
      const rawYear = new Date().toLocaleDateString('fa-IR-u-ca-persian', { year: 'numeric' });
      const jalaliYear = rawYear.replace(/[۰-۹]/g, d => String(faDigits.indexOf(d))) || '1405';
      projectCode = `PRJ-${jalaliYear}-${totalNum.toString().padStart(3, '0')}`;
    }

    let uniqueCode = String(projectCode);
    let codeCounter = 1;
    while (true) {
      const existing = await executor
        .select({ id: productionProjects.id })
        .from(productionProjects)
        .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
      if (existing.length === 0) break;
      uniqueCode = `${projectCode}-${codeCounter++}`;
    }
    return String(uniqueCode);
  }

  /**
   * Creates a production project along with its initial stages
   */
  static async createProject(
    input: CreateProjectInput,
    executor: DbExecutor = orm
  ): Promise<{ project: typeof productionProjects.$inferSelect; stages: Array<typeof projectStages.$inferSelect> }> {
    const finalCode = await ProjectService.generateUniqueProjectCode(input.projectCode, executor);

    let validCustomerId: number | null = null;
    if (input.customerId && !isNaN(Number(input.customerId))) {
      const foundCust = await executor.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(input.customerId)));
      if (foundCust.length > 0) validCustomerId = Number(input.customerId);
    }

    let validItemId: number | null = null;
    if (input.itemId && !isNaN(Number(input.itemId))) {
      const foundItem = await executor.select({ id: items.id }).from(items).where(eq(items.id, Number(input.itemId)));
      if (foundItem.length > 0) validItemId = Number(input.itemId);
    }

    const [newProject] = await executor.insert(productionProjects).values({
      projectCode: finalCode,
      title: input.title.trim(),
      customerId: validCustomerId,
      customerName: input.customerName || '',
      itemId: validItemId,
      itemCode: input.itemCode || '',
      itemName: input.itemName || '',
      quantity: input.quantity ? Number(input.quantity) : 1,
      unit: input.unit || 'عدد',
      // v7.0.135 (TD-232): تاریخ شروع و پایان پروژه و مراحل میلادی ISO؛ ورودی شمسی تبدیل و نامعتبر 422
      startDate: requireStorageDate(input.startDate, 'تاریخ شروع پروژه'),
      endDate: requireStorageDate(input.endDate, 'تاریخ پایان پروژه'),
      status: 'planned',
      priority: input.priority || 'medium',
      description: input.description || '',
      createdBy: input.createdBy || 'سیستم',
      products: Array.isArray(input.products) ? input.products : [],
      inventoryControl: input.inventoryControl || {},
      stageSchedules: input.stageSchedules || {},
      customStages: input.customStages || [],
      attachments: [],
      isDeleted: 0
    }).returning();
    // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
    newProject.attachments = await AttachmentStorageService.attachToNewRecord(executor, 'production_project', newProject.id, input.attachments, input.createdBy || '');

    let createdStages: Array<typeof projectStages.$inferSelect> = [];
    if (Array.isArray(input.initialStages) && input.initialStages.length > 0) {
      const stageValues = input.initialStages.map((stg, index) => ({
        projectId: newProject.id,
        stageOrder: index + 1,
        title: typeof stg.title === 'string' && stg.title.trim() ? stg.title.trim() : `مرحله ${index + 1}`,
        status: typeof stg.status === 'string' ? stg.status : 'pending',
        startDate: requireStorageDate(typeof stg.startDate === 'string' ? stg.startDate : (typeof stg.start_date === 'string' ? stg.start_date : (input.startDate || '')), 'تاریخ شروع مرحله'),
        endDate: requireStorageDate(typeof stg.endDate === 'string' ? stg.endDate : (typeof stg.end_date === 'string' ? stg.end_date : (input.endDate || '')), 'تاریخ پایان مرحله'),
        assignedPersonnel: Array.isArray(stg.assignedPersonnel) ? stg.assignedPersonnel : (Array.isArray(stg.assigned_personnel) ? stg.assigned_personnel : []),
        requiredResources: Array.isArray(stg.requiredResources) ? stg.requiredResources : (Array.isArray(stg.required_resources) ? stg.required_resources : []),
        progressPercent: typeof stg.progressPercent === 'number' ? stg.progressPercent : (typeof stg.progress_percent === 'number' ? stg.progress_percent : 0),
        notes: typeof stg.notes === 'string' ? stg.notes : '',
        isDeleted: 0
      }));

      createdStages = await executor.insert(projectStages).values(stageValues).returning();
    }

    return { project: newProject, stages: createdStages };
  }

  /**
   * Updates an existing production project
   */
  static async updateProject(
    id: number,
    input: UpdateProjectInput,
    executor: DbExecutor = orm
  ): Promise<{ previous: typeof productionProjects.$inferSelect; current: typeof productionProjects.$inferSelect }> {
    const [existing] = await executor.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('پروژه یافت نشد');
    }

    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData.title = input.title.trim();

    if (input.projectCode !== undefined && input.projectCode !== null && String(input.projectCode).trim()) {
      const requestedCode = String(input.projectCode).trim();
      let uniqueCode = requestedCode;
      let codeCounter = 1;
      while (true) {
        const existingCode = await executor
          .select({ id: productionProjects.id })
          .from(productionProjects)
          .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
        if (existingCode.length === 0 || existingCode[0].id === id) break;
        uniqueCode = `${requestedCode}-${codeCounter++}`;
      }
      updateData.projectCode = String(uniqueCode);
    }

    if (input.customerId !== undefined) {
      if (input.customerId && !isNaN(Number(input.customerId))) {
        const foundCust = await executor.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(input.customerId)));
        updateData.customerId = foundCust.length > 0 ? Number(input.customerId) : null;
      } else {
        updateData.customerId = null;
      }
    }

    if (input.customerName !== undefined) updateData.customerName = input.customerName;

    if (input.itemId !== undefined) {
      if (input.itemId && !isNaN(Number(input.itemId))) {
        const foundItem = await executor.select({ id: items.id }).from(items).where(eq(items.id, Number(input.itemId)));
        updateData.itemId = foundItem.length > 0 ? Number(input.itemId) : null;
      } else {
        updateData.itemId = null;
      }
    }

    if (input.itemCode !== undefined) updateData.itemCode = input.itemCode;
    if (input.itemName !== undefined) updateData.itemName = input.itemName;
    if (input.quantity !== undefined) updateData.quantity = Number(input.quantity);
    if (input.unit !== undefined) updateData.unit = input.unit;
    if (input.startDate !== undefined) updateData.startDate = optionalStorageDate(input.startDate, 'تاریخ شروع پروژه');
    if (input.endDate !== undefined) updateData.endDate = optionalStorageDate(input.endDate, 'تاریخ پایان پروژه');
    if (input.status !== undefined) updateData.status = input.status;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.products !== undefined) updateData.products = Array.isArray(input.products) ? input.products : [];
    if (input.inventoryControl !== undefined) updateData.inventoryControl = input.inventoryControl;
    if (input.stageSchedules !== undefined) updateData.stageSchedules = input.stageSchedules;
    if (input.customStages !== undefined) updateData.customStages = input.customStages;
    if (input.attachments !== undefined) {
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      updateData.attachments = await AttachmentStorageService.normalizeForRecord(executor, 'production_project', id, input.attachments);
    }

    const [current] = await executor.update(productionProjects).set(updateData).where(eq(productionProjects.id, id)).returning();

    return { previous: existing, current: current || { ...existing, ...updateData } };
  }

  /**
   * Soft deletes a production project and its stages
   */
  static async deleteProject(id: number, executor: DbExecutor = orm): Promise<typeof productionProjects.$inferSelect> {
    const [existing] = await executor.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('پروژه یافت نشد');
    }

    await executor.update(productionProjects).set({ isDeleted: 1 }).where(eq(productionProjects.id, id));
    await executor.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.projectId, id));

    return existing;
  }

  /**
   * Adds finished products to warehouse stock with deadlock-free lock ordering
   */
  static async addProjectToInventory(
    input: AddProjectToInventoryInput,
    executor: DbExecutor = orm
  ): Promise<{ addedCount: number; projectCode: string }> {
    const id = input.projectId;
    const currentUser = input.currentUser || 'سیستم';

    return executor.transaction(async (tx) => {
      const targetItemIds = (input.itemsToAdd || []).map((e) => Number(e.itemId)).filter(Boolean);
      await withOrderedLocks(tx, [
        { table: items, ids: targetItemIds, name: 'items' },
        { table: productionProjects, id, name: 'productionProjects' }
      ], async () => true);

      const [proj] = await tx.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
      if (!proj) {
        throw new NotFoundError('پروژه یافت نشد');
      }

      let addedCount = 0;

      for (const entry of input.itemsToAdd) {
        const itemId = Number(entry.itemId);
        const qty = Number(entry.quantity);
        if (!itemId || !qty || qty <= 0) continue;

        let effectiveUnitPrice: number | null = null;
        if (entry.unitPrice !== undefined && entry.unitPrice !== null && !isNaN(Number(entry.unitPrice))) {
          effectiveUnitPrice = Number(entry.unitPrice);
        } else {
          const [itemRow] = await tx.select({ weightedAverageCost: items.weightedAverageCost }).from(items).where(eq(items.id, itemId));
          effectiveUnitPrice = Number(itemRow?.weightedAverageCost || 0);
        }

        const todayDate = await businessNowIsoDateTime();

        await DocumentService.applyStockMovement(tx, {
          itemId,
          inOut: 'in',
          quantity: qty,
          price: effectiveUnitPrice,
          date: todayDate,
          documentType: 'project',
          documentRef: proj.projectCode || `پروژه-${id}`,
          user: currentUser,
          targetLoc: entry.location || '',
          notes: entry.notes ? `تحویل از پروژه ${proj.projectCode}: ${entry.notes}` : `تحویل تولید پروژه ${proj.projectCode}`
        });

        addedCount++;
      }

      if (input.markCompleted) {
        const matrixCheck = await ProjectService.getProgressMatrixStatus(id, tx);
        if (!matrixCheck.allMatrixCompleted) {
          throw new ValidationError(`امکان تغییر وضعیت پروژه به تکمیل‌شده وجود ندارد؛ هنوز تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات در بخش «پیشرفت به تفکیک کد کالا» تیک نخورده‌اند (${matrixCheck.completedMatrixCells} از ${matrixCheck.totalMatrixCells} مورد تکمیل شده است).`);
        }
        await tx.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, id));
      }

      return { addedCount, projectCode: proj.projectCode };
    });
  }

  /**
   * Adds a stage to a project
   */
  static async addStage(
    projectId: number,
    data: {
      title: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      assignedPersonnel?: unknown[];
      requiredResources?: unknown[];
      notes?: string;
    },
    executor: DbExecutor = orm
  ): Promise<typeof projectStages.$inferSelect> {
    const existingStages = await executor
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    const nextOrder = existingStages.length + 1;

    const [newStage] = await executor.insert(projectStages).values({
      projectId,
      stageOrder: nextOrder,
      title: data.title.trim(),
      status: data.status || 'pending',
      startDate: requireStorageDate(data.startDate, 'تاریخ شروع مرحله'),
      endDate: requireStorageDate(data.endDate, 'تاریخ پایان مرحله'),
      assignedPersonnel: Array.isArray(data.assignedPersonnel) ? data.assignedPersonnel : [],
      requiredResources: Array.isArray(data.requiredResources) ? data.requiredResources : [],
      progressPercent: data.status === 'completed' ? 100 : 0,
      notes: data.notes || '',
      isDeleted: 0
    }).returning();

    return newStage;
  }

  /**
   * Checks comprehensive status of product physical progress matrix
   */
  static async getProgressMatrixStatus(
    projectId: number,
    executor: DbExecutor = orm
  ): Promise<{
    allMatrixCompleted: boolean;
    totalMatrixCells: number;
    completedMatrixCells: number;
    missingMatrixCells: number;
    reason?: string;
  }> {
    const [project] = await executor
      .select()
      .from(productionProjects)
      .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));

    if (!project) {
      return {
        allMatrixCompleted: false,
        totalMatrixCells: 0,
        completedMatrixCells: 0,
        missingMatrixCells: 0,
        reason: 'پروژه یافت نشد'
      };
    }

    const rawStages = await executor
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
      .orderBy(asc(projectStages.stageOrder));

    if (rawStages.length === 0) {
      return {
        allMatrixCompleted: false,
        totalMatrixCells: 0,
        completedMatrixCells: 0,
        missingMatrixCells: 0,
        reason: 'هیچ مرحله‌ای برای پروژه تعریف نشده است'
      };
    }

    let products = (Array.isArray(project.products) && project.products.length > 0 ? project.products : []) as Array<Record<string, unknown>>;
    if (products.length === 0 && project.itemId) {
      products = [{
        item_id: project.itemId,
        item_code: project.itemCode || '',
        item_name: project.itemName || '',
        quantity: project.quantity || 1,
        unit: project.unit || 'عدد'
      }];
    }

    if (products.length === 0) {
      return {
        allMatrixCompleted: false,
        totalMatrixCells: 0,
        completedMatrixCells: 0,
        missingMatrixCells: 0,
        reason: 'هیچ کد کالایی برای پروژه تعریف نشده است'
      };
    }

    const progressRows = await executor
      .select()
      .from(projectProductStageProgress)
      .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.isDeleted, 0)));

    const progressMap = new Map<string, typeof progressRows[number]>();
    for (const row of progressRows) {
      progressMap.set(`${row.itemId}|${row.stageOrder}`, row);
    }

    const optionalTitles = new Set(
      products.flatMap(p => {
        const sel = p.selected_optional_stages || p.selectedOptionalStages;
        return Array.isArray(sel) ? sel.map(t => String(t).trim()) : [];
      })
    );
    const stagesForCompute = rawStages.map(s => ({ stageOrder: s.stageOrder, title: s.title }));

    let totalMatrixCells = 0;
    let completedMatrixCells = 0;

    for (const p of products) {
      const rawId = p.item_id ?? p.itemId ?? p.item_id_raw;
      const itemId = Number(rawId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;

      const sel = p.selected_optional_stages || p.selectedOptionalStages;
      const selected = new Set(Array.isArray(sel) ? sel.map(t => String(t).trim()) : []);
      const applicableOrders = stagesForCompute
        .filter(s => !optionalTitles.has(s.title) || selected.has(s.title))
        .map(s => s.stageOrder);

      for (const order of applicableOrders) {
        totalMatrixCells++;
        const key = `${itemId}|${order}`;
        const row = progressMap.get(key);
        if (row?.status === 'completed') {
          completedMatrixCells++;
        }
      }
    }

    const allMatrixCompleted = totalMatrixCells > 0 && completedMatrixCells === totalMatrixCells;
    return {
      allMatrixCompleted,
      totalMatrixCells,
      completedMatrixCells,
      missingMatrixCells: Math.max(0, totalMatrixCells - completedMatrixCells)
    };
  }

  /**
   * Updates a project stage and syncs status
   */
  static async updateStage(
    projectId: number,
    stageId: number,
    data: {
      title?: string;
      stageOrder?: number;
      status?: string;
      startDate?: string;
      endDate?: string;
      assignedPersonnel?: unknown[];
      requiredResources?: unknown[];
      progressPercent?: number;
      notes?: string;
    },
    executor: DbExecutor = orm
  ): Promise<typeof projectStages.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('مرحله یافت نشد');
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.stageOrder !== undefined) updateData.stageOrder = Number(data.stageOrder);
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === 'completed') {
        updateData.progressPercent = 100;
        updateData.completedAt = new Date().toISOString();
      }
    }
    if (data.startDate !== undefined) updateData.startDate = optionalStorageDate(data.startDate, 'تاریخ شروع مرحله');
    if (data.endDate !== undefined) updateData.endDate = optionalStorageDate(data.endDate, 'تاریخ پایان مرحله');
    if (data.assignedPersonnel !== undefined) {
      updateData.assignedPersonnel = Array.isArray(data.assignedPersonnel) ? data.assignedPersonnel : [];
    }
    if (data.requiredResources !== undefined) {
      updateData.requiredResources = Array.isArray(data.requiredResources) ? data.requiredResources : [];
    }
    if (data.progressPercent !== undefined) {
      const p = Math.min(100, Math.max(0, Number(data.progressPercent)));
      updateData.progressPercent = p;
      if (p === 100 && existing.status !== 'completed') {
        updateData.status = 'completed';
        updateData.completedAt = new Date().toISOString();
      } else if (p > 0 && p < 100 && existing.status === 'pending') {
        updateData.status = 'in_progress';
      }
    }
    if (data.notes !== undefined) updateData.notes = data.notes;

    const [updated] = await executor
      .update(projectStages)
      .set(updateData)
      .where(eq(projectStages.id, stageId))
      .returning();

    return updated;
  }

  /**
   * Soft deletes a stage from a project
   */
  static async deleteStage(
    projectId: number,
    stageId: number,
    executor: DbExecutor = orm
  ): Promise<typeof projectStages.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('مرحله یافت نشد');
    }

    await executor.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.id, stageId));
    return existing;
  }

  /**
   * Bulk updates product physical progress matrix
   */
  static async updateProductProgress(
    projectId: number,
    updates: Array<{
      itemId: number;
      stageOrder: number;
      stageTitle?: string;
      status: string;
    }>,
    currentUser: string = 'سیستم',
    executor: DbExecutor = orm
  ): Promise<{ applied: number; skippedInvalid: number }> {
    const [project] = await executor
      .select()
      .from(productionProjects)
      .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));

    if (!project) {
      throw new NotFoundError('پروژه یافت نشد');
    }

    const products = (Array.isArray(project.products) ? project.products : []) as Array<Record<string, unknown>>;
    const productByItemId = new Map<number, Record<string, unknown>>();
    for (const p of products) {
      const rawId = p.item_id ?? p.itemId ?? p.item_id_raw;
      const id = Number(rawId);
      if (Number.isFinite(id) && id > 0) {
        productByItemId.set(id, p);
      }
    }

    const bizNow = await businessNowIsoDateTime();
    let applied = 0;
    let skippedInvalid = 0;

    for (const u of updates) {
      const itemId = Number(u.itemId);
      const stageOrder = Number(u.stageOrder);
      if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(stageOrder) || stageOrder <= 0) {
        skippedInvalid++;
        continue;
      }
      const product = productByItemId.get(itemId);
      if (!product) {
        skippedInvalid++;
        continue;
      }

      const stageRow = await executor
        .select({ id: projectStages.id, title: projectStages.title })
        .from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), eq(projectStages.stageOrder, stageOrder), eq(projectStages.isDeleted, 0)))
        .limit(1);
      const stageTitle = stageRow[0]?.title || String(u.stageTitle || '').trim() || `مرحله ${stageOrder}`;

      const itemCode = String(product.item_code ?? product.itemCode ?? '');
      const itemName = String(product.item_name ?? product.itemName ?? '');
      const qty = Number(product.quantity) || 0;

      await executor.insert(projectProductStageProgress).values({
        projectId,
        itemId,
        itemCode,
        itemName,
        quantity: qty,
        stageOrder,
        stageTitle,
        status: u.status,
        updatedAt: bizNow,
        updatedByName: currentUser,
        isDeleted: 0
      }).onConflictDoUpdate({
        target: [projectProductStageProgress.projectId, projectProductStageProgress.itemId, projectProductStageProgress.stageOrder],
        set: {
          status: u.status,
          stageTitle,
          quantity: qty,
          updatedAt: bizNow,
          updatedByName: currentUser
        }
      });
      applied++;
    }

    return { applied, skippedInvalid };
  }

  /**
   * Automatically synchronizes stage progress and project status based on product matrix
   */
  static async syncProjectStagesAndStatusFromProductProgress(
    projectId: number,
    executor: DbExecutor = orm
  ) {
    const [project] = await executor
      .select()
      .from(productionProjects)
      .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
    if (!project) return null;

    const rawStages = await executor
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
      .orderBy(asc(projectStages.stageOrder));

    const products = (Array.isArray(project.products) ? project.products : []) as Array<Record<string, unknown>>;
    if (rawStages.length === 0) return { project, stages: [] };

    const progressRows = await executor
      .select()
      .from(projectProductStageProgress)
      .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.isDeleted, 0)));

    const progressMap = new Map<string, typeof progressRows[number]>();
    for (const row of progressRows) {
      progressMap.set(`${row.itemId}|${row.stageOrder}`, row);
    }

    const optionalTitles = new Set(
      products.flatMap(p => {
        const sel = p.selected_optional_stages || p.selectedOptionalStages;
        return Array.isArray(sel) ? sel.map(t => String(t).trim()) : [];
      })
    );
    const stagesForCompute = rawStages.map(s => ({ stageOrder: s.stageOrder, title: s.title }));

    const productRows = products.map(p => {
      const rawId = p.item_id ?? p.itemId ?? p.item_id_raw;
      const itemId = Number(rawId);
      const sel = p.selected_optional_stages || p.selectedOptionalStages;
      const selected = new Set(Array.isArray(sel) ? sel.map(t => String(t).trim()) : []);
      const applicableOrders = (Number.isFinite(itemId) && itemId > 0)
        ? stagesForCompute.filter(s => !optionalTitles.has(s.title) || selected.has(s.title)).map(s => s.stageOrder)
        : [];
      let completedCount = 0;
      for (const order of applicableOrders) {
        const key = `${itemId}|${order}`;
        const row = progressMap.get(key);
        if (row?.status === 'completed') completedCount++;
      }
      const percent = applicableOrders.length > 0 ? Math.round((completedCount / applicableOrders.length) * 100) : 0;
      return {
        itemId,
        quantity: Number(p.quantity) || 0,
        applicableOrders,
        completedCount,
        percent
      };
    });

    const bizNow = await businessNowIsoDateTime();
    let anyProgressDetected = false;
    let allStagesCompleted = rawStages.length > 0;
    const updatedStages: (typeof rawStages[number] & { completedSkusCount?: number; applicableSkusCount?: number })[] = [];

    for (const stg of rawStages) {
      const applicableProducts = productRows.filter(p => p.itemId && p.applicableOrders.includes(stg.stageOrder));
      const applicableCount = applicableProducts.length;
      let completedCount = 0;
      for (const p of applicableProducts) {
        const key = `${p.itemId}|${stg.stageOrder}`;
        const row = progressMap.get(key);
        if (row?.status === 'completed') completedCount++;
      }

      let calculatedPercent = 0;
      let calculatedStatus = 'pending';

      if (applicableCount > 0) {
        calculatedPercent = Math.round((completedCount / applicableCount) * 100);
        if (completedCount === applicableCount) {
          calculatedStatus = 'completed';
        } else if (completedCount > 0) {
          calculatedStatus = 'in_progress';
        } else {
          calculatedStatus = stg.status === 'blocked' ? 'blocked' : 'pending';
        }
      } else {
        calculatedPercent = Number(stg.progressPercent || 0);
        calculatedStatus = stg.status || 'pending';
      }

      if (completedCount > 0 || calculatedPercent > 0) {
        anyProgressDetected = true;
      }
      if (calculatedStatus !== 'completed') {
        allStagesCompleted = false;
      }

      const completedAt = calculatedStatus === 'completed' ? (stg.completedAt || bizNow) : null;

      if (stg.progressPercent !== calculatedPercent || stg.status !== calculatedStatus) {
        await executor.update(projectStages).set({
          progressPercent: calculatedPercent,
          status: calculatedStatus,
          completedAt
        }).where(eq(projectStages.id, stg.id));
      }

      updatedStages.push({
        ...stg,
        progressPercent: calculatedPercent,
        status: calculatedStatus,
        completedAt,
        completedSkusCount: completedCount,
        applicableSkusCount: applicableCount
      });
    }

    const totalQty = productRows.reduce((acc, p) => acc + p.quantity, 0);
    const weightedProgress = totalQty > 0
      ? Math.round(productRows.reduce((acc, p) => acc + (p.percent * p.quantity), 0) / totalQty)
      : 0;

    const allProductsDone = productRows.length > 0 && productRows.every(p => p.applicableOrders.length > 0 && p.completedCount === p.applicableOrders.length);
    const isOverallCompleted = allProductsDone || (allStagesCompleted && rawStages.length > 0);

    let newProjectStatus = project.status;
    if (isOverallCompleted) {
      newProjectStatus = 'completed';
    } else if (anyProgressDetected || weightedProgress > 0) {
      if (project.status === 'planned' || project.status === 'completed') {
        newProjectStatus = 'in_progress';
      }
    } else if (!anyProgressDetected && weightedProgress === 0 && project.status === 'completed') {
      newProjectStatus = 'in_progress';
    }

    if (newProjectStatus !== project.status) {
      await executor.update(productionProjects).set({ status: newProjectStatus }).where(eq(productionProjects.id, projectId));
      project.status = newProjectStatus;
    }

    return {
      project,
      stages: updatedStages,
      weightedProgress
    };
  }
}

