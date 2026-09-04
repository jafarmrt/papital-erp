import { Router } from 'express';
import { eq, desc, and, sql, asc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { productionProjects, projectStages, items, customers, transactions, warehouses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { roundFinancial } from '../utils.js';
import { validateLockOrder, sortIdsForLocking, LockHierarchyLevel, LockableResource } from '../lib/lockOrder.js';
import { inArray } from 'drizzle-orm';

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
    quantity: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    priority: z.string().optional(),
    description: z.string().optional(),
    initial_stages: z.array(z.record(z.string(), z.unknown())).optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
  })
});

const updateProjectSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    project_code: z.string().optional(),
    customer_id: z.union([z.number(), z.string(), z.null()]).optional(),
    customer_name: z.string().optional(),
    item_id: z.union([z.number(), z.string(), z.null()]).optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    description: z.string().optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const addProjectToInventorySchema = z.object({
  body: z.preprocess((val: any) => {
    if (val && typeof val === 'object' && !val.itemsToAdd && (val.itemId || val.item_id)) {
      return {
        itemsToAdd: [{
          itemId: val.itemId || val.item_id,
          quantity: val.quantity,
          location: val.location,
          notes: val.description || val.notes
        }],
        markCompleted: Boolean(val.markCompleted)
      };
    }
    return val;
  }, z.object({
    itemsToAdd: z.array(z.object({
      itemId: z.union([z.number(), z.string()]),
      quantity: z.union([z.number(), z.string()]),
      location: z.string().optional(),
      notes: z.string().optional()
    })).min(1, 'حداقل یک محصول برای ورود به انبار الزامی است'),
    markCompleted: z.boolean().optional()
  })),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const createProjectStageSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان مرحله الزامی است'),
    status: z.string().optional(),
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

const updateProjectStageSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    stage_order: z.union([z.number(), z.string()]).optional(),
    status: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_personnel: z.array(z.unknown()).optional(),
    required_resources: z.array(z.unknown()).optional(),
    progress_percent: z.union([z.number(), z.string()]).optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است'),
    stageId: z.string().regex(/^\d+$/, 'شناسه مرحله نامعتبر است')
  })
});

export interface FormattedStage {
  id?: number;
  project_id: number;
  projectId: number;
  stage_order: number;
  stageOrder: number;
  title: string;
  status: string;
  start_date: string;
  startDate: string;
  end_date: string;
  endDate: string;
  assigned_personnel: unknown[];
  assignedPersonnel: unknown[];
  required_resources: unknown[];
  requiredResources: unknown[];
  progress_percent: number;
  progressPercent: number;
  notes: string;
  completed_at: string;
  completedAt: string;
  is_deleted: number;
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
}

function formatStage(s: StageLike | null | undefined): FormattedStage | null {
  if (!s) return null;
  const pId = Number(s.projectId ?? s.project_id ?? 0);
  const sOrder = Number(s.stageOrder ?? s.stage_order ?? 1);
  const sDate = String(s.startDate ?? s.start_date ?? '');
  const eDate = String(s.endDate ?? s.end_date ?? '');
  const cAt = String(s.completedAt ?? s.completed_at ?? '');
  const assigned = Array.isArray(s.assignedPersonnel) 
    ? s.assignedPersonnel 
    : (Array.isArray(s.assigned_personnel) ? s.assigned_personnel : []);
  const resources = Array.isArray(s.requiredResources) 
    ? s.requiredResources 
    : (Array.isArray(s.required_resources) ? s.required_resources : []);
  const prog = Number(s.progressPercent ?? s.progress_percent ?? 0);

  return {
    id: s.id,
    project_id: pId,
    projectId: pId,
    stage_order: sOrder,
    stageOrder: sOrder,
    title: s.title || '',
    status: s.status || 'pending',
    start_date: sDate,
    startDate: sDate,
    end_date: eDate,
    endDate: eDate,
    assigned_personnel: assigned,
    assignedPersonnel: assigned,
    required_resources: resources,
    requiredResources: resources,
    progress_percent: prog,
    progressPercent: prog,
    notes: s.notes || '',
    completed_at: cAt,
    completedAt: cAt,
    is_deleted: Number(s.isDeleted ?? s.is_deleted ?? 0)
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
  isDeleted?: number | null;
  is_deleted?: number | null;
  itemImage?: string | null;
  itemThumbnail?: string | null;
  item_image?: string | null;
}

function formatProject(p: ProjectLike | null | undefined, rawStages: StageLike[] = [], extra: { itemImage?: string | null; itemThumbnail?: string | null; item_image?: string | null } = {}) {
  if (!p) return null;
  const stages = (rawStages || []).map(formatStage).filter((s): s is FormattedStage => s !== null);
  const totalStages = stages.length;
  const completedStages = stages.filter((s) => s.status === 'completed').length;
  
  let overallProgress = 0;
  if (totalStages > 0) {
    const sumProgress = stages.reduce((acc: number, s) => acc + (s.progress_percent || (s.status === 'completed' ? 100 : 0)), 0);
    overallProgress = Math.round(sumProgress / totalStages);
  }

  const projCode = p.projectCode ?? p.project_code ?? '';
  const custName = p.customerName ?? p.customer_name ?? '';
  const itemName = p.itemName ?? p.item_name ?? '';
  const itemCode = p.itemCode ?? p.item_code ?? '';

  const products = Array.isArray(p.products) ? p.products : [];
  const inventoryControl = p.inventoryControl ?? p.inventory_control ?? {};
  const stageSchedules = p.stageSchedules ?? p.stage_schedules ?? {};
  const customStages = Array.isArray(p.customStages) ? p.customStages : (Array.isArray(p.custom_stages) ? p.custom_stages : []);

  return {
    id: p.id,
    project_code: projCode,
    projectCode: projCode,
    title: p.title || '',
    customer_id: p.customerId ?? p.customer_id ?? null,
    customerId: p.customerId ?? p.customer_id ?? null,
    customer_name: custName,
    customerName: custName,
    item_id: p.itemId ?? p.item_id ?? null,
    itemId: p.itemId ?? p.item_id ?? null,
    item_code: itemCode,
    itemCode: itemCode,
    item_name: itemName,
    itemName: itemName,
    quantity: p.quantity ?? 1,
    unit: p.unit || 'عدد',
    start_date: p.startDate ?? p.start_date ?? '',
    startDate: p.startDate ?? p.start_date ?? '',
    end_date: p.endDate ?? p.end_date ?? '',
    endDate: p.endDate ?? p.end_date ?? '',
    status: p.status || 'planned',
    priority: p.priority || 'medium',
    description: p.description || '',
    created_at: p.createdAt ?? p.created_at ?? '',
    createdAt: p.createdAt ?? p.created_at ?? '',
    created_by: p.createdBy ?? p.created_by ?? '',
    createdBy: p.createdBy ?? p.created_by ?? '',
    products,
    inventory_control: inventoryControl,
    inventoryControl: inventoryControl,
    stage_schedules: stageSchedules,
    stageSchedules: stageSchedules,
    custom_stages: customStages,
    customStages: customStages,
    is_deleted: p.isDeleted ?? p.is_deleted ?? 0,
    item_image: extra.item_image || extra.itemThumbnail || extra.itemImage || p.item_image || p.itemThumbnail || p.itemImage || '',
    stages,
    total_stages: totalStages,
    totalStages: totalStages,
    completed_stages: completedStages,
    completedStages: completedStages,
    progress_percent: overallProgress,
    progressPercent: overallProgress
  };
}

// GET /api/projects - List all production projects with summary progress
router.get('/projects', authorizePermission('projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create', 'warehouse.in', 'warehouse.out', 'warehouse.view'), async (req, res) => {
  try {
    const { status, priority, search } = req.query;

    const allProjects = await orm
      .select({
        project: productionProjects,
        itemImage: items.image,
        itemThumbnail: items.thumbnail,
      })
      .from(productionProjects)
      .leftJoin(items, eq(productionProjects.itemId, items.id))
      .where(eq(productionProjects.isDeleted, 0))
      .orderBy(desc(productionProjects.createdAt));

    // Fetch all active stages to calculate progress
    const allStages = await orm
      .select()
      .from(projectStages)
      .where(eq(projectStages.isDeleted, 0))
      .orderBy(asc(projectStages.stageOrder));

    // Map stages to projects
    const stagesByProjectMap = new Map<number, StageLike[]>();
    for (const stage of allStages) {
      if (!stagesByProjectMap.has(stage.projectId)) {
        stagesByProjectMap.set(stage.projectId, []);
      }
      stagesByProjectMap.get(stage.projectId)!.push(stage);
    }

    const result = allProjects.map(({ project, itemImage, itemThumbnail }) => {
      const rawStages = stagesByProjectMap.get(project.id) || [];
      return formatProject(project, rawStages, { itemImage, itemThumbnail });
    });

    // Apply optional client filters
    let filtered = result;

    if (status && typeof status === 'string' && status !== 'all') {
      filtered = filtered.filter(p => p.status === status);
    }

    if (priority && typeof priority === 'string' && priority !== 'all') {
      filtered = filtered.filter(p => p.priority === priority);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(p => 
        (p.project_code && p.project_code.toLowerCase().includes(q)) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.customer_name && p.customer_name.toLowerCase().includes(q)) ||
        (p.item_name && p.item_name.toLowerCase().includes(q)) ||
        (p.item_code && p.item_code.toLowerCase().includes(q))
      );
    }

    res.json(filtered);
  } catch (err) {
    throw err;
  }
});

// GET /api/projects/:id - Get single project details with stages
router.get('/projects/:id', authorizePermission('projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create', 'warehouse.in', 'warehouse.out', 'warehouse.view'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

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
});

// POST /api/projects - Create a new production project with stages
router.post('/projects', authorizePermission('projects.create'), validate(createProjectSchema), async (req, res) => {
  try {
    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, priority, description, initial_stages,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages
    } = req.body;

    // Auto generate or uniquify project code
    let projectCode = '';
    if (req.body.project_code !== undefined && req.body.project_code !== null) {
      projectCode = String(req.body.project_code).trim();
    }

    if (!projectCode) {
      const countRes = await orm.select({ count: sql<number>`count(*)` }).from(productionProjects);
      const totalNum = Number(countRes[0]?.count || 0) + 1;
      const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
      const rawYear = new Date().toLocaleDateString('fa-IR-u-ca-persian', { year: 'numeric' });
      const jalaliYear = rawYear.replace(/[۰-۹]/g, d => String(faDigits.indexOf(d))) || '1405';
      projectCode = `PRJ-${jalaliYear}-${totalNum.toString().padStart(3, '0')}`;
    }

    // Ensure projectCode is strictly unique in DB using explicit text casting
    let uniqueCode = String(projectCode);
    let codeCounter = 1;
    while (true) {
      const existing = await orm
        .select({ id: productionProjects.id })
        .from(productionProjects)
        .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
      if (existing.length === 0) break;
      uniqueCode = `${projectCode}-${codeCounter++}`;
    }
    projectCode = String(uniqueCode);

    // Validate FKs
    let validCustomerId: number | null = null;
    if (customer_id && !isNaN(Number(customer_id))) {
      const foundCust = await orm.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(customer_id)));
      if (foundCust.length > 0) validCustomerId = Number(customer_id);
    }

    let validItemId: number | null = null;
    if (item_id && !isNaN(Number(item_id))) {
      const foundItem = await orm.select({ id: items.id }).from(items).where(eq(items.id, Number(item_id)));
      if (foundItem.length > 0) validItemId = Number(item_id);
    }

    const currentUser = req.user?.username || 'سیستم';

    const [newProject] = await orm.insert(productionProjects).values({
      projectCode,
      title: title.trim(),
      customerId: validCustomerId,
      customerName: customer_name || '',
      itemId: validItemId,
      itemCode: item_code || '',
      itemName: item_name || '',
      quantity: quantity ? Number(quantity) : 1,
      unit: unit || 'عدد',
      startDate: start_date || '',
      endDate: end_date || '',
      status: 'planned',
      priority: priority || 'medium',
      description: description || '',
      createdBy: currentUser,
      products: Array.isArray(products) ? products : [],
      inventoryControl: inventoryControl || inventory_control || {},
      stageSchedules: stageSchedules || stage_schedules || {},
      customStages: customStages || custom_stages || [],
    }).returning();

    // Insert initial stages if provided
    let createdStages: StageLike[] = [];
    if (Array.isArray(initial_stages) && initial_stages.length > 0) {
      const stageValues = initial_stages.map((stg: Record<string, unknown>, index: number) => ({
        projectId: newProject.id,
        stageOrder: index + 1,
        title: typeof stg.title === 'string' && stg.title.trim() ? stg.title.trim() : `مرحله ${index + 1}`,
        status: typeof stg.status === 'string' ? stg.status : 'pending',
        startDate: typeof stg.start_date === 'string' ? stg.start_date : (start_date || ''),
        endDate: typeof stg.end_date === 'string' ? stg.end_date : (end_date || ''),
        assignedPersonnel: Array.isArray(stg.assigned_personnel) ? stg.assigned_personnel : [],
        requiredResources: Array.isArray(stg.required_resources) ? stg.required_resources : [],
        progressPercent: typeof stg.progress_percent === 'number' ? stg.progress_percent : 0,
        notes: typeof stg.notes === 'string' ? stg.notes : ''
      }));

      createdStages = await orm.insert(projectStages).values(stageValues).returning();
    }

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
});

// PUT /api/projects/:id - Edit project details
router.put('/projects/:id', authorizePermission('projects.edit'), validate(updateProjectSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const [existing] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'پروژه یافت نشد' });

    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, status, priority, description 
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    
    if (req.body.project_code !== undefined && req.body.project_code !== null && String(req.body.project_code).trim()) {
      let requestedCode = String(req.body.project_code).trim();
      let uniqueCode = requestedCode;
      let codeCounter = 1;
      while (true) {
        const existingCode = await orm
          .select({ id: productionProjects.id })
          .from(productionProjects)
          .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
        if (existingCode.length === 0 || existingCode[0].id === id) break;
        uniqueCode = `${requestedCode}-${codeCounter++}`;
      }
      updateData.projectCode = String(uniqueCode);
    }

    if (customer_id !== undefined) {
      if (customer_id && !isNaN(Number(customer_id))) {
        const foundCust = await orm.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(customer_id)));
        updateData.customerId = foundCust.length > 0 ? Number(customer_id) : null;
      } else {
        updateData.customerId = null;
      }
    }

    if (customer_name !== undefined) updateData.customerName = customer_name;

    if (item_id !== undefined) {
      if (item_id && !isNaN(Number(item_id))) {
        const foundItem = await orm.select({ id: items.id }).from(items).where(eq(items.id, Number(item_id)));
        updateData.itemId = foundItem.length > 0 ? Number(item_id) : null;
      } else {
        updateData.itemId = null;
      }
    }
    if (item_code !== undefined) updateData.itemCode = item_code;
    if (item_name !== undefined) updateData.itemName = item_name;
    if (quantity !== undefined) updateData.quantity = Number(quantity);
    if (unit !== undefined) updateData.unit = unit;
    if (start_date !== undefined) updateData.startDate = start_date;
    if (end_date !== undefined) updateData.endDate = end_date;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (description !== undefined) updateData.description = description;

    if (req.body.products !== undefined) updateData.products = Array.isArray(req.body.products) ? req.body.products : [];
    if (req.body.inventory_control !== undefined || req.body.inventoryControl !== undefined) {
      updateData.inventoryControl = req.body.inventoryControl ?? req.body.inventory_control ?? {};
    }
    if (req.body.stage_schedules !== undefined || req.body.stageSchedules !== undefined) {
      updateData.stageSchedules = req.body.stageSchedules ?? req.body.stage_schedules ?? {};
    }
    if (req.body.custom_stages !== undefined || req.body.customStages !== undefined) {
      updateData.customStages = req.body.customStages ?? req.body.custom_stages ?? [];
    }

    await orm.update(productionProjects).set(updateData).where(eq(productionProjects.id, id));

    const [updated] = await orm.select().from(productionProjects).where(eq(productionProjects.id, id));
    const rawStages = await orm.select().from(projectStages).where(and(eq(projectStages.projectId, id), eq(projectStages.isDeleted, 0))).orderBy(asc(projectStages.stageOrder));

    const currentUser = req.user?.username || 'سیستم';
    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `بروزرسانی مشخصات پروژه تولید ${updated.projectCode} (${updated.title})`
    });

    res.json(formatProject(updated, rawStages));
  } catch (err) {
    throw err;
  }
});

// POST /api/projects/:id/add-to-inventory - Add produced project products to warehouse stock
router.post('/projects/:id/add-to-inventory', authorizePermission('projects.edit'), validate(addProjectToInventorySchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { itemsToAdd, markCompleted } = req.body; // array of { itemId: number, quantity: number, notes?: string }
    const currentUser = req.user?.username || 'سیستم';

    const result = await orm.transaction(async (tx) => {
      // Observe Lock Hierarchy: Items (Level 40) -> Production (Level 50)
      const targetItemIds = sortIdsForLocking((itemsToAdd || []).map((e: { itemId: number | string }) => Number(e.itemId)).filter(Boolean));
      validateLockOrder([
        { name: 'items', hierarchyLevel: LockHierarchyLevel.ITEMS_STOCK },
        { name: 'productionProjects', hierarchyLevel: LockHierarchyLevel.PRODUCTION },
      ]);

      // 1. Lock items (level 40) FIRST
      if (targetItemIds.length > 0) {
        await tx.select({ id: items.id }).from(items).where(inArray(items.id, targetItemIds)).for('update');
      }

      // 2. Lock production project (level 50) SECOND
      const [proj] = await tx.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0))).for('update');
      if (!proj) {
        throw new Error('پروژه یافت نشد');
      }

      let addedCount = 0;

      for (const entry of itemsToAdd) {
        const targetItemId = Number(entry.itemId);
        const qtyToAdd = Number(entry.quantity);
        if (!targetItemId || isNaN(targetItemId) || !qtyToAdd || qtyToAdd <= 0) continue;

        const [targetItem] = await tx.select({
          id: items.id,
          name: items.name,
          code: items.code,
          unit: items.unit,
          stocks: items.stocks,
          currentStock: items.currentStock
        }).from(items).where(eq(items.id, targetItemId)).for('update');

        if (!targetItem) continue;

        const currentStocks = (targetItem.stocks as Record<string, number>) || {};
        let targetLoc = entry.location ? String(entry.location).trim() : '';
        if (!targetLoc) {
          const [firstActiveWh] = await tx.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).limit(1);
          if (!firstActiveWh) {
            throw new Error('هیچ انبار فعالی در سیستم تعریف نشده است. لطفاً ابتدا از بخش تنظیمات > مدیریت انبارها، حداقل یک انبار تعریف نمایید.');
          }
          targetLoc = firstActiveWh.code;
        }

        const prevLocStock = Number(currentStocks[targetLoc] || 0);
        currentStocks[targetLoc] = roundFinancial(prevLocStock + qtyToAdd);

        const newTotalStock = roundFinancial(
          Object.values(currentStocks).reduce((sum, val) => sum + (Number(val) || 0), 0)
        );

        // Update item stock atomically
        await tx.update(items).set({
          stocks: currentStocks,
          currentStock: newTotalStock
        }).where(eq(items.id, targetItemId));

        // Log transaction
        await tx.insert(transactions).values({
          itemId: targetItemId,
          type: 'in',
          quantity: qtyToAdd,
          date: new Date().toISOString(),
          documentType: 'پروژه تولید',
          documentRef: proj.projectCode,
          createdBy: typeof currentUser === 'string' ? currentUser : 'system',
          notes: entry.notes || `ورود حاصل از تکمیل پروژه ${proj.title} (${proj.projectCode})`,
          location: targetLoc
        });

        addedCount++;
      }

      // Mark project as completed if requested
      if (markCompleted) {
        await tx.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, id));
      }

      return { addedCount, projectCode: proj.projectCode };
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `افزایش موجودی انبار بابت تحویل ${result.addedCount} قلم محصول از پروژه ${result.projectCode}`
    });

    res.json({
      success: true,
      message: 'محصولات با موفقیت به موجودی انبار افزوده شدند',
      addedCount: result.addedCount
    });
  } catch (err) {
    throw err;
  }
});

// DELETE /api/projects/:id - Soft delete project and stages
router.delete('/projects/:id', authorizePermission('projects.delete'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const [existing] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'پروژه یافت نشد' });

    await orm.update(productionProjects).set({ isDeleted: 1 }).where(eq(productionProjects.id, id));
    await orm.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.projectId, id));

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
});

// POST /api/projects/:id/stages - Add a stage to project
router.post('/projects/:id/stages', authorizePermission('projects.edit'), validate(createProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { title, status, start_date, end_date, assigned_personnel, required_resources, notes } = req.body;

    // Get max order
    const existingStages = await orm
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    const nextOrder = existingStages.length + 1;

    const [newStage] = await orm.insert(projectStages).values({
      projectId,
      stageOrder: nextOrder,
      title: title.trim(),
      status: status || 'pending',
      startDate: start_date || '',
      endDate: end_date || '',
      assignedPersonnel: Array.isArray(assigned_personnel) ? assigned_personnel : [],
      requiredResources: Array.isArray(required_resources) ? required_resources : [],
      progressPercent: status === 'completed' ? 100 : 0,
      notes: notes || '',
    }).returning();

    res.status(201).json(formatStage(newStage));
  } catch (err) {
    throw err;
  }
});

// PUT /api/projects/:id/stages/:stageId - Update a stage
router.put('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(updateProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);
    if (isNaN(projectId) || isNaN(stageId)) {
      return res.status(400).json({ error: 'شناسه‌ها نامعتبر هستند' });
    }

    const [existing] = await orm.select().from(projectStages).where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'مرحله یافت نشد' });

    const { 
      title, stage_order, status, start_date, end_date, 
      assigned_personnel, required_resources, progress_percent, notes 
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (stage_order !== undefined) updateData.stageOrder = Number(stage_order);
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.progressPercent = 100;
        updateData.completedAt = new Date().toISOString();
      }
    }
    if (start_date !== undefined) updateData.startDate = start_date;
    if (end_date !== undefined) updateData.endDate = end_date;
    if (assigned_personnel !== undefined) updateData.assignedPersonnel = Array.isArray(assigned_personnel) ? assigned_personnel : [];
    if (required_resources !== undefined) updateData.requiredResources = Array.isArray(required_resources) ? required_resources : [];
    if (progress_percent !== undefined) {
      const p = Math.min(100, Math.max(0, Number(progress_percent)));
      updateData.progressPercent = p;
      if (p === 100 && existing.status !== 'completed') {
        updateData.status = 'completed';
        updateData.completedAt = new Date().toISOString();
      } else if (p > 0 && p < 100 && existing.status === 'pending') {
        updateData.status = 'in_progress';
      }
    }
    if (notes !== undefined) updateData.notes = notes;

    await orm.update(projectStages).set(updateData).where(eq(projectStages.id, stageId));

    const [updatedStage] = await orm.select().from(projectStages).where(eq(projectStages.id, stageId));

    // Check if project status should auto-update to in_progress or completed
    const allStages = await orm
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    if (allStages.length > 0) {
      const allCompleted = allStages.every(s => s.status === 'completed');
      const anyInProgress = allStages.some(s => s.status === 'in_progress' || (s.progressPercent && s.progressPercent > 0));

      if (allCompleted) {
        await orm.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, projectId));
      } else if (anyInProgress) {
        const [proj] = await orm.select().from(productionProjects).where(eq(productionProjects.id, projectId));
        if (proj && proj.status === 'planned') {
          await orm.update(productionProjects).set({ status: 'in_progress' }).where(eq(productionProjects.id, projectId));
        }
      }
    }

    res.json(formatStage(updatedStage));
  } catch (err) {
    throw err;
  }
});

// DELETE /api/projects/:id/stages/:stageId - Delete a stage
router.delete('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(deleteProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);

    const [existing] = await orm.select().from(projectStages).where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)));
    if (!existing) return res.status(404).json({ error: 'مرحله یافت نشد' });

    await orm.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.id, stageId));

    res.json({ success: true, message: 'مرحله با موفقیت حذف شد' });
  } catch (err) {
    throw err;
  }
});

export default router;
