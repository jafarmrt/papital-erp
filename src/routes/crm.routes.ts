import { Router } from 'express';
import { eq, desc, and, ilike, sql, gte, lte, or } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { crmLeads, crmActivities, customers, users, notifications, personnel } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { parsePagination } from '../lib/pagination.js';
import { isoToJalaliDate, toPersianDigits } from '../utils.js';
import { requireStorageDate, optionalStorageDate, crmTodayActivityDates } from '../lib/storageDate.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../lib/businessClock.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, BadRequestError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { containsLikePattern } from '../lib/sqlLike.js';
import { money } from '../lib/money.js';
import { notSyntheticTestUsername } from '../lib/syntheticUsers.js';
import { linkCustomerForLead, notesWithPartyDifferences } from '../services/crm/crmCustomerLink.js';
import { getCrmStats } from '../services/crm/crmStats.js';
import { listFollowups, liveLeadActivityCondition, type FollowupStatus } from '../services/crm/crmFollowups.js';
import { deleteLead } from '../services/crm/crmLeadDelete.js';
import { resolveActivityParents } from '../services/crm/crmActivityParents.js';
import { leadCustomerCondition } from '../services/crm/crmLeadCustomerFilter.js';

const router = Router();
router.use(authenticateToken);

const createCrmLeadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان فرصت فروش الزامی است'),
    customerId: z.union([z.number(), z.string(), z.null()]).optional(),
    customerName: z.string().optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    contacts: z.array(z.any()).optional(),
    source: z.string().optional(),
    stage: z.string().optional(),
    estimatedValue: z.union([z.number(), z.string()]).optional(),
    currency: z.string().optional(),
    probability: z.union([z.number(), z.string()]).optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    expectedCloseDate: z.string().optional(),
    notes: z.string().optional(),
  })
});

const updateCrmLeadSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    customerId: z.union([z.number(), z.string(), z.null()]).optional(),
    customerName: z.string().optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    contacts: z.array(z.any()).optional(),
    source: z.string().optional(),
    stage: z.string().optional(),
    estimatedValue: z.union([z.number(), z.string()]).optional(),
    currency: z.string().optional(),
    probability: z.union([z.number(), z.string()]).optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    expectedCloseDate: z.string().optional(),
    notes: z.string().optional(),
    status: z.string().optional(),
  }),
  params: z.object({
    id: numericIdString
  })
});

const createCrmActivitySchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان اقدام یا تماس الزامی است'),
    leadId: z.union([z.number(), z.string(), z.null()]).optional(),
    customerId: z.union([z.number(), z.string(), z.null()]).optional(),
    type: z.string().optional(),
    description: z.string().optional(),
    result: z.string().optional(),
    activityDate: z.string().optional(),
    nextFollowUpDate: z.string().optional(),
    nextFollowUpTask: z.string().optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    mentions: z.array(z.any()).optional(),
  })
});

const toggleFollowupSchema = z.object({
  body: z.object({
    result: z.string().optional(),
    resultNote: z.string().optional()
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

// V10-4.1: resolve مسئول از پرسنل — id معتبر => snapshot نام؛ نام بدون id => best-effort اتصال
async function resolveAssignee(input: { name?: string | null; personnelId?: number | string | null }): Promise<{ name: string; id: number | null }> {
  const nameStr = String(input.name ?? '').trim();

  if (input.personnelId !== undefined && input.personnelId !== null && String(input.personnelId).trim() !== '') {
    const pid = Number(input.personnelId);
    if (Number.isNaN(pid) || pid <= 0) {
      throw new BadRequestError('شناسه فروشنده/مسئول نامعتبر است');
    }
    const [p] = await orm.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel).where(eq(personnel.id, pid));
    if (!p) {
      throw new NotFoundError('پرسنل انتخاب‌شده یافت نشد');
    }
    return { name: p.fullName, id: p.id };
  }

  if (nameStr) {
    const [p] = await orm.select({ id: personnel.id, fullName: personnel.fullName })
      .from(personnel)
      .where(and(eq(personnel.isDeleted, 0), sql`lower(btrim(${personnel.fullName})) = lower(btrim(${String(nameStr)}))`));
    return { name: nameStr, id: p ? p.id : null };
  }

  return { name: '', id: null };
}

function formatLead(l: (Partial<typeof crmLeads.$inferSelect> & Record<string, unknown>) | null | undefined) {
  if (!l) return null;
  return {
    ...l,
    id: l.id,
    title: l.title,
    customer_id: l.customerId,
    customerId: l.customerId,
    customer_name: l.customerName || '',
    customerName: l.customerName || '',
    phone: l.phone || '',
    company: l.company || '',
    contacts: Array.isArray(l.contacts) ? l.contacts : [],
    source: l.source || 'تماس تلفنی',
    stage: l.stage || 'lead',
    estimated_value: Number(l.estimatedValue || 0),
    estimatedValue: Number(l.estimatedValue || 0),
    currency: l.currency || 'IRR',
    probability: l.probability ?? 50,
    assigned_to: l.assignedTo || '',
    assignedTo: l.assignedTo || '',
    assigned_personnel_id: l.assignedPersonnelId ?? null,
    assignedPersonnelId: l.assignedPersonnelId ?? null,
    expected_close_date: l.expectedCloseDate || '',
    expectedCloseDate: l.expectedCloseDate || '',
    notes: l.notes || '',
    status: l.status || 'active',
    created_at: l.createdAt,
    createdAt: l.createdAt,
    updated_at: l.updatedAt,
    updatedAt: l.updatedAt,
    created_by: l.createdBy || '',
    createdBy: l.createdBy || '',
    is_deleted: l.isDeleted || 0,
    isDeleted: l.isDeleted || 0,
  };
}

function formatActivity(act: (Partial<typeof crmActivities.$inferSelect> & Record<string, unknown>) | null | undefined) {
  if (!act) return null;
  const leadTitle = act.leadTitle || (act.lead && typeof act.lead === 'object' && 'title' in act.lead ? (act.lead as { title: string }).title : '');
  const customerName = act.customerName || act.leadCustomerName || (act.customer && typeof act.customer === 'object' && 'name' in act.customer ? (act.customer as { name: string }).name : '');
  return {
    ...act,
    id: act.id,
    lead_id: act.leadId,
    leadId: act.leadId,
    leadTitle: leadTitle || '',
    lead_title: leadTitle || '',
    customer_id: act.customerId,
    customerId: act.customerId,
    customerName: customerName || '',
    customer_name: customerName || '',
    type: act.type,
    title: act.title,
    description: act.description || '',
    result: act.result || '',
    logged_by: act.loggedBy || '',
    loggedBy: act.loggedBy || '',
    assigned_to: act.assignedTo || '',
    assignedTo: act.assignedTo || '',
    assigned_personnel_id: act.assignedPersonnelId ?? null,
    assignedPersonnelId: act.assignedPersonnelId ?? null,
    mentions: Array.isArray(act.mentions) ? act.mentions : [],
    activity_date: act.activityDate || '',
    activityDate: act.activityDate || '',
    // v7.0.132 (TD-232): ستون اصلی میلادی ISO است؛ ستون *_iso همان مقدار را دارد
    activity_date_iso: act.activityDate || '',
    activityDateIso: act.activityDate || '',
    next_followup_date: act.nextFollowUpDate || '',
    nextFollowUpDate: act.nextFollowUpDate || '',
    next_followup_date_iso: act.nextFollowUpDate || '',
    nextFollowUpDateIso: act.nextFollowUpDate || '',
    next_followup_task: act.nextFollowUpTask || '',
    nextFollowUpTask: act.nextFollowUpTask || '',
    is_followup_completed: act.isFollowUpCompleted || 0,
    isFollowUpCompleted: act.isFollowUpCompleted || 0,
    created_at: act.createdAt,
    createdAt: act.createdAt,
    is_deleted: act.isDeleted || 0,
    isDeleted: act.isDeleted || 0,
  };
}

// GET /api/crm/stats - CRM KPI summary and stage totals
// v9.0.11 (TD-422): ارزش پرونده‌ها به تفکیک ارز (`getCrmStats`)
router.get('/crm/stats', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (_req, res) => {
  res.json(await getCrmStats());
}));

// GET /api/crm/leads - Get list of leads
router.get('/crm/leads', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (req, res) => {
  const { stage, status, assignedTo, assignedPersonnelId, source, search, customerId, customerName, fromDate, toDate } = req.query;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const isPaginated = req.query.paginate === 'true' || page !== undefined;

  const conditions = [eq(crmLeads.isDeleted, 0)];

  // v9.0.15 (TD-429): مشتری با شناسه طرف حساب؛ پرونده قدیمی بی شناسه با نام برابر (`leadCustomerCondition`)
  if (customerId && !isNaN(Number(customerId)) && Number(customerId) > 0) {
    conditions.push(await leadCustomerCondition(Number(customerId)));
  } else if (customerName && typeof customerName === 'string' && customerName.trim() !== '') {
    conditions.push(eq(crmLeads.customerName, customerName.trim()));
  }

  if (stage && typeof stage === 'string' && stage.trim() !== '' && stage !== 'all') {
    conditions.push(eq(crmLeads.stage, stage.trim()));
  }

  if (status && typeof status === 'string' && status.trim() !== '' && status !== 'all') {
    conditions.push(eq(crmLeads.status, status.trim()));
  }

  if (source && typeof source === 'string' && source.trim() !== '' && source !== 'all') {
    conditions.push(eq(crmLeads.source, source.trim()));
  }

  // V10-4.1: فیلتر فروشنده روی id پرسنل (سازگار با snapshot متنی قدیمی)
  if (assignedPersonnelId && !isNaN(Number(assignedPersonnelId))) {
    conditions.push(eq(crmLeads.assignedPersonnelId, Number(assignedPersonnelId)));
  } else if (assignedTo && typeof assignedTo === 'string' && assignedTo.trim() !== '' && assignedTo !== 'all') {
    conditions.push(eq(crmLeads.assignedTo, assignedTo.trim()));
  }

  if (fromDate && typeof fromDate === 'string' && fromDate.trim() !== '') {
    conditions.push(gte(crmLeads.createdAt, fromDate.trim()));
  }

  if (toDate && typeof toDate === 'string' && toDate.trim() !== '') {
    const endCondition = toDate.trim().length <= 10 ? toDate.trim() + 'T23:59:59.999Z' : toDate.trim();
    conditions.push(lte(crmLeads.createdAt, endCondition));
  }

  if (search && typeof search === 'string' && search.trim() !== '') {
    const s = containsLikePattern(search.trim());
    conditions.push(
      or(
        ilike(crmLeads.title, s),
        ilike(crmLeads.customerName, s),
        ilike(crmLeads.company, s),
        ilike(crmLeads.phone, s),
        ilike(crmLeads.notes, s)
      )!
    );
  }

  const whereClause = and(...conditions);

  if (isPaginated) {
    // V9-1.3: صفحه‌بندی NaN-safe با سقف
    const { page: currentPage, limit: pageLimit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });

    const [countResult] = await orm.select({ count: sql`count(*)`.mapWith(Number) })
      .from(crmLeads)
      .where(whereClause);
    
    const total = countResult?.count || 0;
    const totalPages = Math.ceil(total / pageLimit) || 1;

    const leads = await orm.select()
      .from(crmLeads)
      .where(whereClause)
      .orderBy(desc(crmLeads.updatedAt), desc(crmLeads.id))
      .limit(pageLimit)
      .offset(offset);

    return res.json({
      data: leads.map(formatLead),
      total,
      page: currentPage,
      limit: pageLimit,
      totalPages: totalPages > 0 ? totalPages : 1
    });
  }

  const safeLimit = Math.min(Number(req.query.limit) || 500, 500);
  const leads = await orm.select()
    .from(crmLeads)
    .where(whereClause)
    .orderBy(desc(crmLeads.updatedAt), desc(crmLeads.id))
    .limit(safeLimit);

  res.json(leads.map(formatLead));
}));

// GET /api/crm/leads/:id - Single lead detail with activities
router.get('/crm/leads/:id', authorizePermission('crm.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [lead] = await orm.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0)));
  if (!lead) {
    throw new NotFoundError('فرصت فروش یافت نشد');
  }

  const activities = await orm.select()
    .from(crmActivities)
    .where(and(eq(crmActivities.leadId, id), eq(crmActivities.isDeleted, 0)))
    .orderBy(desc(crmActivities.createdAt));

  res.json({
    ...formatLead(lead),
    activities: activities.map(formatActivity)
  });
}));

async function notifyWarehouseOnWonLead(lead: (Partial<typeof crmLeads.$inferSelect> & Record<string, unknown>), authorName: string, senderId?: number) {
  try {
    const targetUsers = await orm.select({ id: users.id, role: users.role }).from(users).where(
      or(
        eq(users.role, 'admin'),
        eq(users.role, 'manager'),
        eq(users.role, 'sales_manager'),
        eq(users.role, 'sales'),
        eq(users.role, 'super_admin')
      )
    );

    for (const u of targetUsers) {
      if (senderId && u.id === senderId) continue;
      await orm.insert(notifications).values({
        userId: u.id,
        senderId: senderId || null,
        senderName: authorName,
        type: 'system',
        title: `🎉 معامله موفق جدید: ${lead.title}`,
        message: `پرونده فروش با موفقیت نهایی شد.`,
        link: `/crm?leadId=${lead.id}`,
        isRead: 0
      });
    }
  } catch (err) {
    logger.error({ message: 'Error notifying managers and sales on won lead', error: err });
  }
}

// POST /api/crm/leads - Create lead
router.post('/crm/leads', authorizePermission('crm.manage'), validate(createCrmLeadSchema), asyncHandler(async (req, res) => {
  const {
    title,
    customerId,
    customerName,
    phone,
    company,
    contacts,
    source,
    stage,
    estimatedValue,
    currency,
    probability,
    assignedTo,
    assignedPersonnelId,
    expectedCloseDate,
    notes,
  } = req.body;

  // حوزه H (TD-309): پرونده تازه هنوز پیش‌فاکتور ندارد؛ «فروش موفق» فقط پس از صدور پیش‌فاکتور (همان قاعده ویرایش)
  if (stage === 'won') {
    throw new BadRequestError('پرونده فروش تازه نمی‌تواند مستقیم «فروش موفق» ثبت شود. ابتدا پیش‌فاکتور صادر کنید.');
  }

  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  // V10-4.1: فروشنده مسئول = پرسنل (id) + snapshot نام
  const assignee = await resolveAssignee({ name: assignedTo, personnelId: assignedPersonnelId });

  // v9.0.5 (TD-418): پیوند به طرف حساب یا ساخت طرف حساب تازه؛ طرف حساب موجود عوض نمی‌شود و اختلاف به یادداشت می‌رود
  const party = await linkCustomerForLead({ customerId, customerName, phone, company, title });

  const nowIso = systemNowUtcIso();

  const [newLead] = await orm.insert(crmLeads).values({
    title: title.trim(),
    customerId: party.customerId,
    customerName: customerName || '',
    phone: phone || '',
    company: company || '',
    contacts: Array.isArray(contacts) ? contacts : [],
    source: source || 'تماس تلفنی',
    stage: stage || 'lead',
    estimatedValue: money(estimatedValue || 0),
    currency: currency || 'IRR',
    probability: probability !== undefined ? Number(probability) : 50,
    assignedTo: assignee.name || authorName,
    assignedPersonnelId: assignee.id,
    expectedCloseDate: requireStorageDate(expectedCloseDate, 'تاریخ پیش‌بینی بستن فرصت فروش'),
    notes: notesWithPartyDifferences(notes || '', party.differences),
    status: stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: authorName,
    isDeleted: 0
  }).returning();

  if (stage === 'won') {
    await notifyWarehouseOnWonLead(newLead, authorName, currentUser?.id);
  }

  // Log initial creation activity
  await orm.insert(crmActivities).values({
    leadId: newLead.id,
    customerId: newLead.customerId,
    type: 'note',
    title: 'ایجاد فرصت فروش',
    description: `پرونده فروش "${newLead.title}" توسط ${authorName} ایجاد شد.`,
    loggedBy: authorName,
    ...(await crmTodayActivityDates()),
    createdAt: nowIso,
    isDeleted: 0
  });

  await logActivity({
    userId: currentUser?.id,
    username: currentUser?.username || 'user',
    userFullName: authorName,
    action: 'CREATE',
    entity: 'فرصت فروش CRM',
    entityId: String(newLead.id),
    description: `ایجاد فرصت فروش "${newLead.title}" با ارزش ${newLead.estimatedValue}`,
    ipAddress: req.ip || ''
  });

  res.status(201).json(formatLead(newLead));
}));

// PUT /api/crm/leads/:id - Update lead
router.put('/crm/leads/:id', authorizePermission('crm.manage'), validate(updateCrmLeadSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  const [existing] = await orm.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0)));
  if (!existing) {
    throw new NotFoundError('فرصت فروش یافت نشد');
  }

  const {
    title,
    customerId,
    customerName,
    phone,
    company,
    contacts,
    source,
    stage: requestedStage,
    estimatedValue,
    currency,
    probability,
    assignedTo,
    assignedPersonnelId,
    expectedCloseDate,
    notes,
    status
  } = req.body;
  // حوزه H (TD-309): وضعیت «won» بدون مرحله همان انتقال به «فروش موفق» است و از قاعده پیش‌فاکتور نمی‌گذرد
  const stage: string | undefined = requestedStage !== undefined ? requestedStage : (status === 'won' && existing.stage !== 'won' ? 'won' : undefined);

  // V10-4.1: ارجاع فروشنده — تنها وقتی مشتری جدید آمده بازresolve شود
  const assigneeProvided = assignedTo !== undefined || assignedPersonnelId !== undefined;
  const targetAssignee = assigneeProvided
    ? await resolveAssignee({
        name: assignedTo !== undefined ? assignedTo : existing.assignedTo,
        personnelId: assignedPersonnelId !== undefined ? assignedPersonnelId : null
      })
    : null;

  const targetCustId = customerId !== undefined ? customerId : existing.customerId;
  const targetCustName = customerName !== undefined ? customerName : existing.customerName;
  const targetPhone = phone !== undefined ? phone : existing.phone;
  const targetCompany = company !== undefined ? company : existing.company;
  const targetTitle = title !== undefined ? title : existing.title;

  const party = await linkCustomerForLead({
    customerId: targetCustId,
    customerName: targetCustName,
    phone: targetPhone,
    company: targetCompany,
    title: targetTitle,
  });

  const nowIso = systemNowUtcIso();
  
  // VALIDATION: Prevent moving to 'won' if no proforma exists
  if (stage === 'won' && existing.stage !== 'won') {
    if (!existing.hasProforma || Number(existing.hasProforma) !== 1) {
      throw new BadRequestError('امکان انتقال مستقیم به مرحله فروش موفق وجود ندارد. ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید.');
    }
  }

  let newStatus = status || existing.status;
  if (stage === 'won') newStatus = 'won';
  else if (stage === 'lost') newStatus = 'lost';
  else if (stage && stage !== 'won' && stage !== 'lost') newStatus = 'active';

  const [updated] = await orm.update(crmLeads).set({
    title: title !== undefined ? title.trim() : existing.title,
    customerId: party.customerId,
    customerName: customerName !== undefined ? customerName : existing.customerName,
    phone: phone !== undefined ? phone : existing.phone,
    company: company !== undefined ? company : existing.company,
    contacts: contacts !== undefined ? (Array.isArray(contacts) ? contacts : []) : existing.contacts,
    source: source !== undefined ? source : existing.source,
    stage: stage !== undefined ? stage : existing.stage,
    estimatedValue: estimatedValue !== undefined ? money(estimatedValue) : existing.estimatedValue,
    currency: currency !== undefined ? currency : existing.currency,
    probability: probability !== undefined ? Number(probability) : existing.probability,
    assignedTo: targetAssignee ? (targetAssignee.name || authorName) : existing.assignedTo,
    assignedPersonnelId: targetAssignee ? targetAssignee.id : existing.assignedPersonnelId,
    expectedCloseDate: optionalStorageDate(expectedCloseDate, 'تاریخ پیش‌بینی بستن فرصت فروش') ?? existing.expectedCloseDate,
    notes: notesWithPartyDifferences(notes !== undefined ? notes : existing.notes, party.differences),
    status: newStatus,
    updatedAt: nowIso
  }).where(eq(crmLeads.id, id)).returning();

  if (stage === 'won' && existing.stage !== 'won') {
    await notifyWarehouseOnWonLead(updated, authorName, currentUser?.id);
  }

  // Log stage change activity if stage changed
  if (stage && stage !== existing.stage) {
    const stageLabels: Record<string, string> = {
      lead: 'مخاطب اولیه',
      qualified: 'ارزیابی و نیازسنجی',
      proposal: 'پیش‌فاکتور و پیشنهاد',
      won: 'موفق (بسته شد)',
      lost: 'ناموفق (انصراف)'
    };
    await orm.insert(crmActivities).values({
      leadId: id,
      customerId: updated.customerId,
      type: 'task',
      title: 'تغییر مرحله فروش',
      description: `مرحله فروش از "${stageLabels[existing.stage || ''] || existing.stage || ''}" به "${stageLabels[stage] || stage}" تغییر یافت.`,
      loggedBy: authorName,
      ...(await crmTodayActivityDates()),
      createdAt: nowIso,
      isDeleted: 0
    });
  }

  await logActivity({
    userId: currentUser?.id,
    username: currentUser?.username || 'user',
    userFullName: authorName,
    action: 'UPDATE',
    entity: 'فرصت فروش CRM',
    entityId: String(id),
    description: `ویرایش فرصت فروش "${updated.title}"`,
    ipAddress: req.ip || ''
  });

  res.json(formatLead(updated));
}));

// POST /api/crm/leads/:id/convert-to-customer
router.post('/crm/leads/:id/convert-to-customer', authorizePermission('crm.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  const [lead] = await orm.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0)));
  if (!lead) {
    throw new NotFoundError('پرونده فروش یافت نشد');
  }

  // پیوند پرونده به طرف حساب یا ساخت طرف حساب تازه (v9.0.5، TD-418: طرف حساب موجود عوض نمی‌شود)
  const party = await linkCustomerForLead({
    customerId: lead.customerId,
    customerName: lead.customerName,
    phone: lead.phone,
    company: lead.company,
    title: lead.title,
  });
  const resolvedCustomerId = party.customerId;

  const nowIso = systemNowUtcIso();
  // V10-4.3: قانون نرم — تبدیل به مشتری هرگز وضعیت «موفق» را از بین نمی‌برد (بدون تقدم اجباری proposal/active)
  const preserveWonState = lead.stage === 'won' || lead.status === 'won';
  const [updated] = await orm.update(crmLeads).set({
    customerId: resolvedCustomerId,
    notes: notesWithPartyDifferences(lead.notes, party.differences),
    stage: preserveWonState ? lead.stage : 'proposal',
    status: preserveWonState ? lead.status : 'active',
    updatedAt: nowIso
  }).where(eq(crmLeads.id, id)).returning();

  // Fetch customer details if exists
  let customerObj: typeof customers.$inferSelect | null = null;
  if (resolvedCustomerId) {
    const [c] = await orm.select().from(customers).where(eq(customers.id, resolvedCustomerId));
    customerObj = c || null;
  }

  // Log activity
  await orm.insert(crmActivities).values({
    leadId: id,
    customerId: resolvedCustomerId,
    type: 'task',
    title: 'تبدیل لید به مشتری و صدور پیش‌فاکتور',
    description: `پرونده فروش CRM "${lead.title}" توسط ${authorName} به مشتری رسمی تبدیل شد و جهت صدور پیش‌فاکتور هدایت شد.`,
    loggedBy: authorName,
    ...(await crmTodayActivityDates()),
    createdAt: nowIso,
    isDeleted: 0
  });

  res.json({
    message: 'لید با موفقیت به مشتری رسمی تبدیل شد',
    lead: formatLead(updated),
    customer: customerObj
  });
}));

// DELETE /api/crm/leads/:id
// v9.0.16 (TD-425): زیر قفل پرونده؛ پرونده ناموجود ۴۰۴ و پرونده دارای سند فعال ۴۰۹ (`deleteLead`)، لاگ ممیزی در همان تراکنش
router.delete('/crm/leads/:id', authorizePermission('crm.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;

  await orm.transaction(async (tx) => {
    const lead = await deleteLead(tx, id);
    await logActivity({
      userId: currentUser?.id,
      username: currentUser?.username || 'user',
      userFullName: currentUser?.full_name || currentUser?.username || '',
      action: 'DELETE',
      entity: 'فرصت فروش CRM',
      entityId: String(id),
      description: `حذف پرونده فروش «${lead.title}» (کد ${id})`,
      details: { before: lead },
      ipAddress: req.ip || '',
      tx,
    });
  });

  res.json({ message: 'فرصت فروش با موفقیت حذف شد' });
}));

// GET /api/crm/activities - List activities & call logs
router.get('/crm/activities', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (req, res) => {
  const { leadId, customerId, type, pendingFollowupsOnly, fromDate, toDate } = req.query;

  // v9.0.16 (TD-425): اقدام‌های پرونده حذف‌شده فهرست نمی‌شوند
  const conditions = [eq(crmActivities.isDeleted, 0), liveLeadActivityCondition()];

  if (leadId) {
    conditions.push(eq(crmActivities.leadId, Number(leadId)));
  }

  if (customerId) {
    conditions.push(eq(crmActivities.customerId, Number(customerId)));
  }

  if (type && typeof type === 'string' && type.trim()) {
    conditions.push(eq(crmActivities.type, type.trim()));
  }

  if (pendingFollowupsOnly === 'true') {
    conditions.push(eq(crmActivities.isFollowUpCompleted, 0));
    conditions.push(sql`length(COALESCE(${crmActivities.nextFollowUpDate}, '')) > 0`);
  }

  // v7.0.132 (TD-232): بازه شمسی (یا میلادی) ورودی به ISO تبدیل و با تاریخ ذخیره‌شده ISO مقایسه می‌شود
  if (fromDate && typeof fromDate === 'string' && fromDate.trim()) {
    const fIso = requireStorageDate(fromDate, 'از تاریخ');
    conditions.push(sql`(${crmActivities.activityDate} >= ${fIso}::text OR COALESCE(${crmActivities.activityDate}, '') = '')`);
  }

  if (toDate && typeof toDate === 'string' && toDate.trim()) {
    const tIso = requireStorageDate(toDate, 'تا تاریخ');
    conditions.push(sql`(${crmActivities.activityDate} <= ${tIso}::text OR COALESCE(${crmActivities.activityDate}, '') = '')`);
  }

  const activities = await orm.select({
    id: crmActivities.id,
    leadId: crmActivities.leadId,
    customerId: crmActivities.customerId,
    type: crmActivities.type,
    title: crmActivities.title,
    description: crmActivities.description,
    result: crmActivities.result,
    loggedBy: crmActivities.loggedBy,
    assignedTo: crmActivities.assignedTo,
    assignedPersonnelId: crmActivities.assignedPersonnelId,
    mentions: crmActivities.mentions,
    activityDate: crmActivities.activityDate,
    activityDateIso: crmActivities.activityDateIso,
    nextFollowUpDate: crmActivities.nextFollowUpDate,
    nextFollowUpDateIso: crmActivities.nextFollowUpDateIso,
    nextFollowUpTask: crmActivities.nextFollowUpTask,
    isFollowUpCompleted: crmActivities.isFollowUpCompleted,
    createdAt: crmActivities.createdAt,
    isDeleted: crmActivities.isDeleted,
    leadTitle: crmLeads.title,
    leadCustomerName: crmLeads.customerName,
    customerName: customers.name,
  })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .leftJoin(customers, eq(crmActivities.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(crmActivities.createdAt))
    .limit(Math.min(Number(req.query.limit) || 200, 500));

  res.json(activities.map(formatActivity));
}));

// v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): پیگیری‌ها بی بازه تاریخ اقدام و با صفحه‌بندی (`listFollowups`)؛
// پیش‌تر فهرست پیگیری‌ها از اقدام‌های ۳۰ روز اخیر با سقف ۲۰۰ ردیف ساخته می‌شد
const followupsQuerySchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'completed', 'all']).optional(),
    due: z.enum(['all', 'due']).optional(),
    assignedPersonnelId: numericIdString.optional(),
    search: z.string().max(200).optional(),
    page: numericIdString.optional(),
    limit: numericIdString.optional(),
  }).passthrough(),
}).passthrough();

router.get('/crm/followups', authorizePermission('crm.view', 'customers.view', 'customers.manage'), validate(followupsQuerySchema), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const { page } = parsePagination(q, { page: 1, limit: 50 });
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const { rows, ...meta } = await listFollowups({
    status: (q.status as FollowupStatus | undefined) ?? 'pending',
    dueOnly: q.due === 'due',
    assignedPersonnelId: q.assignedPersonnelId ? Number(q.assignedPersonnelId) : undefined,
    search: q.search,
    page,
    limit,
  });
  res.json({ ...meta, data: rows.map(formatActivity) });
}));

// POST /api/crm/activities - Add call log/action
router.post('/crm/activities', authorizePermission('crm.manage'), validate(createCrmActivitySchema), asyncHandler(async (req, res) => {
  const {
    leadId,
    customerId,
    type,
    title,
    description,
    result,
    activityDate,
    nextFollowUpDate,
    nextFollowUpTask,
    assignedTo,
    assignedPersonnelId,
    mentions
  } = req.body;

  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';
  const nowIso = systemNowUtcIso();
  // v7.0.132 (TD-232): تاریخ شمسی ورودی میلادی ISO ذخیره می‌شود؛ تاریخ نامعتبر با 422 رد می‌شود
  const actDateIso = requireStorageDate(activityDate, 'تاریخ اقدام') || await businessTodayIsoDate();
  const nextFollowIso = requireStorageDate(nextFollowUpDate, 'تاریخ پیگیری بعدی');

  // V10-4.1: مسئول تسک از پرسنل (id) + snapshot نام
  const taskAssignee = await resolveAssignee({
    name: assignedTo || authorName,
    personnelId: assignedPersonnelId
  });
  const mentionsList = Array.isArray(mentions) ? mentions : [];
  // v9.0.17 (TD-426): پرونده و طرف حساب ناموجود یا حذف‌شده با ۴۲۲ رد می‌شوند (`resolveActivityParents`)
  const parents = await resolveActivityParents(orm, { leadId, customerId });

  const [newAct] = await orm.insert(crmActivities).values({
    leadId: parents.leadId,
    customerId: parents.customerId,
    type: type || 'call',
    title: title.trim(),
    description: description || '',
    result: result || '',
    loggedBy: authorName,
    assignedTo: taskAssignee.name,
    assignedPersonnelId: taskAssignee.id,
    mentions: mentionsList,
    activityDate: actDateIso,
    activityDateIso: actDateIso,
    nextFollowUpDate: nextFollowIso,
    nextFollowUpDateIso: nextFollowIso,
    nextFollowUpTask: nextFollowUpTask || '',
    isFollowUpCompleted: 0,
    createdAt: nowIso,
    isDeleted: 0
  }).returning();

  // Send notifications to mentioned users
  try {
    const targetUserIds = new Set<number>();
    if (Array.isArray(mentions)) {
      for (const item of mentions) {
        if (typeof item === 'number' && item > 0) targetUserIds.add(item);
        else if (typeof item === 'string' && item.trim()) {
          const [u] = await orm.select({ id: users.id }).from(users).where(
            or(eq(users.username, item.trim()), eq(users.fullName, item.trim()))
          );
          if (u) targetUserIds.add(u.id);
        }
      }
    }

    // Check description for @mentions as well
    if (description) {
      const allSysUsers = await orm.select({ id: users.id, username: users.username, fullName: users.fullName })
        .from(users)
        .where(notSyntheticTestUsername(users.username));
      for (const u of allSysUsers) {
        if (u.username && description.includes(`@${u.username}`)) targetUserIds.add(u.id);
        if (u.fullName && description.includes(`@${u.fullName}`)) targetUserIds.add(u.id);
      }
    }

    for (const targetId of targetUserIds) {
      if (targetId !== currentUser?.id) {
        await orm.insert(notifications).values({
          userId: targetId,
          senderId: currentUser?.id,
          senderName: authorName,
          type: 'mention',
          title: 'منشن در فعالیت CRM',
          message: `${authorName} شما را در فعالیت CRM ("${title}") منشن کرد.`,
          link: `/crm?activityId=${newAct.id}`,
          isRead: 0
        });
      }
    }
  } catch (notifErr) {
    logger.error({ message: 'Error sending CRM mention notifications', error: notifErr });
  }

  // Send notification for task/follow-up assignment
  if (nextFollowUpTask || nextFollowUpDate) {
    try {
      // V10-4.1: اولویت اطلاع‌رسانی با لینک personnel.userId، سپس تطابق نام
      let targetUserId: number | null | undefined = null;
      if (newAct.assignedPersonnelId) {
        const [pRow] = await orm.select({ userId: personnel.userId })
          .from(personnel)
          .where(eq(personnel.id, Number(newAct.assignedPersonnelId)));
        targetUserId = pRow?.userId ?? null;
      }
      if (!targetUserId && taskAssignee.name) {
        const [assignedUser] = await orm.select().from(users).where(
          or(eq(users.fullName, taskAssignee.name), eq(users.username, taskAssignee.name))
        );
        targetUserId = assignedUser?.id ?? null;
      }
      const notifUserId = targetUserId || currentUser?.id;
      if (notifUserId) {
        await orm.insert(notifications).values({
          userId: notifUserId,
          senderId: currentUser?.id,
          senderName: authorName,
          type: 'task',
          title: 'تسک / پیگیری جدید CRM',
          message: `${authorName} تسک پیگیری جدید برای شما ثبت کرد: "${nextFollowUpTask || title}" (تاریخ سررسید: ${toPersianDigits(isoToJalaliDate(nextFollowIso || actDateIso))})`,
          link: `/crm?activityId=${newAct.id}`,
          isRead: 0
        });
      }
    } catch (taskNotifErr) {
      logger.error({ message: 'Error sending task assignment notification', error: taskNotifErr });
    }
  }

  // Update lead's updatedAt timestamp
  if (parents.leadId) {
    await orm.update(crmLeads)
      .set({ updatedAt: nowIso })
      .where(eq(crmLeads.id, parents.leadId));
  }

  await logActivity({
    userId: currentUser?.id,
    username: currentUser?.username || 'user',
    userFullName: authorName,
    action: 'CREATE',
    entity: 'اقدام و تماس CRM',
    entityId: String(newAct.id),
    description: `ثبت ${type === 'call' ? 'تماس' : 'اقدام'} "${title}"`,
    ipAddress: req.ip || ''
  });

  res.status(201).json(formatActivity(newAct));
}));

// PUT /api/crm/activities/:id/toggle-followup
router.put('/crm/activities/:id/toggle-followup', authorizePermission('crm.manage'), validate(toggleFollowupSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { result, resultNote } = req.body || {};
  const [act] = await orm.select().from(crmActivities).where(and(eq(crmActivities.id, id), eq(crmActivities.isDeleted, 0)));

  if (!act) {
    throw new NotFoundError('اقدام یافت نشد');
  }

  const newCompleted = act.isFollowUpCompleted === 1 ? 0 : 1;
  const updateData: Partial<typeof crmActivities.$inferInsert> = { isFollowUpCompleted: newCompleted };

  if (result && typeof result === 'string' && result.trim()) {
    updateData.result = result.trim();
  }

  if (resultNote && typeof resultNote === 'string' && resultNote.trim()) {
    const currentDesc = act.description || '';
    const todayJalali = isoToJalaliDate(await businessTodayIsoDate());
    const noteAppend = `\n[نتیجه پیگیری (${todayJalali})]: ${resultNote.trim()}`;
    updateData.description = currentDesc ? `${currentDesc}${noteAppend}` : `[نتیجه پیگیری (${todayJalali})]: ${resultNote.trim()}`;
  }

  const [updated] = await orm.update(crmActivities)
    .set(updateData)
    .where(eq(crmActivities.id, id))
    .returning();

  res.json(formatActivity(updated));
}));

export default router;
