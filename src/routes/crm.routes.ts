import { Router } from 'express';
import { eq, desc, and, sql, gte, lte, or } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { crmLeads, crmActivities, customers, users, personnel } from '../db/schema.js';
import { createNotifications } from '../services/notifications/notificationCreator.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { parsePagination } from '../lib/pagination.js';
import { isoToJalaliDate, toPersianDigits } from '../utils.js';
import { requireStorageDate, optionalStorageDate, crmTodayActivityDates } from '../lib/storageDate.js';
import { businessTodayIsoDate, systemNowUtcIso } from '../lib/businessClock.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, decimalInput } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, BadRequestError } from '../errors/customErrors.js';
import { logger } from '../middleware/logger.js';
import { money } from '../lib/money.js';
import { linkCustomerForLead, notesWithPartyDifferences } from '../services/crm/crmCustomerLink.js';
import { getCrmStats } from '../services/crm/crmStats.js';
import { listFollowups, liveLeadActivityCondition, nextFollowupDatesByLead, type FollowupStatus } from '../services/crm/crmFollowups.js';
import { deleteLead } from '../services/crm/crmLeadDelete.js';
import { leadAuditDetails } from '../services/crm/crmLeadAudit.js';
import { setFollowupCompleted } from '../services/crm/crmFollowupStatus.js';
import { resolveActivityParents } from '../services/crm/crmActivityParents.js';
import { notifyActivityMentions, resolveActivityMentions } from '../services/crm/crmActivityMentions.js';
import { CRM_BOARD_LEAD_CAP, CRM_LEAD_CURRENCIES, CRM_LEAD_STAGES, CRM_LEAD_STATUSES, CRM_LOST_REASONS, CRM_LOST_REASON_NOTE_MAX, isLeadProbability, normalizeLeadCurrency } from '../lib/crm/leadFields.js';
import { recordLeadStageChange } from '../services/crm/crmLeadStageHistory.js';
import { crmFunnelReport } from '../services/crm/crmFunnelReport.js';
import { resolveLeadLostReason } from '../services/crm/crmLeadLostReason.js';
import { activityPartyCondition, leadCustomerCondition } from '../services/crm/crmLeadCustomerFilter.js';
import { CrmAttachmentService } from '../services/crm/crmAttachments.service.js';
import { leadCustomerHasTagCondition } from '../services/customers/customerTags.service.js';
import { canSeePartyBankInfo, withoutBankInfo } from '../services/customers/partyBankInfoAccess.js';
import { permissionHolderUserIdsWith } from '../services/notifications/notificationRecipients.js';
import { assertSoldLeadStaysWon, notifyLeadWon, openLeadsFirst, resolveLeadStageStatus } from '../services/crm/crmLeadOutcome.js';
import { resolveAssignee } from '../services/crm/crmAssignee.js';
import { activityAuditDetails, activityAuditSnapshot, softDeleteActivity, updateActivity } from '../services/crm/crmActivityEdit.js';
import { foldedContains } from '../lib/search/searchSql.js';


const router = Router();
router.use(authenticateToken);

// v9.0.18 (TD-427): مبلغ و احتمال با `decimalInput` (متن = خطای اعتبارسنجی، نه صفر بی‌صدا یا ۵۰۰)؛ مبلغ نامنفی، احتمال عدد
// صحیح ۰ تا ۱۰۰، و مرحله، وضعیت و ارز فقط از فهرست‌های `src/lib/crm/leadFields.ts`
const leadEstimatedValueInput = decimalInput('ارزش تخمینی معامله')
  .refine(v => v === undefined || Number(v) >= 0, { message: 'ارزش تخمینی معامله نمی‌تواند منفی باشد' });
const leadProbabilityInput = decimalInput('احتمال موفقیت')
  .refine(v => v === undefined || isLeadProbability(v), { message: 'احتمال موفقیت باید عدد صحیح بین ۰ تا ۱۰۰ باشد' });
const leadStageInput = z.enum(CRM_LEAD_STAGES, { message: 'مرحله پرونده فروش نامعتبر است' });
const leadStatusInput = z.enum(CRM_LEAD_STATUSES, { message: 'وضعیت پرونده فروش نامعتبر است' });
const leadCurrencyInput = z.preprocess(normalizeLeadCurrency, z.enum(CRM_LEAD_CURRENCIES, { message: 'ارز پرونده فروش پشتیبانی نمی‌شود (ریال، دلار، یورو، درهم یا پوند)' }));
// v10.1.18 (N-02 بخش ۲، ت۶): دلیل از دست رفتن از فهرست ثابت؛ الزامی بودنش را `resolveLeadLostReason` می‌سنجد
const leadLostReasonFields = {
  lostReason: z.enum(CRM_LOST_REASONS, { message: 'دلیل از دست رفتن پرونده نامعتبر است' }).optional(),
  lostReasonNote: z.string().max(CRM_LOST_REASON_NOTE_MAX, 'شرح دلیل از دست رفتن بیش از اندازه بلند است').optional(),
};

const createCrmLeadSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان فرصت فروش الزامی است'),
    customerId: z.union([z.number(), z.string(), z.null()]).optional(),
    customerName: z.string().optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    contacts: z.array(z.any()).optional(),
    source: z.string().optional(),
    stage: leadStageInput.optional(),
    estimatedValue: leadEstimatedValueInput.optional(),
    currency: leadCurrencyInput.optional(),
    probability: leadProbabilityInput.optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    expectedCloseDate: z.string().optional(),
    notes: z.string().optional(),
    ...leadLostReasonFields,
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
    stage: leadStageInput.optional(),
    estimatedValue: leadEstimatedValueInput.optional(),
    currency: leadCurrencyInput.optional(),
    probability: leadProbabilityInput.optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    expectedCloseDate: z.string().optional(),
    notes: z.string().optional(),
    status: leadStatusInput.optional(),
    ...leadLostReasonFields,
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
    // v10.0.34 (TD-976): the mentioned users are positive user ids, checked against live users in the service
    mentions: z.array(z.coerce.number().int('شناسه کاربر اشاره‌شده باید عدد صحیح باشد').positive('شناسه کاربر اشاره‌شده باید مثبت باشد'))
      .max(100, 'اقدام حداکثر ۱۰۰ اشاره دارد').optional(),
  })
});

const followupActionSchema = z.object({
  body: z.object({
    result: z.string().max(500).optional(),
    resultNote: z.string().max(2000).optional()
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

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

/** v10.1.24 (N-02 بخش ۳): پرونده‌های فهرست با نزدیک‌ترین سررسید پیگیری باز هر یک (`nextFollowUpDate`، کارت قیف) */
async function withNextFollowups(leads: Array<typeof crmLeads.$inferSelect>) {
  const next = await nextFollowupDatesByLead(leads.map((l) => l.id));
  return leads.map((l) => ({ ...formatLead(l), nextFollowUpDate: next.get(l.id) ?? null }));
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
  const { stage, status, assignedTo, assignedPersonnelId, source, search, customerId, customerName, fromDate, toDate, tagId } = req.query;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const isPaginated = req.query.paginate === 'true' || page !== undefined;

  const conditions = [eq(crmLeads.isDeleted, 0)];

  // v9.0.15 (TD-429): مشتری با شناسه طرف حساب؛ پرونده قدیمی بی شناسه با نام برابر (`leadCustomerCondition`)
  if (customerId && !isNaN(Number(customerId)) && Number(customerId) > 0) {
    conditions.push(await leadCustomerCondition(Number(customerId)));
  } else if (customerName && typeof customerName === 'string' && customerName.trim() !== '') {
    conditions.push(eq(crmLeads.customerName, customerName.trim()));
  }

  // v10.1.23 (N-02 بخش ۳): پرونده‌هایی که طرف حسابشان این برچسب را دارد
  if (tagId !== undefined && tagId !== '' && tagId !== 'all') {
    const tag = Number(tagId);
    if (!Number.isInteger(tag) || tag <= 0) throw new BadRequestError('برچسب انتخاب‌شده نامعتبر است.');
    conditions.push(leadCustomerHasTagCondition(crmLeads.customerId, tag));
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

  // v11 phase 6.3p (U8): one search rule (`foldedContains`)
  const searchedLeads = foldedContains([crmLeads.title, crmLeads.customerName, crmLeads.company, crmLeads.phone, crmLeads.notes], search);
  if (searchedLeads) conditions.push(searchedLeads);

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
      data: await withNextFollowups(leads),
      total,
      page: currentPage,
      limit: pageLimit,
      totalPages: totalPages > 0 ? totalPages : 1
    });
  }

  // v11 phase 6.4 (C6): the unpaged list (the board and the dashboard) takes the open files first, then the newest closed
  // ones, so the cap drops old closed files and never an open deal or its close date; before, the newest 500 of every kind
  const safeLimit = Math.min(Number(req.query.limit) || CRM_BOARD_LEAD_CAP, CRM_BOARD_LEAD_CAP);
  const leads = await orm.select()
    .from(crmLeads)
    .where(whereClause)
    .orderBy(openLeadsFirst, desc(crmLeads.updatedAt), desc(crmLeads.id))
    .limit(safeLimit);

  res.json(await withNextFollowups(leads));
}));

// GET /api/crm/leads/:id - Single lead detail with activities
// v10.0.178 (OBS-R2-29): همان مجوزهای فهرست پرونده‌ها؛ پیش‌تر فقط `crm.view` و خواننده مشتریان کشوی پرونده را ۴۰۳ می‌گرفت
router.get('/crm/leads/:id', authorizePermission('crm.view', 'customers.view', 'customers.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [lead] = await orm.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0)));
  if (!lead) {
    throw new NotFoundError('فرصت فروش یافت نشد');
  }

  const activities = await orm.select()
    .from(crmActivities)
    .where(and(eq(crmActivities.leadId, id), eq(crmActivities.isDeleted, 0)))
    .orderBy(desc(crmActivities.createdAt));

  // v10.2 package 7: the attachments of the file and of each activity, for `crm.view` holders only (the key of the files)
  if (!(await can(req.user, 'crm.view'))) {
    res.json({ ...formatLead(lead), activities: activities.map(formatActivity) });
    return;
  }
  const leadFiles = await CrmAttachmentService.listByOwners('lead', [id], orm);
  const activityFiles = await CrmAttachmentService.listByOwners('activity', activities.map((a) => a.id), orm);
  res.json({
    ...formatLead(lead),
    attachments: leadFiles.get(id) ?? [],
    activities: activities.map((a) => ({ ...formatActivity(a), attachments: activityFiles.get(a.id) ?? [], attachmentCount: activityFiles.get(a.id)?.length ?? 0 })),
  });
}));

// v9.0.127 (TD-883، مدل مجوز §۴.۲): «معامله موفق» به دارندگان «مدیریت فرصت‌های فروش» می‌رود؛ پیش‌تر به پنج کد نقش ثابت
async function notifySalesOnWonLead(lead: (Partial<typeof crmLeads.$inferSelect> & Record<string, unknown>), authorName: string, senderId?: number) {
  try {
    await orm.transaction(tx => notifyLeadWon(tx, { id: Number(lead.id), title: String(lead.title ?? '') }, { id: senderId, name: authorName }, permissionHolderUserIdsWith));
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
    lostReason,
    lostReasonNote,
  } = req.body;

  // حوزه H (TD-309): پرونده تازه هنوز پیش‌فاکتور ندارد؛ «فروش موفق» فقط پس از صدور پیش‌فاکتور (همان قاعده ویرایش)
  if (stage === 'won') {
    throw new BadRequestError('پرونده فروش تازه نمی‌تواند مستقیم «فروش موفق» ثبت شود. ابتدا پیش‌فاکتور صادر کنید.');
  }

  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  const initialStage: string = stage || 'lead';
  // v10.1.18 (N-02 بخش ۲، ت۶): پرونده‌ای که «از دست رفته» ساخته می‌شود دلیل می‌خواهد (۴۲۲ پیش از هر نوشتن)
  const lost = resolveLeadLostReason({ targetStage: initialStage, existingStage: null, reason: lostReason, note: lostReasonNote });

  // v10.1.18 (N-02 بخش ۲): ساخت پرونده، یادداشت آغاز، ردیف تاریخچه مرحله و ممیزی در یک تراکنش
  const newLead = await orm.transaction(async (tx) => {
  // V10-4.1: فروشنده مسئول = پرسنل (id) + snapshot نام
  const assignee = await resolveAssignee({ name: assignedTo, personnelId: assignedPersonnelId }, tx);

  // v9.0.5 (TD-418): پیوند به طرف حساب یا ساخت طرف حساب تازه؛ طرف حساب موجود عوض نمی‌شود و اختلاف به یادداشت می‌رود
  const party = await linkCustomerForLead({ customerId, customerName, phone, company, title }, tx, { userId: currentUser?.id, username: currentUser?.username });

  const nowIso = systemNowUtcIso();

  const [newLead] = await tx.insert(crmLeads).values({
    title: title.trim(),
    customerId: party.customerId,
    customerName: customerName || '',
    phone: phone || '',
    company: company || '',
    contacts: Array.isArray(contacts) ? contacts : [],
    source: source || 'تماس تلفنی',
    stage: initialStage,
    ...lost,
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

  await recordLeadStageChange(tx, {
    leadId: newLead.id, fromStage: null, toStage: initialStage, assignedPersonnelId: newLead.assignedPersonnelId,
    lostReason: newLead.lostReason, actor: { id: currentUser?.id, name: authorName },
  });

  // Log initial creation activity
  await tx.insert(crmActivities).values({
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
    ipAddress: req.ip || '',
    tx,
  });
  return newLead;
  });

  res.status(201).json(formatLead(newLead));
}));

// PUT /api/crm/leads/:id - Update lead
router.put('/crm/leads/:id', authorizePermission('crm.manage'), validate(updateCrmLeadSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  // v10.0.179 (OBS-R2-33): ویرایش زیر قفل ردیف پرونده و در یک تراکنش با یادداشت تغییر مرحله و ردیف ممیزی پیش و پس؛
  // پیش‌تر بی قفل و تراکنش، و ممیزی بی پیش و پس
  const { existing, updated } = await orm.transaction(async (tx) => {
  const [existing] = await tx.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0))).for('update');
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
    status,
    lostReason,
    lostReasonNote,
  } = req.body;
  // حوزه H (TD-309): وضعیت «won» بدون مرحله همان انتقال به «فروش موفق» است و از قاعده پیش‌فاکتور نمی‌گذرد. v11 phase 6.4
  // (C4): the status follows the stage, and `lost` alone moves the stage too (its reason and history row below)
  const resolved = resolveLeadStageStatus({ requestedStage, requestedStatus: status, existingStage: existing.stage, existingStatus: existing.status });
  const stage: string | undefined = resolved.stage;

  // V10-4.1: ارجاع فروشنده — تنها وقتی مشتری جدید آمده بازresolve شود
  const assigneeProvided = assignedTo !== undefined || assignedPersonnelId !== undefined;
  const targetAssignee = assigneeProvided
    ? await resolveAssignee({
        name: assignedTo !== undefined ? assignedTo : existing.assignedTo,
        personnelId: assignedPersonnelId !== undefined ? assignedPersonnelId : null
      }, tx)
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
  }, tx, { userId: req.user?.id, username: req.user?.username });

  const nowIso = systemNowUtcIso();
  
  // VALIDATION: Prevent moving to 'won' if no proforma exists
  if (stage === 'won' && existing.stage !== 'won') {
    if (!existing.hasProforma || Number(existing.hasProforma) !== 1) {
      throw new BadRequestError('امکان انتقال مستقیم به مرحله فروش موفق وجود ندارد. ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید.');
    }
  }

  // v10.1.18 (N-02 بخش ۲، ت۶): رفتن به «از دست رفته» دلیل می‌خواهد، بیرون آمدن از آن دلیل را پاک می‌کند
  const targetStage = stage !== undefined ? stage : (existing.stage || 'lead');
  const lost = resolveLeadLostReason({
    targetStage, existingStage: existing.stage, existingReason: existing.lostReason, existingNote: existing.lostReasonNote,
    reason: lostReason, note: lostReasonNote,
  });

  // v11 phase 6.4 (C3): a lead whose proforma became a final invoice stays «فروش موفق» until that invoice is voided
  if (stage !== undefined && stage !== existing.stage) await assertSoldLeadStaysWon(tx, existing, targetStage);
  const newStatus = resolved.status;

  const [updated] = await tx.update(crmLeads).set({
    title: title !== undefined ? title.trim() : existing.title,
    customerId: party.customerId,
    customerName: customerName !== undefined ? customerName : existing.customerName,
    phone: phone !== undefined ? phone : existing.phone,
    company: company !== undefined ? company : existing.company,
    contacts: contacts !== undefined ? (Array.isArray(contacts) ? contacts : []) : existing.contacts,
    source: source !== undefined ? source : existing.source,
    stage: stage !== undefined ? stage : existing.stage,
    ...lost,
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

  // Log stage change activity if stage changed
  if (stage && stage !== existing.stage) {
    await recordLeadStageChange(tx, {
      leadId: id, fromStage: existing.stage, toStage: stage, assignedPersonnelId: updated.assignedPersonnelId,
      lostReason: updated.lostReason, actor: { id: currentUser?.id, name: authorName },
    });
    const stageLabels: Record<string, string> = {
      lead: 'مخاطب اولیه',
      qualified: 'ارزیابی و نیازسنجی',
      proposal: 'پیش‌فاکتور و پیشنهاد',
      won: 'موفق (بسته شد)',
      lost: 'ناموفق (انصراف)'
    };
    await tx.insert(crmActivities).values({
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
    req,
    tx,
    userFullName: authorName,
    action: 'UPDATE',
    entity: 'فرصت فروش CRM',
    entityId: String(id),
    description: `ویرایش فرصت فروش "${updated.title}"`,
    details: leadAuditDetails(existing, updated),
  });
  return { existing, updated };
  });

  if (updated.stage === 'won' && existing.stage !== 'won') {
    await notifySalesOnWonLead(updated, authorName, currentUser?.id);
  }


  res.json(formatLead(updated));
}));

// POST /api/crm/leads/:id/convert-to-customer
router.post('/crm/leads/:id/convert-to-customer', authorizePermission('crm.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const authorName = currentUser?.full_name || currentUser?.username || 'فروشنده';

  // v10.0.179 (OBS-R2-33): تبدیل زیر قفل ردیف پرونده و در یک تراکنش با یادداشت و ردیف ممیزی پیش و پس؛ پرونده بسته
  // («موفق» یا «از دست رفته») مرحله و وضعیتش را نگه می‌دارد. پیش‌تر پرونده از دست رفته به «پیش‌فاکتور و پیشنهاد» برمی‌گشت
  // و تبدیل ممیزی نداشت
  const { updated, resolvedCustomerId } = await orm.transaction(async (tx) => {
    const [lead] = await tx.select().from(crmLeads).where(and(eq(crmLeads.id, id), eq(crmLeads.isDeleted, 0))).for('update');
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
    }, tx, { userId: currentUser?.id, username: currentUser?.username });

    // v11 6.3p (U17, review): the conversion only links the customer and keeps the stage; the proforma, once saved, moves
    // the lead to «پیش‌فاکتور و پیشنهاد» (`markLeadProforma`). Before, an open lead moved here, so a proforma form left
    // unsaved left the lead at that stage with no proforma
    const nowIso = systemNowUtcIso();
    const [updated] = await tx.update(crmLeads).set({
      customerId: party.customerId,
      notes: notesWithPartyDifferences(lead.notes, party.differences),
      updatedAt: nowIso
    }).where(eq(crmLeads.id, id)).returning();

    await tx.insert(crmActivities).values({
      leadId: id,
      customerId: party.customerId,
      type: 'task',
      title: 'تبدیل پرونده فروش به مشتری و صدور پیش‌فاکتور',
      description: `پرونده فروش "${lead.title}" توسط ${authorName} به مشتری رسمی تبدیل شد و جهت صدور پیش‌فاکتور هدایت شد.`,
      loggedBy: authorName,
      ...(await crmTodayActivityDates()),
      createdAt: nowIso,
      isDeleted: 0
    });
    await logActivity({
      req,
      tx,
      userFullName: authorName,
      action: 'UPDATE',
      entity: 'فرصت فروش CRM',
      entityId: String(id),
      description: `تبدیل پرونده فروش "${lead.title}" به مشتری`,
      details: { operation: 'convert_to_customer', ...leadAuditDetails(lead, updated) },
    });
    return { updated, resolvedCustomerId: party.customerId };
  });

  // v9.0.21 (TD-433، ت۶): اطلاعات بانکی طرف حساب فقط برای customers.view / customers.manage / accounting.*
  let customerObj: typeof customers.$inferSelect | Omit<typeof customers.$inferSelect, 'bankInfo'> | null = null;
  if (resolvedCustomerId) {
    const [c] = await orm.select().from(customers).where(eq(customers.id, resolvedCustomerId));
    customerObj = c ? ((await canSeePartyBankInfo(req.user)) ? c : withoutBankInfo(c)) : null;
  }

  res.json({
    message: 'پرونده فروش به مشتری رسمی تبدیل شد',
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
// v10.2 package 7 (OBS-R2-28): with `page` one page `{ data, total, page, limit }` counted in SQL, searched by `search` and
// limited to a party's own activities and those of its sales files by `partyId` (the customer dossier); without `page` the
// older array of at most 500 rows. Each row carries its live attachment count for `crm.view` holders.
const activitiesQuerySchema = z.object({
  query: z.object({
    leadId: numericIdString.optional(),
    customerId: numericIdString.optional(),
    partyId: numericIdString.optional(),
    type: z.string().max(40).optional(),
    pendingFollowupsOnly: z.enum(['true', 'false']).optional(),
    fromDate: z.string().max(20).optional(),
    toDate: z.string().max(20).optional(),
    search: z.string().max(200).optional(),
    page: numericIdString.optional(),
    limit: numericIdString.optional(),
  }).passthrough(),
}).passthrough();

router.get('/crm/activities', authorizePermission('crm.view', 'customers.view', 'customers.manage'), validate(activitiesQuerySchema), asyncHandler(async (req, res) => {
  const { leadId, customerId, partyId, type, pendingFollowupsOnly, fromDate, toDate, search } = req.query;

  // v9.0.16 (TD-425): اقدام‌های پرونده حذف‌شده فهرست نمی‌شوند
  const conditions = [eq(crmActivities.isDeleted, 0), liveLeadActivityCondition()];

  if (leadId) {
    conditions.push(eq(crmActivities.leadId, Number(leadId)));
  }

  if (customerId) {
    conditions.push(eq(crmActivities.customerId, Number(customerId)));
  }

  if (partyId) {
    conditions.push(await activityPartyCondition(Number(partyId)));
  }

  // v11 phase 6.3p (U8): one search rule (`foldedContains`)
  const searched = foldedContains([
    crmActivities.title,
    crmActivities.description,
    crmActivities.result,
    crmActivities.loggedBy,
    crmActivities.nextFollowUpTask,
  ], search);
  if (searched) conditions.push(searched);

  if (type && typeof type === 'string' && type.trim() && type !== 'all') {
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

  const isPaged = req.query.page !== undefined;
  const pageOf = isPaged ? parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 20 }) : null;
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
    version: crmActivities.version,
    updatedAt: crmActivities.updatedAt,
    updatedBy: crmActivities.updatedBy,
    isDeleted: crmActivities.isDeleted,
    leadTitle: crmLeads.title,
    leadCustomerName: crmLeads.customerName,
    customerName: customers.name,
  })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .leftJoin(customers, eq(crmActivities.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(crmActivities.createdAt), desc(crmActivities.id))
    .limit(pageOf ? pageOf.limit : Math.min(Number(req.query.limit) || 200, 500))
    .offset(pageOf ? pageOf.offset : 0);

  const counts = await can(req.user, 'crm.view')
    ? await CrmAttachmentService.countByOwners('activity', activities.map((a) => a.id), orm)
    : null;
  const rows = activities.map((a) => ({ ...formatActivity(a), ...(counts ? { attachmentCount: counts.get(a.id) ?? 0 } : {}) }));
  if (!pageOf) {
    res.json(rows);
    return;
  }
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .where(and(...conditions));
  res.json({ data: rows, total: Number(total), page: pageOf.page, limit: pageOf.limit });
}));

// v10.2 package 7 (OBS-R2-24): one activity, for a link `/crm?activityId=` of a mention or a due reminder
router.get('/crm/activities/:id', authorizePermission('crm.view', 'customers.view', 'customers.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [act] = await orm.select({
    activity: crmActivities,
    leadTitle: crmLeads.title,
    leadCustomerName: crmLeads.customerName,
    customerName: customers.name,
  })
    .from(crmActivities)
    .leftJoin(crmLeads, eq(crmActivities.leadId, crmLeads.id))
    .leftJoin(customers, eq(crmActivities.customerId, customers.id))
    .where(and(eq(crmActivities.id, id), eq(crmActivities.isDeleted, 0), liveLeadActivityCondition()));
  if (!act) throw new NotFoundError('اقدام یا پیگیری یافت نشد', { id }, 'CRM_ACTIVITY_NOT_FOUND');
  res.json(formatActivity({ ...act.activity, leadTitle: act.leadTitle, leadCustomerName: act.leadCustomerName, customerName: act.customerName }));
}));

// v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): پیگیری‌ها بی بازه تاریخ اقدام و با صفحه‌بندی (`listFollowups`)؛
// پیش‌تر فهرست پیگیری‌ها از اقدام‌های ۳۰ روز اخیر با سقف ۲۰۰ ردیف ساخته می‌شد
const followupsQuerySchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'completed', 'all']).optional(),
    due: z.enum(['all', 'due']).optional(),
    scope: z.enum(['mine', 'all']).optional(),
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
  // v10.1.18 (N-02 بخش ۲، ت۳، OBS-R2-27): پیش‌فرض فقط پیگیری‌های خود کاربر؛ دارنده `crm.manage` با `scope=all` همه یا با
  // `assignedPersonnelId` یک فروشنده را می‌بیند. دیگران همیشه فقط پیگیری‌های خودشان را می‌بینند.
  const manager = await can(req.user, 'crm.manage');
  const sellerId = manager && q.assignedPersonnelId ? Number(q.assignedPersonnelId) : undefined;
  const mine = !manager || (q.scope !== 'all' && !sellerId);
  const { rows, ...meta } = await listFollowups({
    status: (q.status as FollowupStatus | undefined) ?? 'pending',
    dueOnly: q.due === 'due',
    assignedPersonnelId: sellerId,
    ownerUserId: mine ? Number(req.user?.id) || -1 : undefined,
    search: q.search,
    page,
    limit,
  });
  res.json({ ...meta, scope: mine ? 'mine' : 'all', data: rows.map(formatActivity) });
}));

// v10.1.18 (N-02 بخش ۲، ت۷): گزارش قیف فروش از تاریخچه مرحله، با بازه روز کسب‌وکار و فروشنده (`crmFunnelReport`)
const funnelQuerySchema = z.object({
  query: z.object({
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    assignedPersonnelId: numericIdString.optional(),
  }).passthrough(),
}).passthrough();

router.get('/crm/reports/funnel', authorizePermission('crm.view'), validate(funnelQuerySchema), asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(await crmFunnelReport({
    fromDate: optionalStorageDate(q.fromDate, 'از تاریخ') || undefined,
    toDate: optionalStorageDate(q.toDate, 'تا تاریخ') || undefined,
    assignedPersonnelId: q.assignedPersonnelId ? Number(q.assignedPersonnelId) : undefined,
  }));
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
  }, orm);
  // v9.0.17 (TD-426): پرونده و طرف حساب ناموجود یا حذف‌شده با ۴۲۲ رد می‌شوند (`resolveActivityParents`)
  // v10.0.34 (TD-976): ثبت اقدام، اعلان‌ها، زمان پرونده و ممیزی در یک تراکنش؛ اشاره فقط شناسه کاربر زنده است و اعلان آن
  // فقط به اشاره‌شده‌ای می‌رود که اقدام‌های ارتباط با مشتری را می‌خواند (`notifyActivityMentions`)
  const newAct = await orm.transaction(async (tx) => {
    const parents = await resolveActivityParents(tx, { leadId, customerId });
    const mentionIds = await resolveActivityMentions(tx, mentions);

    const [act] = await tx.insert(crmActivities).values({
      leadId: parents.leadId,
      customerId: parents.customerId,
      type: type || 'call',
      title: title.trim(),
      description: description || '',
      result: result || '',
      loggedBy: authorName,
      assignedTo: taskAssignee.name,
      assignedPersonnelId: taskAssignee.id,
      mentions: mentionIds,
      activityDate: actDateIso,
      activityDateIso: actDateIso,
      nextFollowUpDate: nextFollowIso,
      nextFollowUpDateIso: nextFollowIso,
      nextFollowUpTask: nextFollowUpTask || '',
      isFollowUpCompleted: 0,
      createdAt: nowIso,
      isDeleted: 0
    }).returning();

    await notifyActivityMentions(tx, { id: act.id, title: act.title, mentions: mentionIds }, { id: currentUser?.id, name: authorName });

    // Notification for the follow-up assignee (linked personnel user first, then the exact name)
    if (nextFollowUpTask || nextFollowUpDate) {
      let targetUserId: number | null | undefined = null;
      if (act.assignedPersonnelId) {
        const [pRow] = await tx.select({ userId: personnel.userId })
          .from(personnel)
          .where(eq(personnel.id, Number(act.assignedPersonnelId)));
        targetUserId = pRow?.userId ?? null;
      }
      if (!targetUserId && taskAssignee.name) {
        const [assignedUser] = await tx.select({ id: users.id }).from(users).where(
          and(eq(users.isDeleted, 0), or(eq(users.fullName, taskAssignee.name), eq(users.username, taskAssignee.name)))
        );
        targetUserId = assignedUser?.id ?? null;
      }
      const notifUserId = targetUserId || currentUser?.id;
      if (notifUserId) {
        await createNotifications(tx, [{
          userId: notifUserId,
          category: 'crm_followup',
          senderId: currentUser?.id,
          senderName: authorName,
          type: 'task',
          title: 'پیگیری تازه ارتباط با مشتری',
          message: `${authorName} پیگیری تازه‌ای برای شما ثبت کرد: "${nextFollowUpTask || title}" (تاریخ سررسید: ${toPersianDigits(isoToJalaliDate(nextFollowIso || actDateIso))})`,
          link: `/crm?activityId=${act.id}`,
        }]);
      }
    }

    if (parents.leadId) {
      await tx.update(crmLeads)
        .set({ updatedAt: nowIso })
        .where(eq(crmLeads.id, parents.leadId));
    }

    await logActivity({
      userId: currentUser?.id,
      username: currentUser?.username || 'user',
      userFullName: authorName,
      action: 'CREATE',
      entity: 'اقدام و تماس CRM',
      entityId: String(act.id),
      description: `ثبت ${type === 'call' ? 'تماس' : 'اقدام'} "${title}"`,
      ipAddress: req.ip || '',
      tx,
    });
    return act;
  });

  res.status(201).json(formatActivity(newAct));
}));

// v9.0.19 (TD-430): «انجام» و «بازگشایی» پیگیری دو عمل صریح با وضعیت هدف (`setFollowupCompleted`، زیر قفل ردیف اقدام)؛
// تکرار درخواست چیزی را عوض نمی‌کند و هر تغییر یک لاگ ممیزی با «قبل و بعد» در همان تراکنش دارد. کلید دوطرفه
// `toggle-followup` حذف شد: دو درخواست پشت‌سرهم پیگیری انجام‌شده را دوباره باز می‌کرد و ممیزی نداشت.
function followupStatusHandler(completed: boolean) {
  return asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { result, resultNote } = req.body || {};
    const currentUser = req.user;
    const change = await orm.transaction(async (tx) => {
      const outcome = await setFollowupCompleted(tx, id, completed, { result, resultNote });
      if (outcome.changed) {
        const pick = (a: typeof outcome.before) => ({ isFollowUpCompleted: a.isFollowUpCompleted, result: a.result, description: a.description });
        await logActivity({
          userId: currentUser?.id,
          username: currentUser?.username || 'user',
          userFullName: currentUser?.full_name || currentUser?.username || '',
          action: 'UPDATE',
          entity: 'اقدام و تماس CRM',
          entityId: String(id),
          description: `${completed ? 'انجام' : 'بازگشایی'} پیگیری «${outcome.after.nextFollowUpTask || outcome.after.title}»`,
          details: { before: pick(outcome.before), after: pick(outcome.after) },
          ipAddress: req.ip || '',
          tx,
        });
      }
      return outcome;
    });
    res.json({ ...formatActivity(change.after), changed: change.changed });
  });
}

router.put('/crm/activities/:id/complete-followup', authorizePermission('crm.manage'), validate(followupActionSchema), followupStatusHandler(true));
router.put('/crm/activities/:id/reopen-followup', authorizePermission('crm.manage'), validate(followupActionSchema), followupStatusHandler(false));

// v10.1.18 (N-02 بخش ۲، ت۱ و ت۲): ویرایش و حذف نرم اقدام. فقط دارندگان `crm.manage` اقدام ثبت می‌کنند، پس «ثبت‌کننده یا
// دارنده crm.manage» همان «دارنده crm.manage» است. ویرایش با نسخه رکورد (۴۰۹ وقتی کهنه است)، زیر قفل ردیف، با ممیزی پیش و
// پس در همان تراکنش؛ اشاره تازه فقط به کاربر تازه اعلان می‌دهد (`updateActivity` / `softDeleteActivity`).
const editCrmActivitySchema = z.object({
  body: z.object({
    version: z.coerce.number().int().positive('نسخه اقدام لازم است'),
    type: z.string().max(50).optional(),
    title: z.string().trim().min(1, 'عنوان اقدام یا تماس الزامی است').max(500).optional(),
    description: z.string().max(20000).optional(),
    result: z.string().max(2000).optional(),
    activityDate: z.string().optional(),
    nextFollowUpDate: z.string().optional(),
    nextFollowUpTask: z.string().max(2000).optional(),
    assignedTo: z.string().optional(),
    assignedPersonnelId: z.union([z.number(), z.string(), z.null()]).optional(),
    mentions: z.array(z.coerce.number().int('شناسه کاربر اشاره‌شده باید عدد صحیح باشد').positive('شناسه کاربر اشاره‌شده باید مثبت باشد'))
      .max(100, 'اقدام حداکثر ۱۰۰ اشاره دارد').optional(),
  }).strict(),
  params: z.object({ id: numericIdString }),
});

router.put('/crm/activities/:id', authorizePermission('crm.manage'), validate(editCrmActivitySchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const actor = { id: currentUser?.id, name: currentUser?.full_name || currentUser?.username || 'فروشنده' };
  const outcome = await orm.transaction(async (tx) => {
    const change = await updateActivity(tx, id, req.body, actor);
    await logActivity({
      req,
      tx,
      userFullName: actor.name,
      action: 'UPDATE',
      entity: 'اقدام و تماس CRM',
      entityId: String(id),
      description: `ویرایش اقدام «${change.after.title}»`,
      details: { ...activityAuditDetails(change.before, change.after), notifiedMentions: change.notified },
    });
    return change;
  });
  res.json(formatActivity(outcome.after));
}));

router.delete('/crm/activities/:id', authorizePermission('crm.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const currentUser = req.user;
  const actor = { id: currentUser?.id, name: currentUser?.full_name || currentUser?.username || 'فروشنده' };
  await orm.transaction(async (tx) => {
    const { before } = await softDeleteActivity(tx, id, actor);
    await logActivity({
      req,
      tx,
      userFullName: actor.name,
      action: 'DELETE',
      entity: 'اقدام و تماس CRM',
      entityId: String(id),
      description: `حذف اقدام «${before.title}»`,
      details: { before: activityAuditSnapshot(before) },
    });
  });
  res.json({ message: 'اقدام حذف شد', id });
}));

export default router;
