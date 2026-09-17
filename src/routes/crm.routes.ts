import { Router } from 'express';
import { eq, desc, and, ilike, sql, gte, lte, or } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { crmLeads, crmActivities, customers, users, notifications, personnel } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { parsePagination } from '../lib/pagination.js';
import { getTodayJalaliDate, jalaliToIsoDate } from '../utils.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../lib/businessClock.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, BadRequestError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';

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
    activity_date_iso: act.activityDateIso || jalaliToIsoDate(act.activityDate) || '',
    activityDateIso: act.activityDateIso || jalaliToIsoDate(act.activityDate) || '',
    next_followup_date: act.nextFollowUpDate || '',
    nextFollowUpDate: act.nextFollowUpDate || '',
    next_followup_date_iso: act.nextFollowUpDateIso || jalaliToIsoDate(act.nextFollowUpDate) || '',
    nextFollowUpDateIso: act.nextFollowUpDateIso || jalaliToIsoDate(act.nextFollowUpDate) || '',
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
router.get('/crm/stats', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (req, res) => {
  const todayJalali = getTodayJalaliDate();

  // Total active leads
  const [allActiveLeads] = await orm.select({
    count: sql<number>`count(*)`,
    totalValue: sql<number>`COALESCE(sum(estimated_value), 0)`
  })
  .from(crmLeads)
  .where(and(eq(crmLeads.isDeleted, 0), eq(crmLeads.status, 'active')));

  // Won leads
  const [wonLeads] = await orm.select({
    count: sql<number>`count(*)`,
    totalValue: sql<number>`COALESCE(sum(estimated_value), 0)`
  })
  .from(crmLeads)
  .where(and(eq(crmLeads.isDeleted, 0), eq(crmLeads.stage, 'won')));

  // Followups due today or overdue
  const todayIso = await businessTodayIsoDate();
  const pendingFollowups = await orm.select({
    count: sql<number>`count(*)`
  })
  .from(crmActivities)
  .where(and(
    eq(crmActivities.isDeleted, 0),
    eq(crmActivities.isFollowUpCompleted, 0),
    sql`length(COALESCE(${crmActivities.nextFollowUpDate}, '')) > 0`,
    sql`(
      (${crmActivities.nextFollowUpDateIso} IS NOT NULL AND ${crmActivities.nextFollowUpDateIso} <= ${todayIso}::text) OR
      (COALESCE(${crmActivities.nextFollowUpDate}, '') <= ${todayJalali}::text)
    )`
  ));

  // Stage counts
  const stageCounts = await orm.select({
    stage: crmLeads.stage,
    count: sql<number>`count(*)`,
    totalValue: sql<number>`COALESCE(sum(estimated_value), 0)`
  })
  .from(crmLeads)
  .where(eq(crmLeads.isDeleted, 0))
  .groupBy(crmLeads.stage);

  res.json({
    activeLeadsCount: Number(allActiveLeads?.count || 0),
    totalPipelineValue: Number(allActiveLeads?.totalValue || 0),
    wonLeadsCount: Number(wonLeads?.count || 0),
    wonTotalValue: Number(wonLeads?.totalValue || 0),
    pendingFollowupsCount: Number(pendingFollowups[0]?.count || 0),
    stageCounts: stageCounts.reduce((acc: Record<string, { count: number; value: number }>, row: { stage: string | null; count: number | string; totalValue: number | string }) => {
      if (row.stage) {
        acc[row.stage] = { count: Number(row.count), value: Number(row.totalValue) };
      }
      return acc;
    }, {})
  });
}));

// GET /api/crm/leads - Get list of leads
router.get('/crm/leads', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (req, res) => {
  const { stage, status, assignedTo, assignedPersonnelId, source, search, customerId, customerName, fromDate, toDate } = req.query;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const isPaginated = req.query.paginate === 'true' || page !== undefined;

  const conditions = [eq(crmLeads.isDeleted, 0)];

  if (customerId && !isNaN(Number(customerId))) {
    conditions.push(eq(crmLeads.customerId, Number(customerId)));
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
    const s = `%${search.trim()}%`;
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

  const leads = await orm.select()
    .from(crmLeads)
    .where(whereClause)
    .orderBy(desc(crmLeads.updatedAt), desc(crmLeads.id));

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

// V10-4.3: ثبت لاگ حسابرسی برای تغییرات بی‌سروصدای مشتری هنگام sync از CRM (قبل/بعد)
interface CrmAuditContext {
  userId?: number | null;
  username?: string;
  userFullName?: string;
}

async function logCustomerSyncDiff(
  customerId: number,
  changes: Array<{ field: string; before: unknown; after: unknown }>,
  auditCtx?: CrmAuditContext
): Promise<void> {
  if (!changes.length) return;
  try {
    await logActivity({
      userId: auditCtx?.userId ?? undefined,
      username: auditCtx?.username || 'user',
      userFullName: auditCtx?.userFullName || '',
      action: 'UPDATE',
      entity: 'طرفین حساب',
      entityId: String(customerId),
      description: `همگام‌سازی خودکار از CRM: ${changes.length} فیلد مشتری «#${customerId}» به‌روزرسانی شد (${changes.map(c => c.field).join('، ')})`,
      details: {
        source: 'syncCustomerFromCRMLead',
        changes
      }
    });
  } catch (e) {
    logger.error({ message: 'Failed to write customer sync audit diff', error: e });
  }
}

async function syncCustomerFromCRMLead(
  customerIdInput: number | string | null | undefined,
  customerName: string | undefined,
  phone: string | undefined,
  company: string | undefined,
  title: string | undefined,
  auditCtx?: CrmAuditContext
): Promise<number | null> {
  const cName = customerName?.trim() || '';
  const cCompany = company?.trim() || '';
  const cPhone = phone?.trim() || '';

  // Company Name takes precedence as Customer Name in parties database if available
  const primaryCustomerName = cCompany || cName || title?.trim() || 'مشتری جدید CRM';
  const contactPersonName = cCompany ? cName : (cName !== primaryCustomerName ? cName : '');

  if (!cName && !cCompany && !cPhone && !customerIdInput) {
    return null;
  }

  let existingCustomerId = customerIdInput ? Number(customerIdInput) : null;

  // 1. If explicit customerId provided
  if (existingCustomerId) {
    const [cust] = await orm.select().from(customers).where(and(eq(customers.id, existingCustomerId), eq(customers.isDeleted, 0)));
    if (cust) {
      // V10-4.3: هیچ overwrite بی‌سروصدایی بدون گزارش اختلاف قبل-بعد انجام نشود
      const pendingChanges: Array<{ field: string; before: unknown; after: unknown }> = [];
      const queueChange = (field: 'phone' | 'contactName' | 'name', afterVal: string | null) => {
        const beforeVal = (cust as Record<string, unknown>)[field] ?? null;
        if ((afterVal ?? '') !== '' && String(beforeVal ?? '') !== String(afterVal)) {
          pendingChanges.push({ field, before: beforeVal, after: afterVal });
          (cust as Record<string, unknown>)[field] = afterVal;
        }
      };

      if (cPhone && cust.phone !== cPhone) queueChange('phone', cPhone);
      if (contactPersonName && !cust.contactName) queueChange('contactName', contactPersonName);
      if (cCompany && cust.name !== cCompany && (!cust.name || cust.name === cName)) {
        queueChange('name', cCompany);
        if (cName) queueChange('contactName', cName);
      }

      if (pendingChanges.length > 0) {
        const updates: Record<string, unknown> = {};
        for (const ch of pendingChanges) updates[ch.field] = ch.after;
        await orm.update(customers).set(updates).where(eq(customers.id, existingCustomerId));
        await logCustomerSyncDiff(existingCustomerId, pendingChanges, auditCtx);
      }
      return existingCustomerId;
    }
  }

  // 2. If no valid customerId provided, search by phone or company/name in customers table
  if (cPhone) {
    const [foundByPhone] = await orm.select().from(customers).where(and(eq(customers.phone, cPhone), eq(customers.isDeleted, 0)));
    if (foundByPhone) {
      const pendingChanges: Array<{ field: string; before: unknown; after: unknown }> = [];
      const queueChange = (field: 'contactName' | 'name', afterVal: string | null) => {
        const beforeVal = (foundByPhone as Record<string, unknown>)[field] ?? null;
        if ((afterVal ?? '') !== '' && String(beforeVal ?? '') !== String(afterVal)) {
          pendingChanges.push({ field, before: beforeVal, after: afterVal });
          (foundByPhone as Record<string, unknown>)[field] = afterVal;
        }
      };

      if (cCompany && foundByPhone.name !== cCompany) {
        queueChange('name', cCompany);
        if (cName) queueChange('contactName', cName);
      } else if (cName && !foundByPhone.contactName) {
        queueChange('contactName', cName);
      }
      if (Object.keys(pendingChanges).length > 0) {
        const updates: Record<string, unknown> = {};
        for (const ch of pendingChanges) updates[ch.field] = ch.after;
        await orm.update(customers).set(updates).where(eq(customers.id, foundByPhone.id));
        await logCustomerSyncDiff(foundByPhone.id, pendingChanges, auditCtx);
      }
      return foundByPhone.id;
    }
  }

  if (primaryCustomerName) {
    const [foundByName] = await orm.select().from(customers).where(and(eq(customers.name, primaryCustomerName), eq(customers.isDeleted, 0)));
    if (foundByName) {
      const pendingChanges: Array<{ field: string; before: unknown; after: unknown }> = [];
      const queueChange = (field: 'phone' | 'contactName', afterVal: string | null) => {
        const beforeVal = (foundByName as Record<string, unknown>)[field] ?? null;
        if ((afterVal ?? '') !== '' && String(beforeVal ?? '') !== String(afterVal)) {
          pendingChanges.push({ field, before: beforeVal, after: afterVal });
          (foundByName as Record<string, unknown>)[field] = afterVal;
        }
      };

      if (cPhone && !foundByName.phone) queueChange('phone', cPhone);
      if (contactPersonName && !foundByName.contactName) queueChange('contactName', contactPersonName);

      if (pendingChanges.length > 0) {
        const updates: Record<string, unknown> = {};
        for (const ch of pendingChanges) updates[ch.field] = ch.after;
        await orm.update(customers).set(updates).where(eq(customers.id, foundByName.id));
        await logCustomerSyncDiff(foundByName.id, pendingChanges, auditCtx);
      }
      return foundByName.id;
    }
  }

  // 3. Otherwise, create a new customer record in customers (طرفین حساب)
  const createdAt = systemNowUtcIso();
  const [newCust] = await orm.insert(customers).values({
    name: primaryCustomerName,
    contactName: contactPersonName || cName,
    phone: cPhone,
    notes: 'ثبت شده اتوماتیک از طریق سیستم CRM',
    createdAt,
    isDeleted: 0
  }).returning({ id: customers.id });

  return newCust ? newCust.id : null;
}

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

  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  // V10-4.1: فروشنده مسئول = پرسنل (id) + snapshot نام
  const assignee = await resolveAssignee({ name: assignedTo, personnelId: assignedPersonnelId });

  // Auto register or update customer in customers (طرفین حساب)
  const resolvedCustomerId = await syncCustomerFromCRMLead(
    customerId,
    customerName,
    phone,
    company,
    title,
    { userId: currentUser?.id, username: currentUser?.username, userFullName: authorName }
  );

  const nowIso = systemNowUtcIso();

  const [newLead] = await orm.insert(crmLeads).values({
    title: title.trim(),
    customerId: resolvedCustomerId,
    customerName: customerName || '',
    phone: phone || '',
    company: company || '',
    contacts: Array.isArray(contacts) ? contacts : [],
    source: source || 'تماس تلفنی',
    stage: stage || 'lead',
    estimatedValue: Number(estimatedValue || 0),
    currency: currency || 'IRR',
    probability: probability !== undefined ? Number(probability) : 50,
    assignedTo: assignee.name || authorName,
    assignedPersonnelId: assignee.id,
    expectedCloseDate: expectedCloseDate || '',
    notes: notes || '',
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
    activityDate: await businessTodayIsoDate(),
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
    stage,
    estimatedValue,
    currency,
    probability,
    assignedTo,
    assignedPersonnelId,
    expectedCloseDate,
    notes,
    status
  } = req.body;

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

  const resolvedCustomerId = await syncCustomerFromCRMLead(
    targetCustId,
    targetCustName,
    targetPhone,
    targetCompany,
    targetTitle,
    { userId: currentUser?.id, username: currentUser?.username, userFullName: authorName }
  );

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
    customerId: resolvedCustomerId,
    customerName: customerName !== undefined ? customerName : existing.customerName,
    phone: phone !== undefined ? phone : existing.phone,
    company: company !== undefined ? company : existing.company,
    contacts: contacts !== undefined ? (Array.isArray(contacts) ? contacts : []) : existing.contacts,
    source: source !== undefined ? source : existing.source,
    stage: stage !== undefined ? stage : existing.stage,
    estimatedValue: estimatedValue !== undefined ? Number(estimatedValue) : existing.estimatedValue,
    currency: currency !== undefined ? currency : existing.currency,
    probability: probability !== undefined ? Number(probability) : existing.probability,
    assignedTo: targetAssignee ? (targetAssignee.name || authorName) : existing.assignedTo,
    assignedPersonnelId: targetAssignee ? targetAssignee.id : existing.assignedPersonnelId,
    expectedCloseDate: expectedCloseDate !== undefined ? expectedCloseDate : existing.expectedCloseDate,
    notes: notes !== undefined ? notes : existing.notes,
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
      description: `مرحله فروش از "${stageLabels[existing.stage] || existing.stage}" به "${stageLabels[stage] || stage}" تغییر یافت.`,
      loggedBy: authorName,
      activityDate: await businessTodayIsoDate(),
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

  // Convert lead to formal customer in customers table
  const resolvedCustomerId = await syncCustomerFromCRMLead(
    lead.customerId,
    lead.customerName,
    lead.phone,
    lead.company,
    lead.title,
    { userId: currentUser?.id, username: currentUser?.username, userFullName: authorName }
  );

  const nowIso = systemNowUtcIso();
  // V10-4.3: قانون نرم — تبدیل به مشتری هرگز وضعیت «موفق» را از بین نمی‌برد (بدون تقدم اجباری proposal/active)
  const preserveWonState = lead.stage === 'won' || lead.status === 'won';
  const [updated] = await orm.update(crmLeads).set({
    customerId: resolvedCustomerId,
    stage: preserveWonState ? lead.stage : 'proposal',
    status: preserveWonState ? lead.status : 'active',
    updatedAt: nowIso
  }).where(eq(crmLeads.id, id)).returning();

  // Fetch customer details if exists
  let customerObj = null;
  if (resolvedCustomerId) {
    const [c] = await orm.select().from(customers).where(eq(customers.id, resolvedCustomerId));
    customerObj = c;
  }

  // Log activity
  await orm.insert(crmActivities).values({
    leadId: id,
    customerId: resolvedCustomerId,
    type: 'task',
    title: 'تبدیل لید به مشتری و صدور پیش‌فاکتور',
    description: `پرونده فروش CRM "${lead.title}" توسط ${authorName} به مشتری رسمی تبدیل شد و جهت صدور پیش‌فاکتور هدایت شد.`,
    loggedBy: authorName,
    activityDate: await businessTodayIsoDate(),
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
router.delete('/crm/leads/:id', authorizePermission('crm.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;

  await orm.update(crmLeads).set({ isDeleted: 1 }).where(eq(crmLeads.id, id));

  await logActivity({
    userId: currentUser?.id,
    username: currentUser?.username || 'user',
    userFullName: currentUser?.full_name || currentUser?.username || '',
    action: 'DELETE',
    entity: 'فرصت فروش CRM',
    entityId: String(id),
    description: `حذف فرصت فروش کد ${id}`,
    ipAddress: req.ip || ''
  });

  res.json({ message: 'فرصت فروش با موفقیت حذف شد' });
}));

// GET /api/crm/activities - List activities & call logs
router.get('/crm/activities', authorizePermission('crm.view', 'customers.view', 'customers.manage'), asyncHandler(async (req, res) => {
  const { leadId, customerId, type, pendingFollowupsOnly, fromDate, toDate } = req.query;

  const conditions = [eq(crmActivities.isDeleted, 0)];

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

  if (fromDate && typeof fromDate === 'string' && fromDate.trim()) {
    const f = fromDate.trim();
    const fIso = jalaliToIsoDate(f) || f;
    conditions.push(sql`(${crmActivities.activityDateIso} >= ${fIso}::text OR ${crmActivities.activityDate} >= ${f}::text OR COALESCE(${crmActivities.activityDate}, '') = '')`);
  }

  if (toDate && typeof toDate === 'string' && toDate.trim()) {
    const t = toDate.trim();
    const tIso = jalaliToIsoDate(t) || t;
    conditions.push(sql`(${crmActivities.activityDateIso} <= ${tIso}::text OR ${crmActivities.activityDate} <= ${t}::text OR COALESCE(${crmActivities.activityDate}, '') = '')`);
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
    .orderBy(desc(crmActivities.createdAt));

  res.json(activities.map(formatActivity));
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
  const todayStr = activityDate || await businessTodayIsoDate();
  const actDateIso = jalaliToIsoDate(todayStr) || (todayStr.includes('-') ? todayStr.slice(0, 10) : nowIso.slice(0, 10));
  const nextFollowIso = nextFollowUpDate ? (jalaliToIsoDate(nextFollowUpDate) || (nextFollowUpDate.includes('-') ? nextFollowUpDate.slice(0, 10) : null)) : null;

  // V10-4.1: مسئول تسک از پرسنل (id) + snapshot نام
  const taskAssignee = await resolveAssignee({
    name: assignedTo || authorName,
    personnelId: assignedPersonnelId
  });
  const mentionsList = Array.isArray(mentions) ? mentions : [];

  const [newAct] = await orm.insert(crmActivities).values({
    leadId: leadId ? Number(leadId) : null,
    customerId: customerId ? Number(customerId) : null,
    type: type || 'call',
    title: title.trim(),
    description: description || '',
    result: result || '',
    loggedBy: authorName,
    assignedTo: taskAssignee.name,
    assignedPersonnelId: taskAssignee.id,
    mentions: mentionsList,
    activityDate: todayStr,
    activityDateIso: actDateIso,
    nextFollowUpDate: nextFollowUpDate || '',
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
        .where(sql`${users.username} NOT ILIKE 'testuser_%' AND ${users.username} NOT ILIKE 'test_%' AND ${users.username} NOT ILIKE 'e2e_%'`);
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
          message: `${authorName} تسک پیگیری جدید برای شما ثبت کرد: "${nextFollowUpTask || title}" (تاریخ سررسید: ${nextFollowUpDate || todayStr})`,
          link: `/crm?activityId=${newAct.id}`,
          isRead: 0
        });
      }
    } catch (taskNotifErr) {
      logger.error({ message: 'Error sending task assignment notification', error: taskNotifErr });
    }
  }

  // Update lead's updatedAt timestamp
  if (leadId) {
    await orm.update(crmLeads)
      .set({ updatedAt: nowIso })
      .where(eq(crmLeads.id, Number(leadId)));
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
    const todayJalali = getTodayJalaliDate();
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
