import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { productionProjects, projectStages, items } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { READ_PERMISSIONS, RECORD_READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PROJECT_CREATE_PERMISSIONS, PROJECT_DELETE_PERMISSIONS, PROJECT_EDIT_PERMISSIONS } from '../lib/permissions/projectPermissions.js';
import { parsePickListLimit } from '../lib/pagination.js';
import { listProjectPicks } from '../services/projects/projectPickList.js';
import { listProjectPage } from '../services/projects/projectList.js';
import { PROJECT_LIST_MAX_LIMIT, PROJECT_LIST_PRIORITY_FILTERS, PROJECT_LIST_STATUS_FILTERS, projectStageProgress } from '../lib/projects/projectList.js';
import { logActivity } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, decimalInput } from '../middleware/validate.js';
import { ProjectService } from '../services/projects.service.js';
import { idempotency } from '../middleware/idempotency.js';
import { PRODUCT_PROGRESS_STATUSES, type ProductProgressStatus } from '../lib/projects/progressMatrix.js';
import { MAX_STAGE_ORDER, PROJECT_PRIORITIES, PROJECT_STATUSES, STAGE_STATUSES } from '../lib/projects/projectStatus.js';
import { toPersianDigits } from '../utils/persianNumber.js';
import { ValidationError } from '../errors/customErrors.js';
import { PROJECT_VERSION_REQUIRED_MESSAGE } from '../lib/projects/projectVersion.js';

const router = Router();
router.use(authenticateToken);

const deleteProjectStageSchema = z.object({
  params: z.object({
    id: numericIdString,
    stageId: numericIdString,
  })
});

const createProjectSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان پروژه الزامی است'),
    project_code: z.string().optional(),
    customer_id: z.union([z.number(), z.string(), z.null()]).optional(),
    customer_name: z.string().optional(),
    item_id: z.union([z.number(), z.string(), z.null()]).optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    // v9.0.381 (TD-741): رقم فارسی خوانده می‌شود و متن ۴۰۰ است؛ پیش‌تر «۱۲» ستون مقدار را NaN می‌کرد
    quantity: decimalInput('مقدار پروژه').optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    // v9.0.380 (TD-754): وضعیت و اولویت فقط از فهرست رابط؛ پیش‌تر متن آزاد («Completed»، «خیلی فوری») ذخیره می‌شد
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    description: z.string().optional(),
    initial_stages: z.array(z.object({ status: z.enum(STAGE_STATUSES).optional() }).catchall(z.unknown())).optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
  })
});

const recordVersion = z.coerce.number().int('نسخه رکورد پروژه باید عدد صحیح باشد').positive('نسخه رکورد پروژه باید مثبت باشد');

const updateProjectSchema = z.object({
  body: z.object({
    // v9.0.385 (TD-742، تصمیم ت۳ الف): نسخه‌ای که فرم از آن ساخته شده الزامی است؛ ناهمخوانی ۴۰۹ OCC_CONFLICT
    version: recordVersion.optional(),
    title: z.string().optional(),
    project_code: z.string().optional(),
    customer_id: z.union([z.number(), z.string(), z.null()]).optional(),
    customer_name: z.string().optional(),
    item_id: z.union([z.number(), z.string(), z.null()]).optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    // v9.0.381 (TD-741): رقم فارسی خوانده می‌شود و متن ۴۰۰ است؛ پیش‌تر «۱۲» ستون مقدار را NaN می‌کرد
    quantity: decimalInput('مقدار پروژه').optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    description: z.string().optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
    // v9.0.384 (TD-740، تصمیم ت۲ الف): مراحل با ویرایش پروژه تغییر نمی‌کنند؛ فرستادن آن‌ها ۴۲۲ است، نه دور ریختن بی‌صدا
    initial_stages: z.unknown().optional(),
  }).refine(b => b.version !== undefined, { message: PROJECT_VERSION_REQUIRED_MESSAGE, path: ['version'] }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const addProjectToInventorySchema = z.object({
  body: z.preprocess((val: unknown) => {
    if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
        if (!v.itemsToAdd && (v.itemId || v.item_id)) {
        return {
          itemsToAdd: [{
            itemId: v.itemId || v.item_id,
            quantity: v.quantity,
            location: v.location,
            notes: v.description || v.notes,
            unitPrice: v.unitPrice || v.unit_price
          }],
          markCompleted: Boolean(v.markCompleted)
        };
      }
    }
    return val;
  }, z.object({
    // v9.0.381 (TD-741): مقدار و بها با رقم فارسی خوانده می‌شوند و متن ۴۰۰ است؛ ردیف بی مقدار مثبت ۴۲۲ می‌گیرد، نه رد بی‌صدا
    itemsToAdd: z.array(z.object({
      itemId: z.union([z.number(), z.string()]),
      quantity: decimalInput('مقدار تحویل'),
      location: z.string().optional(),
      notes: z.string().optional(),
      unitPrice: decimalInput('بهای واحد تحویل').optional()
    })).min(1, 'حداقل یک محصول برای ورود به انبار الزامی است'),
    markCompleted: z.boolean().optional(),
    // v8.0.72 (TD-327): دلیل تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه
    overDeliveryReason: z.string().max(500).optional()
  })),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const createProjectStageSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان مرحله الزامی است'),
    status: z.enum(STAGE_STATUSES).optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_personnel: z.array(z.unknown()).optional(),
    required_resources: z.array(z.unknown()).optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

// v9.0.368 (TD-755): شماره مرحله عدد صحیح مثبت و درصد پیشرفت عدد صحیح ۰ تا ۱۰۰؛ پیش‌تر متن نامعتبر ۵۰۰ با متن SQL می‌داد
const stageOrderInput = decimalInput('شماره مرحله')
  .refine(v => v === undefined || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_STAGE_ORDER), `شماره مرحله باید عدد صحیح ۱ تا ${toPersianDigits(MAX_STAGE_ORDER)} باشد`);
const stagePercentInput = decimalInput('درصد پیشرفت مرحله')
  .refine(v => v === undefined || (/^\d+$/.test(v) && Number(v) <= 100), 'درصد پیشرفت مرحله باید عدد صحیح ۰ تا ۱۰۰ باشد');

const updateProjectStageSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    stage_order: stageOrderInput.optional(),
    status: z.enum(STAGE_STATUSES).optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_personnel: z.array(z.unknown()).optional(),
    required_resources: z.array(z.unknown()).optional(),
    progress_percent: stagePercentInput.optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است'),
    stageId: z.string().regex(/^\d+$/, 'شناسه مرحله نامعتبر است')
  })
});

export interface FormattedStage {
  id?: number;
  projectId: number;
  stageOrder: number;
  title: string;
  status: string;
  startDate: string;
  endDate: string;
  assignedPersonnel: unknown[];
  requiredResources: unknown[];
  progressPercent: number;
  notes: string;
  completedAt: string;
  isDeleted: number;
  completedSkusCount?: number;
  applicableSkusCount?: number;

  // Compatibility aliases for legacy consumers
  project_id?: number;
  stage_order?: number;
  start_date?: string;
  end_date?: string;
  assigned_personnel?: unknown[];
  required_resources?: unknown[];
  progress_percent?: number;
  completed_at?: string;
  is_deleted?: number;
  completed_skus_count?: number;
  applicable_skus_count?: number;
}

export interface StageLike {
  id?: number;
  projectId?: number | null;
  project_id?: number | null;
  stageOrder?: number | null;
  stage_order?: number | null;
  title?: string | null;
  status?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  assignedPersonnel?: unknown;
  assigned_personnel?: unknown;
  requiredResources?: unknown;
  required_resources?: unknown;
  progressPercent?: number | null;
  progress_percent?: number | null;
  notes?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  completedSkusCount?: number | null;
  completed_skus_count?: number | null;
  applicableSkusCount?: number | null;
  applicable_skus_count?: number | null;
}

export function formatStage(s: StageLike | null | undefined): FormattedStage | null {
  if (!s) return null;
  const projectId = Number(s.projectId ?? s.project_id ?? 0);
  const stageOrder = Number(s.stageOrder ?? s.stage_order ?? 1);
  const startDate = String(s.startDate ?? s.start_date ?? '');
  const endDate = String(s.endDate ?? s.end_date ?? '');
  const completedAt = String(s.completedAt ?? s.completed_at ?? '');
  const assignedPersonnel = Array.isArray(s.assignedPersonnel) 
    ? s.assignedPersonnel 
    : (Array.isArray(s.assigned_personnel) ? s.assigned_personnel : []);
  const requiredResources = Array.isArray(s.requiredResources) 
    ? s.requiredResources 
    : (Array.isArray(s.required_resources) ? s.required_resources : []);
  const progressPercent = Number(s.progressPercent ?? s.progress_percent ?? 0);
  const compSkus = s.completedSkusCount ?? s.completed_skus_count;
  const appSkus = s.applicableSkusCount ?? s.applicable_skus_count;
  const isDeleted = Number(s.isDeleted ?? s.is_deleted ?? 0);

  return {
    id: s.id,
    projectId,
    stageOrder,
    title: s.title || '',
    status: s.status || 'pending',
    startDate,
    endDate,
    assignedPersonnel,
    requiredResources,
    progressPercent,
    notes: s.notes || '',
    completedAt,
    isDeleted,
    completedSkusCount: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    applicableSkusCount: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined,

    // Aliases
    project_id: projectId,
    stage_order: stageOrder,
    start_date: startDate,
    end_date: endDate,
    assigned_personnel: assignedPersonnel,
    required_resources: requiredResources,
    progress_percent: progressPercent,
    completed_at: completedAt,
    is_deleted: isDeleted,
    completed_skus_count: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    applicable_skus_count: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined,
  };
}

export interface ProjectLike {
  id: number;
  projectCode?: string | null;
  project_code?: string | null;
  title?: string | null;
  customerId?: number | null;
  customer_id?: number | null;
  customerName?: string | null;
  customer_name?: string | null;
  itemId?: number | null;
  item_id?: number | null;
  itemCode?: string | null;
  item_code?: string | null;
  itemName?: string | null;
  item_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  status?: string | null;
  priority?: string | null;
  description?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  createdBy?: string | null;
  created_by?: string | null;
  products?: unknown;
  inventoryControl?: unknown;
  inventory_control?: unknown;
  stageSchedules?: unknown;
  stage_schedules?: unknown;
  customStages?: unknown;
  custom_stages?: unknown;
  attachments?: unknown;
  isDeleted?: number | null;
  is_deleted?: number | null;
  version?: number | null;
  itemImage?: string | null;
  itemThumbnail?: string | null;
  item_image?: string | null;
}

export function formatProject(
  p: ProjectLike | null | undefined,
  rawStages: StageLike[] = [],
  extra: { itemImage?: string | null; itemThumbnail?: string | null; item_image?: string | null } = {}
) {
  if (!p) return null;
  const stages = (rawStages || []).map(formatStage).filter((s): s is FormattedStage => s !== null);
  // v9.0.388 (TD-743): همان قاعده پیشرفت فهرست پروژه‌ها
  const { totalStages, completedStages, progressPercent: overallProgress } = projectStageProgress(stages);

  const projectCode = p.projectCode ?? p.project_code ?? '';
  const customerId = p.customerId ?? p.customer_id ?? null;
  const customerName = p.customerName ?? p.customer_name ?? '';
  const itemId = p.itemId ?? p.item_id ?? null;
  const itemCode = p.itemCode ?? p.item_code ?? '';
  const itemName = p.itemName ?? p.item_name ?? '';
  const quantity = typeof p.quantity === 'number' ? p.quantity : (Number(p.quantity) || 1);
  const unit = p.unit || 'عدد';
  const startDate = p.startDate ?? p.start_date ?? '';
  const endDate = p.endDate ?? p.end_date ?? '';
  const status = p.status || 'planned';
  const priority = p.priority || 'medium';
  const description = p.description || '';
  const createdAt = p.createdAt ?? p.created_at ?? '';
  const createdBy = p.createdBy ?? p.created_by ?? '';
  const products = Array.isArray(p.products) ? p.products : [];
  const inventoryControl = p.inventoryControl ?? p.inventory_control ?? {};
  const stageSchedules = p.stageSchedules ?? p.stage_schedules ?? {};
  const customStages = Array.isArray(p.customStages) ? p.customStages : (Array.isArray(p.custom_stages) ? p.custom_stages : []);
  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  const isDeleted = p.isDeleted ?? p.is_deleted ?? 0;
  const itemImage = extra.item_image || extra.itemThumbnail || extra.itemImage || p.item_image || p.itemThumbnail || p.itemImage || '';

  return {
    id: p.id,
    projectCode,
    title: p.title || '',
    customerId,
    customerName,
    itemId,
    itemCode,
    itemName,
    quantity,
    unit,
    startDate,
    endDate,
    status,
    priority,
    description,
    createdAt,
    createdBy,
    products,
    inventoryControl,
    stageSchedules,
    customStages,
    attachments,
    isDeleted,
    // v9.0.385 (TD-742): نسخه‌ای که ویرایش بعدی می‌فرستد
    version: p.version ?? 1,
    itemImage,
    stages,
    totalStages,
    completedStages,
    progressPercent: overallProgress,

    // Aliases
    project_code: projectCode,
    customer_id: customerId,
    customer_name: customerName,
    item_id: itemId,
    item_code: itemCode,
    item_name: itemName,
    start_date: startDate,
    end_date: endDate,
    created_at: createdAt,
    created_by: createdBy,
    inventory_control: inventoryControl,
    stage_schedules: stageSchedules,
    custom_stages: customStages,
    is_deleted: isDeleted,
    item_image: itemImage,
    total_stages: totalStages,
    completed_stages: completedStages,
    progress_percent: overallProgress,
  };
}

const projectPickListValidation = z.object({
  query: z.object({
    status: z.string().max(40).optional(),
    search: z.string().max(200).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

// v9.0.139 (TD-889، تصمیم ت۱۰ الف): فهرست انتخاب پروژه برای فرم‌های بخش‌های دیگر؛ فهرست کامل پایین فقط با projects.view
router.get('/projects/options', authorizePermission(...READ_PERMISSIONS.projectOptions), validate(projectPickListValidation), asyncHandler(async (req, res) => {
  const query = req.query as { status?: string; search?: string; limit?: string };
  res.json({ success: true, data: await listProjectPicks({ status: query.status, search: query.search, limit: parsePickListLimit(query.limit) }) });
}));

const projectListValidation = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(PROJECT_LIST_MAX_LIMIT).optional(),
    search: z.string().max(200).optional(),
    status: z.enum(PROJECT_LIST_STATUS_FILTERS).optional(),
    priority: z.enum(PROJECT_LIST_PRIORITY_FILTERS).optional(),
  }),
});

// v9.0.388 (TD-743): یک صفحه خلاصه با صافی‌های SQL؛ پرونده کامل فقط در GET /projects/:id
router.get('/projects', authorizePermission(...READ_PERMISSIONS.projects), validate(projectListValidation), asyncHandler(async (req, res) => {
  const query = req.query as { page?: number; limit?: number; search?: string; status?: string; priority?: string };
  res.json(await listProjectPage(query));
}));

// GET /api/projects/:id - Get single project details with stages
router.get('/projects/:id', authorizePermission(...RECORD_READ_PERMISSIONS.production_project), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    // v9.0.365 (TD-738): خواندن پروژه هرگز وضعیت آن یا مراحلش را نمی‌نویسد؛ همگام‌سازی فقط در مسیرهای نوشتن است
    const [projData] = await orm
      .select({
        project: productionProjects,
        itemImage: items.image,
        itemThumbnail: items.thumbnail,
      })
      .from(productionProjects)
      .leftJoin(items, eq(productionProjects.itemId, items.id))
      .where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));

    if (!projData) return res.status(404).json({ error: 'پروژه مورد نظر یافت نشد' });

    const rawStages = await orm
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, id), eq(projectStages.isDeleted, 0)))
      .orderBy(asc(projectStages.stageOrder));

    const formatted = formatProject(projData.project, rawStages, {
      itemImage: projData.itemImage,
      itemThumbnail: projData.itemThumbnail
    });

    res.json(formatted);
  } catch (err) {
    throw err;
  }
}));

// POST /api/projects - Create a new production project with stages
router.post('/projects', authorizePermission(...PROJECT_CREATE_PERMISSIONS), validate(createProjectSchema), asyncHandler(async (req, res) => {
  try {
    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, priority, description, initial_stages,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages, attachments, project_code
    } = req.body;

    const currentUser = req.user?.username || 'سیستم';

    const { project: newProject, stages: createdStages } = await ProjectService.createProject({
      title,
      projectCode: project_code,
      customerId: customer_id,
      customerName: customer_name,
      itemId: item_id,
      itemCode: item_code,
      itemName: item_name,
      quantity,
      unit,
      startDate: start_date,
      endDate: end_date,
      priority,
      description,
      initialStages: initial_stages,
      products,
      inventoryControl: inventoryControl || inventory_control,
      stageSchedules: stageSchedules || stage_schedules,
      customStages: customStages || custom_stages,
      attachments,
      createdBy: currentUser
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'CREATE',
      entity: 'پروژه تولید',
      entityId: String(newProject.id),
      description: `تعریف پروژه تولید جدید با کد ${newProject.projectCode} (${newProject.title})`
    });

    const formattedNew = formatProject(newProject, createdStages);
    res.status(201).json(formattedNew);
  } catch (err) {
    throw err;
  }
}));

// PUT /api/projects/:id - Edit project details
router.put('/projects/:id', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(updateProjectSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });
    if (req.body.initial_stages !== undefined) {
      throw new ValidationError(
        'مراحل پروژه با ویرایش پروژه تغییر نمی‌کنند؛ افزودن، تغییر نام، جابه‌جایی و حذف مرحله را در بخش مراحل جزئیات پروژه انجام دهید.',
        undefined, 'PROJECT_STAGES_READ_ONLY'
      );
    }

    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, status, priority, description,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages, attachments, project_code, version
    } = req.body;

    // v9.0.364 (TD-739): بررسی تکمیل با قاعده مشترک ماتریس درون تراکنش updateProject است
    const { current: updated } = await ProjectService.updateProject(id, {
      title,
      projectCode: project_code,
      customerId: customer_id,
      customerName: customer_name,
      itemId: item_id,
      itemCode: item_code,
      itemName: item_name,
      quantity,
      unit,
      startDate: start_date,
      endDate: end_date,
      status,
      priority,
      description,
      products,
      inventoryControl: inventoryControl ?? inventory_control,
      stageSchedules: stageSchedules ?? stage_schedules,
      customStages: customStages ?? custom_stages,
      attachments,
      expectedVersion: version
    }, undefined, { req });

    const rawStages = await orm.select().from(projectStages).where(and(eq(projectStages.projectId, id), eq(projectStages.isDeleted, 0))).orderBy(asc(projectStages.stageOrder));

    // v9.0.383 (TD-757): ردیف ممیزی ویرایش با پیش و پس درون تراکنش updateProject نوشته می‌شود
    res.json(formatProject(updated, rawStages));
  } catch (err) {
    throw err;
  }
}));

// POST /api/projects/:id/add-to-inventory - Add produced project products to warehouse stock
router.post('/projects/:id/add-to-inventory', authorizePermission(...PROJECT_EDIT_PERMISSIONS), idempotency({ scope: 'project_delivery' }), validate(addProjectToInventorySchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { itemsToAdd, markCompleted, overDeliveryReason } = req.body;
    const currentUser = req.user?.username || 'سیستم';

    const result = await ProjectService.addProjectToInventory({
      projectId: id,
      itemsToAdd,
      markCompleted,
      currentUser,
      userId: req.user?.id,
      overDeliveryReason
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `افزایش موجودی انبار بابت تحویل ${toPersianDigits(result.addedCount)} قلم محصول از پروژه ${result.projectCode}${result.refNumber ? ` با رسید تولید ${result.refNumber}` : ''}${result.overDeliveries.length > 0 ? ` (تحویل بیش از برنامه با دلیل: ${overDeliveryReason})` : ''}`,
      ...(result.overDeliveries.length > 0 ? { details: { overDeliveries: result.overDeliveries, overDeliveryReason } } : {})
    });

    res.json({
      success: true,
      message: 'محصولات با موفقیت به موجودی انبار افزوده شدند',
      addedCount: result.addedCount,
      documentId: result.documentId,
      refNumber: result.refNumber
    });
  } catch (err) {
    throw err;
  }
}));

// DELETE /api/projects/:id - Soft delete project and stages
router.delete('/projects/:id', authorizePermission(...PROJECT_DELETE_PERMISSIONS), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const existing = await ProjectService.deleteProject(id);

    const currentUser = req.user?.username || 'سیستم';
    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'DELETE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `حذف پروژه تولید ${existing.projectCode} (${existing.title})`
    });

    res.json({ success: true, message: 'پروژه با موفقیت حذف گردید' });
  } catch (err) {
    throw err;
  }
}));

// POST /api/projects/:id/stages - Add a stage to project
router.post('/projects/:id/stages', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(createProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { title, status, start_date, end_date, assigned_personnel, required_resources, notes } = req.body;

    const newStage = await ProjectService.addStage(projectId, {
      title,
      status,
      startDate: start_date,
      endDate: end_date,
      assignedPersonnel: assigned_personnel,
      requiredResources: required_resources,
      notes
    }, { req });

    res.status(201).json(formatStage(newStage));
  } catch (err) {
    throw err;
  }
}));

// PUT /api/projects/:id/stages/:stageId - Update a stage
router.put('/projects/:id/stages/:stageId', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(updateProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);
    if (isNaN(projectId) || isNaN(stageId)) {
      return res.status(400).json({ error: 'شناسه‌ها نامعتبر هستند' });
    }

    const { 
      title, stage_order, status, start_date, end_date, 
      assigned_personnel, required_resources, progress_percent, notes 
    } = req.body;

    // v9.0.365 (TD-738): ویرایش مرحله و همگام‌سازی مراحل و وضعیت پروژه در یک تراکنش زیر قفل پروژه
    const updatedStage = await ProjectService.updateStage(projectId, stageId, {
      title,
      stageOrder: stage_order === undefined ? undefined : Number(stage_order),
      status,
      startDate: start_date,
      endDate: end_date,
      assignedPersonnel: assigned_personnel,
      requiredResources: required_resources,
      progressPercent: progress_percent === undefined ? undefined : Number(progress_percent),
      notes
    }, { req });

    res.json(formatStage(updatedStage));
  } catch (err) {
    throw err;
  }
}));

// DELETE /api/projects/:id/stages/:stageId - Delete a stage
router.delete('/projects/:id/stages/:stageId', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(deleteProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);

    await ProjectService.deleteStage(projectId, stageId, { req });

    res.json({ success: true, message: 'مرحله با موفقیت حذف شد' });
  } catch (err) {
    throw err;
  }
}));

// GET /api/projects/:id/product-progress — ماتریس کامل پیشرفت SKUها
router.get('/projects/:id/product-progress', authorizePermission('projects.view', 'projects.edit', 'projects.create', 'warehouse.view', 'documents.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    // v9.0.365 (TD-738): فقط خواندن؛ وضعیت مراحل و پروژه را مسیرهای نوشتن همگام می‌کنند
    // v9.0.364 (TD-739): ماتریس با قاعده مشترک (پروژه تک‌کالایی: کالای اصلی)
    const view = await ProjectService.getProductProgressView(projectId);
    if (!view) return res.status(404).json({ error: 'پروژه یافت نشد' });

    res.json({ success: true, data: view });
  } catch (err) {
    throw err;
  }
}));

// PUT /api/projects/:id/product-progress — بولک آپسِرت وضعیت دودویی هر SKU در هر مرحله
const updateProductProgressSchema = z.object({
  params: z.object({
    id: numericIdString
  }),
  body: z.object({
    items: z.array(z.object({
      item_id: z.union([z.number(), z.string()]),
      item_code: z.string().optional(),
      item_name: z.string().optional(),
      quantity: z.union([z.number(), z.string()]).optional(),
      stage_order: z.union([z.number(), z.string()]),
      stage_title: z.string().optional(),
      status: z.enum(PRODUCT_PROGRESS_STATUSES)
    })).min(1, 'حداقل یک تغییر وضعیت الزامی است')
  })
});

router.put('/projects/:id/product-progress', authorizePermission(...PROJECT_EDIT_PERMISSIONS), validate(updateProductProgressSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const updates = req.body.items as Array<{ item_id: number | string; stage_order: number | string; stage_title?: string; status: ProductProgressStatus }>;

    // v9.0.365 (TD-738): تیک‌ها، ردیف ممیزی و همگام‌سازی مراحل و وضعیت در یک تراکنش زیر قفل پروژه
    const { applied, skippedInvalid, projectStatus, weightedProgress } = await ProjectService.updateProductProgress(
      projectId,
      updates.map(u => ({
        itemId: Number(u.item_id),
        stageOrder: Number(u.stage_order),
        stageTitle: u.stage_title,
        status: u.status
      })),
      { req }
    );

    res.json({ 
      success: true, 
      applied, 
      skipped_invalid: skippedInvalid,
      project_status: projectStatus,
      weighted_progress_percent: weightedProgress
    });
  } catch (err) {
    throw err;
  }
}));

export default router;
