import { eq, and, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { productionProjects, projectStages, items, customers, projectProductStageProgress, documents, projectBomAllocations } from '../db/schema.js';
import { AppError, BusinessLogicError, NotFoundError, ValidationError } from '../errors/customErrors.js';
import { deliveredProjectQuantities, describeOverDeliveries, findOverDeliveries, plannedProjectProducts, type ProjectOverDelivery } from './projects/projectDeliveryCap.js';
import { withOrderedLocks } from '../lib/lockOrder.js';
import { DocumentService } from './document.service.js';
import { businessNowIsoDateTime, businessTodayIsoDate } from '../lib/businessClock.js';
import { requireStorageDate, optionalStorageDate } from '../lib/storageDate.js';
import { AttachmentStorageService } from './attachments/attachmentStorage.service.js';
import { resolveServerInventoryControl } from './projects/serverInventoryControl.js';
import { assignProjectCode } from './projects/projectCode.js';
import { keepScheduleLogLinks } from '../lib/projects/scheduleWorkLog.js';
import { matrixProducts } from '../lib/projects/progressMatrix.js';
import { loadProjectProgressMatrix, productProgressView, progressMatrixStatus, type ProgressMatrixStatus } from './projects/projectProgressMatrix.js';
import { actorName, lockLiveProject, syncProjectFromMatrix, type ProjectActor, type ProjectStatusSyncResult, type SyncedStage } from './projects/projectStatusSync.js';
import { logActivity } from '../lib/auditLogger.js';

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
  userId?: number;
  /** v8.0.72 (TD-327): دلیل تحویل بیش از مقدار برنامه‌ریزی‌شده؛ بی آن تحویل اضافه رد می‌شود */
  overDeliveryReason?: string;
}

export interface AddProjectToInventoryResult {
  addedCount: number;
  projectCode: string;
  /** v8.0.35 (TD-285): سند «رسید تولید» صادرشده؛ اگر هیچ قلم معتبری نبود null */
  documentId: number | null;
  refNumber: string | null;
  /** v8.0.72 (TD-327): کالاهایی که با دلیل بیش از برنامه تحویل شدند */
  overDeliveries: ProjectOverDelivery[];
}

export class ProjectService {
  /**
   * Creates a production project along with its initial stages
   */
  static async createProject(
    input: CreateProjectInput,
    executor: DbExecutor = orm
  ): Promise<{ project: typeof productionProjects.$inferSelect; stages: Array<typeof projectStages.$inferSelect> }> {
    // v8.0.80 (TD-350): کد و درج پروژه در یک تراکنش زیر قفل شمارنده سال
    return executor.transaction(tx => ProjectService.createProjectLocked(input, tx));
  }

  private static async createProjectLocked(
    input: CreateProjectInput,
    executor: DbExecutor
  ): Promise<{ project: typeof productionProjects.$inferSelect; stages: Array<typeof projectStages.$inferSelect> }> {
    const finalCode = await assignProjectCode(executor, input.projectCode);

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
      // v8.0.58 (TD-306): رزرو پروژه را فقط سرور می‌سازد
      inventoryControl: await resolveServerInventoryControl(input.inventoryControl, {}, input.products, executor),
      // v9.0.282 (TD-736): پروژه تازه کارکردی ندارد؛ پیوند کارکرد ارسالی ردیف‌ها نوشته نمی‌شود
      stageSchedules: keepScheduleLogLinks(input.stageSchedules || {}, null),
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
    executor: DbExecutor = orm,
    actor: ProjectActor = {}
  ): Promise<{ previous: typeof productionProjects.$inferSelect; current: typeof productionProjects.$inferSelect }> {
    // v8.0.58 (TD-306): قفل سطری پروژه تا رزرو فعلی (پس از کسر حواله خروج هم‌زمان) از دست نرود
    return executor.transaction(tx => ProjectService.updateProjectLocked(id, input, tx, actor));
  }

  private static async updateProjectLocked(
    id: number,
    input: UpdateProjectInput,
    executor: DbExecutor,
    actor: ProjectActor
  ): Promise<{ previous: typeof productionProjects.$inferSelect; current: typeof productionProjects.$inferSelect }> {
    const [existing] = await executor.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0))).for('update');
    if (!existing) {
      throw new NotFoundError('پروژه یافت نشد');
    }

    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData.title = input.title.trim();

    if (input.projectCode !== undefined && input.projectCode !== null && String(input.projectCode).trim()) {
      updateData.projectCode = await assignProjectCode(executor, String(input.projectCode), id);
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
    if (input.inventoryControl !== undefined) {
      const products = input.products !== undefined ? updateData.products : existing.products;
      updateData.inventoryControl = await resolveServerInventoryControl(input.inventoryControl, existing.inventoryControl, products, executor);
    }
    // v9.0.282 (TD-736): پیوند کارکرد هر ردیف برنامه را فقط سرور (ثبت و حذف کارکرد) می‌نویسد
    if (input.stageSchedules !== undefined) updateData.stageSchedules = keepScheduleLogLinks(input.stageSchedules, existing.stageSchedules);
    if (input.customStages !== undefined) updateData.customStages = input.customStages;
    if (input.attachments !== undefined) {
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      updateData.attachments = await AttachmentStorageService.normalizeForRecord(executor, 'production_project', id, input.attachments);
    }

    const [current] = await executor.update(productionProjects).set(updateData).where(eq(productionProjects.id, id)).returning();

    // v9.0.333 (TD-739): تکمیل دستی پروژه با همان قاعده ماتریس، درون همین تراکنش و روی ردیف ذخیره‌شده
    if (input.status === 'completed' && existing.status !== 'completed') {
      ProjectService.assertMatrixCompleted(progressMatrixStatus(await loadProjectProgressMatrix(executor, current)));
    }

    // v9.0.334 (TD-738): ویرایش پروژه (محصولات، کالای اصلی) مراحل و وضعیت را زیر همین قفل با ماتریس همگام می‌کند
    const synced = await syncProjectFromMatrix(executor, current, actor);
    return { previous: existing, current: synced.project };
  }

  /**
   * Soft deletes a production project and its stages
   */
  static async deleteProject(id: number, executor: DbExecutor = orm): Promise<typeof productionProjects.$inferSelect> {
    return executor.transaction(async (tx) => {
      // v8.0.121 (TD-412، تصمیم مالک محصول — گزینه الف): پروژه‌ای که تخصیص مواد باز دارد حذف نمی‌شود تا تخصیص‌ها آزاد
      // شوند. پیش‌تر حذف پذیرفته می‌شد و بهای مواد تخصیص‌یافته در کالای در جریان ساخت (۱۴۰۲) زیر تفصیلی پروژه حذف‌شده
      // می‌ماند و دیگر از صفحه پروژه آزاد نمی‌شد. تخصیص هم ردیف پروژه را قفل می‌کند، پس حذف و تخصیص هم‌زمان پشت هم‌اند.
      const [existing] = await tx.select().from(productionProjects)
        .where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)))
        .for('update');
      if (!existing) {
        throw new NotFoundError('پروژه یافت نشد');
      }
      const open = await tx.select({ itemCode: projectBomAllocations.itemCode, itemName: projectBomAllocations.itemName, quantity: projectBomAllocations.quantity, unit: projectBomAllocations.unit })
        .from(projectBomAllocations)
        .where(and(eq(projectBomAllocations.projectId, id), eq(projectBomAllocations.status, 'allocated'), eq(projectBomAllocations.isDeleted, 0)))
        .orderBy(asc(projectBomAllocations.id));
      if (open.length > 0) {
        const list = open.slice(0, 5).map(a => `«${a.itemName}» (${a.itemCode}) ${a.quantity} ${a.unit || 'عدد'}`).join('، ');
        throw new BusinessLogicError(
          `پروژه «${existing.projectCode}» ${open.length} تخصیص مواد باز دارد (${list}${open.length > 5 ? '، …' : ''}) و حذف نمی‌شود؛ ابتدا تخصیص‌ها را از زبانه مواد پروژه آزاد کنید.`,
          { code: 'PROJECT_HAS_OPEN_ALLOCATIONS', openAllocations: open.length }
        );
      }

      await tx.update(productionProjects).set({ isDeleted: 1 }).where(eq(productionProjects.id, id));
      await tx.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.projectId, id));

      return existing;
    });
  }

  /**
   * تحویل کالای ساخته‌شده پروژه به انبار («ورود به انبار» زبانه پروژه) با قفل‌گذاری مرتب (کالاها، سپس پروژه).
   * v8.0.35 (TD-285، تصمیم مالک محصول — گزینه الف): به‌جای حرکت مستقیم انبار، یک سند «رسید تولید» نهایی با پیوند پروژه در
   * همین تراکنش صادر می‌شود که سند حسابداری خودش را دارد (بدهکار کالای ساخته‌شده / بستانکار کالای در جریان ساخت با تفصیلی
   * پروژه). پیش‌تر موجودی بی‌سند حسابداری بالا می‌رفت و ارزش انبار از دفتر کل بیشتر می‌شد. بهای هر قلم همان بهای واردشده
   * است و اگر وارد نشده باشد میانگین موزون فعلی کالا.
   */
  static async addProjectToInventory(
    input: AddProjectToInventoryInput,
    executor: DbExecutor = orm
  ): Promise<AddProjectToInventoryResult> {
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

      // v8.0.72 (TD-327، تصمیم مالک محصول — گزینه ب «با دلیل»): پروژه لغوشده و کالای بیرون از محصولات پروژه تحویل
      // نمی‌شوند، و تحویلی که جمع تحویل‌های پروژه را از مقدار برنامه‌ریزی‌شده بیشتر کند فقط با دلیل ثبت می‌شود. پیش‌تر نه
      // وضعیت پروژه، نه مقدار آن و نه تحویل‌های پیشین سنجیده می‌شد: دو تحویل (هم‌زمان یا پشت هم) پروژه ۵ عددی ۱۰ عدد وارد
      // انبار می‌کرد و کالای در جریان ساخت منفی می‌شد. ردیف پروژه بالاتر قفل شده است، پس تحویل‌های هم‌زمان پشت هم شمرده می‌شوند.
      if (proj.status === 'cancelled') {
        throw new ValidationError(`پروژه «${proj.projectCode}» لغو شده است و محصولی از آن به انبار تحویل نمی‌شود.`);
      }
      const planned = plannedProjectProducts(proj);
      const outside = [...new Set(targetItemIds)].filter(itemId => !planned.has(itemId));
      if (outside.length > 0) {
        throw new ValidationError(`کالای شناسه ${outside.join('، ')} از محصولات پروژه «${proj.projectCode}» نیست و از این پروژه به انبار تحویل نمی‌شود.`);
      }
      const overDeliveryReason = input.overDeliveryReason?.trim() || '';

      const projectLabel = proj.projectCode || `پروژه-${id}`;
      const lines: Array<{ itemId: number; quantity: number; unitPrice: string; location: string }> = [];
      const lineNotes: string[] = [];

      for (const entry of input.itemsToAdd) {
        const itemId = Number(entry.itemId);
        const qty = Number(entry.quantity);
        if (!itemId || !qty || qty <= 0) continue;

        let effectiveUnitPrice: string;
        if (entry.unitPrice !== undefined && entry.unitPrice !== null && !isNaN(Number(entry.unitPrice))) {
          effectiveUnitPrice = String(entry.unitPrice);
        } else {
          const [itemRow] = await tx.select({ weightedAverageCost: items.weightedAverageCost }).from(items).where(eq(items.id, itemId));
          effectiveUnitPrice = itemRow?.weightedAverageCost ? itemRow.weightedAverageCost.toString() : '0';
        }

        lines.push({ itemId, quantity: qty, unitPrice: effectiveUnitPrice, location: entry.location || '' });
        if (entry.notes) lineNotes.push(entry.notes);
      }

      const delivered = await deliveredProjectQuantities(tx, id, [...new Set(lines.map(l => l.itemId))]);
      const overDeliveries = findOverDeliveries(planned, delivered, lines);
      if (overDeliveries.length > 0 && !overDeliveryReason) {
        throw new AppError(
          `تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه «${proj.projectCode}»: ${describeOverDeliveries(overDeliveries)}. برای ثبت، دلیل تحویل بیش از برنامه را وارد کنید.`,
          422, 'OVER_DELIVERY_REASON_REQUIRED', { overDeliveries }
        );
      }
      if (overDeliveries.length > 0) lineNotes.push(`[تحویل بیش از برنامه: ${overDeliveryReason} — ${describeOverDeliveries(overDeliveries)}]`);

      let documentId: number | null = null;
      let refNumber: string | null = null;
      if (lines.length > 0) {
        const created = await DocumentService.createDocumentWithDetails({
          docType: 'production_receipt',
          inOut: 'in',
          status: 'final',
          date: await businessTodayIsoDate(),
          user: currentUser,
          projectId: id,
          location: lines[0].location,
          currency: 'IRR',
          notes: [`تحویل تولید پروژه ${projectLabel}`, ...lineNotes].join(' — '),
          items: lines,
          externalTx: tx,
        }, { userId: input.userId });
        documentId = created.docId;
        const [doc] = await tx.select({ refNumber: documents.refNumber }).from(documents).where(eq(documents.id, documentId));
        refNumber = doc?.refNumber ?? null;
      }

      if (input.markCompleted) {
        ProjectService.assertMatrixCompleted(await ProjectService.getProgressMatrixStatus(id, tx));
        await tx.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, id));
      }

      return { addedCount: lines.length, projectCode: proj.projectCode, documentId, refNumber, overDeliveries };
    });
  }

  /**
   * Adds a stage to a project
   * v9.0.334 (TD-738): زیر قفل ردیف پروژه و با همگام‌سازی مراحل و وضعیت در همان تراکنش (مرحله تازه خانه‌های تازه دارد)
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
    actor: ProjectActor = {},
    executor: DbExecutor = orm
  ): Promise<SyncedStage> {
    return executor.transaction(async (tx) => {
      await lockLiveProject(tx, projectId);
      const existingStages = await tx
        .select()
        .from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

      const nextOrder = existingStages.length + 1;

      const [newStage] = await tx.insert(projectStages).values({
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

      const synced = await ProjectService.syncLockedProject(tx, projectId, actor);
      return synced.stages.find(st => st.id === newStage.id) ?? newStage;
    });
  }

  /**
   * v9.0.333 (TD-739): وضعیت ماتریس پیشرفت با قاعده مشترک (محصولات پروژه، وگرنه کالای اصلی)
   */
  static async getProgressMatrixStatus(projectId: number, executor: DbExecutor = orm): Promise<ProgressMatrixStatus> {
    const [project] = await executor.select().from(productionProjects)
      .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
    if (!project) {
      return { allMatrixCompleted: false, totalMatrixCells: 0, completedMatrixCells: 0, missingMatrixCells: 0, reason: 'پروژه یافت نشد' };
    }
    return progressMatrixStatus(await loadProjectProgressMatrix(executor, project));
  }

  static assertMatrixCompleted(check: ProgressMatrixStatus): void {
    if (check.allMatrixCompleted) return;
    throw new ValidationError(
      `امکان تغییر وضعیت پروژه به تکمیل‌شده وجود ندارد؛ هنوز تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات در بخش «پیشرفت به تفکیک کد کالا» تیک نخورده‌اند (${check.completedMatrixCells} از ${check.totalMatrixCells} مورد تکمیل شده است).`,
      { completedMatrixCells: check.completedMatrixCells, totalMatrixCells: check.totalMatrixCells },
      'PROJECT_MATRIX_INCOMPLETE'
    );
  }

  /** پاسخ ماتریس پیشرفت پروژه («پیشرفت به تفکیک کد کالا»)؛ null برای پروژه ناموجود */
  static async getProductProgressView(projectId: number, executor: DbExecutor = orm): Promise<ReturnType<typeof productProgressView> | null> {
    const [project] = await executor.select().from(productionProjects)
      .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
    if (!project) return null;
    return productProgressView(await loadProjectProgressMatrix(executor, project));
  }

  /**
   * Updates a project stage and syncs status
   * v9.0.334 (TD-738): ویرایش و همگام‌سازی در یک تراکنش زیر قفل ردیف پروژه
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
    actor: ProjectActor = {},
    executor: DbExecutor = orm
  ): Promise<SyncedStage> {
    return executor.transaction(async (tx) => {
      await lockLiveProject(tx, projectId);
      const [existing] = await tx
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

      const [updated] = await tx
        .update(projectStages)
        .set(updateData)
        .where(eq(projectStages.id, stageId))
        .returning();

      const synced = await ProjectService.syncLockedProject(tx, projectId, actor);
      return synced.stages.find(st => st.id === stageId) ?? updated;
    });
  }

  /**
   * Soft deletes a stage from a project
   * v9.0.334 (TD-738): حذف و همگام‌سازی در یک تراکنش زیر قفل ردیف پروژه
   */
  static async deleteStage(
    projectId: number,
    stageId: number,
    actor: ProjectActor = {},
    executor: DbExecutor = orm
  ): Promise<typeof projectStages.$inferSelect> {
    return executor.transaction(async (tx) => {
      await lockLiveProject(tx, projectId);
      const [existing] = await tx
        .select()
        .from(projectStages)
        .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

      if (!existing) {
        throw new NotFoundError('مرحله یافت نشد');
      }

      await tx.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.id, stageId));
      await ProjectService.syncLockedProject(tx, projectId, actor);
      return existing;
    });
  }

  /**
   * Bulk updates product physical progress matrix
   * v9.0.334 (TD-738): تیک‌ها، ردیف ممیزی و همگام‌سازی مراحل و وضعیت در یک تراکنش زیر قفل ردیف پروژه
   */
  static async updateProductProgress(
    projectId: number,
    updates: Array<{
      itemId: number;
      stageOrder: number;
      stageTitle?: string;
      status: string;
    }>,
    actor: ProjectActor = {},
    executor: DbExecutor = orm
  ): Promise<{ applied: number; skippedInvalid: number; projectStatus: string; weightedProgress: number }> {
    return executor.transaction(async (tx) => {
      const project = await lockLiveProject(tx, projectId);
      const currentUser = actorName(actor);

      // v9.0.333 (TD-739): محصولات ماتریس با همان قاعده نمایش و بررسی تکمیل (پروژه تک‌کالایی: کالای اصلی)
      const productByItemId = new Map<number, ReturnType<typeof matrixProducts>[number]>();
      for (const p of matrixProducts(project)) {
        if (p.itemId !== null && !productByItemId.has(p.itemId)) productByItemId.set(p.itemId, p);
      }
      const stageTitles = new Map<number, string>();
      const liveStages = await tx.select({ stageOrder: projectStages.stageOrder, title: projectStages.title }).from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
        .orderBy(asc(projectStages.stageOrder), asc(projectStages.id));
      for (const st of liveStages) if (!stageTitles.has(st.stageOrder)) stageTitles.set(st.stageOrder, st.title);

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

        const stageTitle = stageTitles.get(stageOrder) || String(u.stageTitle || '').trim() || `مرحله ${stageOrder}`;

        await tx.insert(projectProductStageProgress).values({
          projectId,
          itemId,
          itemCode: product.itemCode,
          itemName: product.itemName,
          quantity: product.quantity,
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
            quantity: product.quantity,
            updatedAt: bizNow,
            updatedByName: currentUser
          }
        });
        applied++;
      }

      await logActivity({
        tx,
        req: actor.req,
        userId: actor.userId,
        username: actor.username,
        userFullName: actor.userFullName,
        action: 'UPDATE',
        entity: 'پیشرفت به تفکیک کد کالا',
        entityId: String(projectId),
        description: `بروزرسانی پیشرفت ماتریسی SKU×مرحله پروژه ${project.projectCode || projectId}: ${applied} تغییر اعمال شد`
      });

      const synced = await syncProjectFromMatrix(tx, project, actor);
      return { applied, skippedInvalid, projectStatus: String(synced.project.status), weightedProgress: synced.weightedProgress };
    });
  }

  /** همگام‌سازی مراحل و وضعیت پروژه‌ای که همین تراکنش قفل کرده است (ردیف پس از نوشتن دوباره خوانده می‌شود) */
  private static async syncLockedProject(tx: DbExecutor, projectId: number, actor: ProjectActor): Promise<ProjectStatusSyncResult> {
    return syncProjectFromMatrix(tx, await lockLiveProject(tx, projectId), actor);
  }
}
