import { eq, and, asc, ne, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { productionProjects, projectStages, items, customers, projectProductStageProgress, documents } from '../db/schema.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors/customErrors.js';
import { deliveredProjectQuantities, describeOverDeliveries, findOverDeliveries, plannedProjectProducts, type ProjectOverDelivery } from './projects/projectDeliveryCap.js';
import { withOrderedLocks } from '../lib/lockOrder.js';
import { DocumentService } from './document.service.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../lib/businessClock.js';
import { requireStorageDate, optionalStorageDate } from '../lib/storageDate.js';
import { AttachmentStorageService } from './attachments/attachmentStorage.service.js';
import { resolveServerInventoryControl } from './projects/serverInventoryControl.js';
import { assignProjectCode } from './projects/projectCode.js';
import { keepScheduleLogLinks } from '../lib/projects/scheduleWorkLog.js';
import { hasMatrixProducts, matrixProducts } from '../lib/projects/progressMatrix.js';
import { loadProjectProgressMatrix, productProgressView, progressMatrixStatus, type ProgressMatrixStatus } from './projects/projectProgressMatrix.js';
import { actorName, lockLiveProject, stageCompletedAt, syncProjectFromMatrix, type ProjectActor, type ProjectStatusSyncResult, type SyncedStage } from './projects/projectStatusSync.js';
import { logActivity } from '../lib/auditLogger.js';
import { logProjectUpdate, logStageChange } from './projects/projectAudit.js';
import { MAX_STAGE_ORDER } from '../lib/projects/projectStatus.js';
import { toPersianDigits } from '../utils/persianNumber.js';
import { normalizeDecimalString } from '../lib/numericInput.js';
import { nextVersion } from '../lib/occHelper.js';
import { assertProjectVersion, projectVersionConflict } from './projects/projectVersion.js';
import { assertNoOpenAllocations } from './projects/projectOpenAllocations.js';
import { assertProjectDeletable } from './projects/projectDeleteGuard.js';

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
  /** v9.0.385 (TD-742): نسخه‌ای که فرم از آن ساخته شده؛ مسیر `PUT /projects/:id` همیشه می‌فرستد */
  expectedVersion?: number;
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

/** عدد ورودی با رقم فارسی و جداکننده؛ خالی یعنی فرستاده نشده (undefined) و نامعتبر null */
const decimalOf = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = normalizeDecimalString(String(value));
  if (text === '') return undefined;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

/**
 * v9.0.381 (TD-741): مقدار پروژه عددی بزرگ‌تر از صفر است (رقم فارسی خوانده می‌شود)؛ پیش‌تر «۱۲» ستون مقدار را NaN می‌کرد.
 * خالی یعنی بی‌تغییر (در ساخت: ۱).
 */
export function projectQuantity(value: unknown): number | undefined {
  const num = decimalOf(value);
  if (num === undefined) return undefined;
  if (num === null || num <= 0) {
    throw new ValidationError(`مقدار پروژه باید عددی بزرگ‌تر از صفر باشد (مقدار دریافتی: ${String(value)})`, undefined, 'PROJECT_QUANTITY_INVALID');
  }
  return num;
}

/** v9.0.381 (TD-741): یک ردیف «ورود به انبار»: کالا، مقدار مثبت و بهای اختیاری نامنفی، وگرنه ۴۲۲ با شماره ردیف */
function deliveryLine(entry: AddProjectToInventoryInput['itemsToAdd'][number], index: number): { itemId: number; qty: number; unitPrice: string | null } {
  const row = `ردیف ${toPersianDigits(index + 1)} ورود به انبار`;
  const itemId = Number(entry.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new ValidationError(`${row}: کالای تحویلی مشخص نیست`, { row: index + 1 }, 'PROJECT_DELIVERY_LINE_INVALID');
  }
  const qty = decimalOf(entry.quantity);
  if (qty === undefined || qty === null || qty <= 0) {
    throw new ValidationError(`${row}: مقدار تحویل باید عددی بزرگ‌تر از صفر باشد (مقدار دریافتی: ${String(entry.quantity ?? '')})`, { row: index + 1 }, 'PROJECT_DELIVERY_LINE_INVALID');
  }
  const price = decimalOf(entry.unitPrice);
  if (price === null || (price !== undefined && price < 0)) {
    throw new ValidationError(`${row}: بهای واحد باید عددی نامنفی باشد (مقدار دریافتی: ${String(entry.unitPrice)})`, { row: index + 1 }, 'PROJECT_DELIVERY_LINE_INVALID');
  }
  return { itemId, qty, unitPrice: price === undefined ? null : normalizeDecimalString(String(entry.unitPrice)) };
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
      quantity: projectQuantity(input.quantity) ?? 1,
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
    // v9.0.385 (TD-742، تصمیم ت۳ الف): ویرایش از نسخه کهنه ۴۰۹ است و هر ذخیره نسخه را یکی بالا می‌برد؛ پیش‌تر ذخیره دوم دو
    // کاربر ذخیره اول را بی‌صدا پاک می‌کرد
    if (input.expectedVersion !== undefined) assertProjectVersion(existing, input.expectedVersion);

    const updateData: Record<string, unknown> = { version: nextVersion(existing.version) };
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
    const quantity = projectQuantity(input.quantity);
    if (quantity !== undefined) updateData.quantity = quantity;
    if (input.unit !== undefined) updateData.unit = input.unit;
    if (input.startDate !== undefined) updateData.startDate = optionalStorageDate(input.startDate, 'تاریخ شروع پروژه');
    if (input.endDate !== undefined) updateData.endDate = optionalStorageDate(input.endDate, 'تاریخ پایان پروژه');
    if (input.status !== undefined) updateData.status = input.status;
    // v9.0.410 (TD-759، تصمیم ت۹ الف): پروژه‌ای که تخصیص مواد باز دارد مثل حذف (TD-412) لغو نمی‌شود
    if (input.status === 'cancelled' && existing.status !== 'cancelled') await assertNoOpenAllocations(executor, existing, 'لغو نمی‌شود');
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.products !== undefined) updateData.products = Array.isArray(input.products) ? input.products : [];
    if (input.inventoryControl !== undefined) {
      const products = input.products !== undefined ? updateData.products : existing.products;
      updateData.inventoryControl = await resolveServerInventoryControl(input.inventoryControl, existing.inventoryControl, products, executor, Number(existing.id));
    }
    // v9.0.282 (TD-736): پیوند کارکرد هر ردیف برنامه را فقط سرور (ثبت و حذف کارکرد) می‌نویسد
    if (input.stageSchedules !== undefined) updateData.stageSchedules = keepScheduleLogLinks(input.stageSchedules, existing.stageSchedules);
    if (input.customStages !== undefined) updateData.customStages = input.customStages;
    if (input.attachments !== undefined) {
      // v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک؛ ستون attachments فقط فراداده
      updateData.attachments = await AttachmentStorageService.normalizeForRecord(executor, 'production_project', id, input.attachments);
    }

    const [current] = await executor.update(productionProjects).set(updateData)
      .where(and(eq(productionProjects.id, id), eq(productionProjects.version, existing.version))).returning();
    if (!current) throw projectVersionConflict(id, existing.version);

    // v9.0.364 (TD-739): تکمیل دستی پروژه با همان قاعده ماتریس، درون همین تراکنش و روی ردیف ذخیره‌شده
    if (input.status === 'completed' && existing.status !== 'completed') {
      ProjectService.assertMatrixCompleted(progressMatrixStatus(await loadProjectProgressMatrix(executor, current)));
    }

    // v9.0.383 (TD-757): ردیف ممیزی ویرایش با پیش و پس فیلدهای تغییرکرده، با همین تراکنش
    await logProjectUpdate(executor, actor, existing, current);

    // v9.0.365 (TD-738): ویرایش پروژه (محصولات، کالای اصلی) مراحل و وضعیت را زیر همین قفل با ماتریس همگام می‌کند
    const synced = await syncProjectFromMatrix(executor, current, actor);
    return { previous: existing, current: synced.project };
  }

  /**
   * Soft deletes a production project and its stages
   */
  static async deleteProject(id: number, executor: DbExecutor = orm): Promise<typeof productionProjects.$inferSelect> {
    return executor.transaction(async (tx) => {
      // v8.0.121 (TD-412): پروژه‌ای که تخصیص مواد باز دارد حذف نمی‌شود (assertNoOpenAllocations)
      const [existing] = await tx.select().from(productionProjects)
        .where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)))
        .for('update');
      if (!existing) {
        throw new NotFoundError('پروژه یافت نشد');
      }
      // v10.0.24 (TD-922): سند زنده یا مانده ۱۴۰۲ هم حذف را رد می‌کند
      await assertProjectDeletable(tx, existing);

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

      for (const [index, entry] of input.itemsToAdd.entries()) {
        // v9.0.381 (TD-741): ردیف بی کالا، با مقدار غیرمثبت یا بهای نامعتبر کل تحویل را با ۴۲۲ رد می‌کند؛ پیش‌تر بی‌صدا کنار
        // گذاشته می‌شد (پاسخ ۲۰۰ «با موفقیت افزوده شدند» با صفر قلم) و بهای نامعتبر به میانگین موزون برمی‌گشت
        const { itemId, qty, unitPrice } = deliveryLine(entry, index);
        let effectiveUnitPrice: string;
        if (unitPrice !== null) {
          effectiveUnitPrice = unitPrice;
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
        await tx.update(productionProjects).set({ status: 'completed', version: nextVersion(proj.version) }).where(eq(productionProjects.id, id));
      }

      return { addedCount: lines.length, projectCode: proj.projectCode, documentId, refNumber, overDeliveries };
    });
  }

  /**
   * Adds a stage to a project
   * v9.0.365 (TD-738): زیر قفل ردیف پروژه و با همگام‌سازی مراحل و وضعیت در همان تراکنش (مرحله تازه خانه‌های تازه دارد)
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
      const project = await lockLiveProject(tx, projectId);
      const nextOrder = await ProjectService.nextStageOrder(tx, projectId);

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
      const stage = synced.stages.find(st => st.id === newStage.id) ?? newStage;
      // v9.0.383 (TD-757): افزودن مرحله ردیف ممیزی با پس مرحله دارد، با همین تراکنش
      await logStageChange(tx, actor, 'CREATE', project, null, stage);
      return stage;
    });
  }

  /**
   * v9.0.367 (TD-737): شماره مرحله تازه پس از هر شماره‌ای که پروژه به کار برده است (مراحل حذف‌شده و ردیف‌های پیشرفت هم
   * شمرده می‌شوند)، زیر قفل ردیف پروژه. پیش‌تر «تعداد مراحل زنده + ۱» بود: مرحله تازه شماره مرحله حذف‌شده و تیک‌هایش را
   * می‌گرفت و افزودن هم‌زمان یا پس از حذف مرحله میانی دو مرحله با یک شماره می‌ساخت.
   */
  private static async nextStageOrder(tx: DbExecutor, projectId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT GREATEST(
        (SELECT COALESCE(MAX(stage_order), 0) FROM project_stages WHERE project_id = ${projectId}),
        (SELECT COALESCE(MAX(stage_order), 0) FROM project_product_stage_progress WHERE project_id = ${projectId})
      )::int AS used
    `);
    return Number((res.rows?.[0] as { used?: number } | undefined)?.used ?? 0) + 1;
  }

  /**
   * v9.0.368 (TD-755): شماره تازه مرحله، زیر قفل ردیف پروژه. شماره‌ای که مرحله زنده دیگری دارد یا ردیف پیشرفت مرحله‌ای
   * حذف‌شده روی آن مانده است با ۴۰۹ `STAGE_ORDER_TAKEN` رد می‌شود (پیش‌تر دو مرحله شماره ۱ می‌گرفتند)، و تیک‌های زنده
   * مرحله با آن جابه‌جا می‌شوند، مگر مرحله زنده دیگری (داده قدیمی) شماره پیشین را هم دارد.
   */
  private static async moveStageOrder(tx: DbExecutor, stage: typeof projectStages.$inferSelect, target: number): Promise<number> {
    if (!Number.isSafeInteger(target) || target < 1 || target > MAX_STAGE_ORDER) {
      throw new ValidationError(`شماره مرحله باید عدد صحیح ۱ تا ${toPersianDigits(MAX_STAGE_ORDER)} باشد`, { stageOrder: target }, 'STAGE_ORDER_INVALID');
    }
    const [holder] = await tx.select({ id: projectStages.id, title: projectStages.title }).from(projectStages)
      .where(and(eq(projectStages.projectId, stage.projectId), eq(projectStages.stageOrder, target), eq(projectStages.isDeleted, 0), ne(projectStages.id, stage.id)))
      .limit(1);
    if (holder) {
      throw new ConflictError(`شماره ${toPersianDigits(target)} به مرحله «${holder.title}» همین پروژه داده شده است؛ شماره دیگری انتخاب کنید.`, { stageOrder: target, stageId: holder.id }, 'STAGE_ORDER_TAKEN');
    }
    const [usedByDeleted] = await tx.select({ id: projectProductStageProgress.id }).from(projectProductStageProgress)
      .where(and(eq(projectProductStageProgress.projectId, stage.projectId), eq(projectProductStageProgress.stageOrder, target)))
      .limit(1);
    if (usedByDeleted) {
      throw new ConflictError(`شماره ${toPersianDigits(target)} پیش‌تر به مرحله‌ای حذف‌شده از این پروژه داده شده و پیشرفت آن ثبت مانده است؛ شماره دیگری انتخاب کنید.`, { stageOrder: target }, 'STAGE_ORDER_TAKEN');
    }
    const [sharer] = await tx.select({ id: projectStages.id }).from(projectStages)
      .where(and(eq(projectStages.projectId, stage.projectId), eq(projectStages.stageOrder, stage.stageOrder), eq(projectStages.isDeleted, 0), ne(projectStages.id, stage.id)))
      .limit(1);
    if (!sharer) {
      await tx.update(projectProductStageProgress).set({ stageOrder: target })
        .where(and(eq(projectProductStageProgress.projectId, stage.projectId), eq(projectProductStageProgress.stageOrder, stage.stageOrder), eq(projectProductStageProgress.isDeleted, 0)));
    }
    return target;
  }

  /**
   * v9.0.364 (TD-739): وضعیت ماتریس پیشرفت با قاعده مشترک (محصولات پروژه، وگرنه کالای اصلی)
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
   * v9.0.365 (TD-738): ویرایش و همگام‌سازی در یک تراکنش زیر قفل ردیف پروژه
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
      const project = await lockLiveProject(tx, projectId);
      const [existing] = await tx
        .select()
        .from(projectStages)
        .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

      if (!existing) {
        throw new NotFoundError('مرحله یافت نشد');
      }

      // v9.0.366 (TD-758، تصمیم ت۱ الف): در پروژه دارای ماتریس پیشرفت وضعیت و درصد مرحله را فقط ماتریس تعیین می‌کند؛
      // مقدار دستی متفاوت رد می‌شود (پیش‌تر ۲۰۰ می‌گرفت و همگام‌ساز بی‌صدا برش می‌گرداند) و مقدار برابر نادیده می‌ماند
      if (hasMatrixProducts(project)) {
        const statusChanged = data.status !== undefined && data.status !== existing.status;
        const percentChanged = data.progressPercent !== undefined && Number(data.progressPercent) !== Number(existing.progressPercent ?? 0);
        if (statusChanged || percentChanged) {
          throw new ValidationError(
            `وضعیت و درصد پیشرفت مرحله «${existing.title}» از ماتریس «پیشرفت به تفکیک کد کالا» محاسبه می‌شود و دستی تغییر نمی‌کند؛ خانه‌های این مرحله را در ماتریس تیک بزنید.`,
            { stageId, status: existing.status, progressPercent: existing.progressPercent },
            'STAGE_STATUS_FROM_MATRIX'
          );
        }
        data = { ...data, status: undefined, progressPercent: undefined };
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.title = data.title.trim();
      if (data.stageOrder !== undefined && Number(data.stageOrder) !== existing.stageOrder) {
        updateData.stageOrder = await ProjectService.moveStageOrder(tx, existing, Number(data.stageOrder));
      }
      if (data.progressPercent !== undefined && !(Number.isInteger(Number(data.progressPercent)) && Number(data.progressPercent) >= 0 && Number(data.progressPercent) <= 100)) {
        throw new ValidationError('درصد پیشرفت مرحله باید عدد صحیح ۰ تا ۱۰۰ باشد', { progressPercent: data.progressPercent }, 'STAGE_PERCENT_INVALID');
      }
      if (data.status !== undefined) {
        updateData.status = data.status;
        if (data.status === 'completed') updateData.progressPercent = 100;
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
        } else if (p > 0 && p < 100 && existing.status === 'pending') {
          updateData.status = 'in_progress';
        }
      }
      if (data.notes !== undefined) updateData.notes = data.notes;
      // v9.0.382 (TD-756): زمان تکمیل مرحله با یک ساعت، ساعت UTC سرور (`systemNowUtcIso`، مانند همگام‌ساز ماتریس)؛ پیش‌تر
      // این مسیر UTC با Z و همگام‌ساز ساعت دیواری تهران بی منطقه می‌نوشت (۲۱۰ دقیقه اختلاف). مرحله تکمیل‌شده زمانش را نگه
      // می‌دارد و مرحله‌ای که از «تکمیل‌شده» بیرون می‌رود زمان تکمیل ندارد.
      if (updateData.status !== undefined) {
        updateData.completedAt = stageCompletedAt(existing, String(updateData.status), systemNowUtcIso());
      }

      const [updated] = await tx
        .update(projectStages)
        .set(updateData)
        .where(eq(projectStages.id, stageId))
        .returning();

      const synced = await ProjectService.syncLockedProject(tx, projectId, actor);
      const stage = synced.stages.find(st => st.id === stageId) ?? updated;
      // v9.0.383 (TD-757): ویرایش مرحله ردیف ممیزی با پیش و پس دارد، با همین تراکنش
      await logStageChange(tx, actor, 'UPDATE', project, existing, stage);
      return stage;
    });
  }

  /**
   * Soft deletes a stage from a project
   * v9.0.365 (TD-738): حذف و همگام‌سازی در یک تراکنش زیر قفل ردیف پروژه
   */
  static async deleteStage(
    projectId: number,
    stageId: number,
    actor: ProjectActor = {},
    executor: DbExecutor = orm
  ): Promise<typeof projectStages.$inferSelect> {
    return executor.transaction(async (tx) => {
      const project = await lockLiveProject(tx, projectId);
      const [existing] = await tx
        .select()
        .from(projectStages)
        .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

      if (!existing) {
        throw new NotFoundError('مرحله یافت نشد');
      }

      await tx.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.id, stageId));
      // v9.0.367 (TD-737): تیک‌های مرحله حذف‌شده هم حذف نرم می‌شوند، مگر مرحله زنده دیگری (داده قدیمی) همان شماره را دارد
      const [sameOrder] = await tx.select({ id: projectStages.id }).from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), eq(projectStages.stageOrder, existing.stageOrder), eq(projectStages.isDeleted, 0), ne(projectStages.id, stageId)))
        .limit(1);
      if (!sameOrder) {
        await tx.update(projectProductStageProgress).set({ isDeleted: 1 })
          .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.stageOrder, existing.stageOrder), eq(projectProductStageProgress.isDeleted, 0)));
      }
      await ProjectService.syncLockedProject(tx, projectId, actor);
      // v9.0.383 (TD-757): حذف مرحله ردیف ممیزی با پیش مرحله دارد، با همین تراکنش
      await logStageChange(tx, actor, 'DELETE', project, existing, null);
      return existing;
    });
  }

  /**
   * Bulk updates product physical progress matrix
   * v9.0.365 (TD-738): تیک‌ها، ردیف ممیزی و همگام‌سازی مراحل و وضعیت در یک تراکنش زیر قفل ردیف پروژه
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

      // v9.0.364 (TD-739): محصولات ماتریس با همان قاعده نمایش و بررسی تکمیل (پروژه تک‌کالایی: کالای اصلی)
      const productByItemId = new Map<number, ReturnType<typeof matrixProducts>[number]>();
      for (const p of matrixProducts(project)) {
        if (p.itemId !== null && !productByItemId.has(p.itemId)) productByItemId.set(p.itemId, p);
      }
      const stageTitles = new Map<number, string>();
      const liveStages = await tx.select({ stageOrder: projectStages.stageOrder, title: projectStages.title }).from(projectStages)
        .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
        .orderBy(asc(projectStages.stageOrder), asc(projectStages.id));
      for (const st of liveStages) if (!stageTitles.has(st.stageOrder)) stageTitles.set(st.stageOrder, st.title);

      // v9.0.382 (TD-756): مهر تیک ماتریس ساعت UTC سرور است، نه ساعت دیواری تهران بی منطقه
      const updatedAt = systemNowUtcIso();
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
        // v9.0.367 (TD-737): تیک فقط برای مرحله زنده؛ تیک شماره‌ای بی مرحله بعدها به مرحله تازه به ارث نمی‌رسد
        const stageTitle = stageTitles.get(stageOrder);
        if (!product || stageTitle === undefined) {
          skippedInvalid++;
          continue;
        }

        await tx.insert(projectProductStageProgress).values({
          projectId,
          itemId,
          itemCode: product.itemCode,
          itemName: product.itemName,
          quantity: product.quantity,
          stageOrder,
          stageTitle,
          status: u.status,
          updatedAt,
          updatedByName: currentUser,
          isDeleted: 0
        }).onConflictDoUpdate({
          target: [projectProductStageProgress.projectId, projectProductStageProgress.itemId, projectProductStageProgress.stageOrder],
          set: {
            status: u.status,
            stageTitle,
            quantity: product.quantity,
            updatedAt,
            updatedByName: currentUser,
            isDeleted: 0
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
