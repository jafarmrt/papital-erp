import { Router } from 'express';
import { sql, or, and, eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { customers } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, storageDateParam } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination, parsePickListLimit } from '../lib/pagination.js';
import { CustomerService } from '../services/customer.service.js';
import { getCustomerAccountCard } from '../services/customers/customerAccountCard.js';
import { getCustomerSalesDocuments } from '../services/customers/customerDocuments.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { partyRowsForUser } from '../services/customers/partyBankInfoAccess.js';
import { customerListConditions, listCustomerPicks } from '../services/customers/customerPickList.js';

const router = Router();
router.use(authenticateToken);

/**
 * TST-004 XSS Defense-in-Depth: strips active script payloads from free-text
 * customer fields before persistence. React escapes on render, but stored
 * payloads must never round-trip raw (API consumers / exports may not escape).
 */
function sanitizeCustomerText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(script|iframe|object|embed|link)[^>]*>/gi, '')
    .replace(/javascript:/gi, '');
}

interface ContactPerson {
  id?: string;
  name?: string;
  role?: string;
  phone?: string;
  isPrimary?: boolean;
}

function sanitizeCustomerPayload<T extends Record<string, unknown>>(body: T): T {
  const fields = ['name', 'contactName', 'address', 'notes', 'city', 'province', 'country', 'phone'];
  const sanitized: Record<string, unknown> = { ...body };
  for (const f of fields) {
    if (typeof sanitized[f] === 'string') sanitized[f] = sanitizeCustomerText(sanitized[f]);
  }
  if (Array.isArray(sanitized.contacts)) {
    sanitized.contacts = (sanitized.contacts as ContactPerson[]).map((c) => ({
      ...c,
      name: sanitizeCustomerText(c?.name) as string | undefined,
      role: sanitizeCustomerText(c?.role) as string | undefined,
    }));
  }
  return sanitized as T;
}

const contactPersonSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(100).optional().default(''),
  role: z.string().max(100).optional().default(''),
  phone: z.string().max(200).optional().default(''),
  isPrimary: z.boolean().optional().default(false),
});

const bankInfoSchema = z.object({
  bankName: z.string().max(100).optional().default(''),
  accountNumber: z.string().max(100).optional().default(''),
  shaba: z.string().max(100).optional().default(''),
  cardNumber: z.string().max(100).optional().default(''),
}).optional().default({ bankName: '', accountNumber: '', shaba: '', cardNumber: '' });

const customerSchema = z.object({
  name: z.string().min(1, 'نام طرف حساب الزامی است').max(150),
  contactName: z.string().max(100).optional().default(''),
  country: z.string().max(100).optional().default('ایران'),
  province: z.string().max(100).optional().default(''),
  city: z.string().max(100).optional().default(''),
  phone: z.string().max(500).optional().default(''),
  address: z.string().max(500).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
  partyType: z.enum(['customer', 'supplier', 'both']).optional().default('customer'),
  party_type: z.enum(['customer', 'supplier', 'both']).optional(),
  supplierCategory: z.string().max(200).optional().default(''),
  supplier_category: z.string().max(200).optional(),
  bankInfo: bankInfoSchema,
  bank_info: bankInfoSchema,
  contacts: z.array(contactPersonSchema).optional().default([]),
});

const createCustomerValidation = z.object({
  body: customerSchema
});

/** نسخه رکوردی که فرم ویرایش از آن ساخته شده است (عدد صحیح مثبت؛ رشته عددی هم پذیرفته است) */
const recordVersion = z.coerce.number().int('نسخه رکورد باید عدد صحیح باشد').positive('نسخه رکورد باید مثبت باشد');

/**
 * v10.0.33 (TD-975): بدنه ویرایش پیش‌فرض ندارد؛ فیلدی که فرستاده نشود `undefined` می‌ماند و سرویس مقدار کنونی را نگه
 * می‌دارد. پیش‌تر همان طرح ساخت با `.default('')` به کار می‌رفت، پس ویرایشی که فقط تلفن را می‌فرستاد نشانی، یادداشت،
 * نوع طرف حساب، اطلاعات بانکی و افراد رابط را خالی یا «مشتری» می‌کرد.
 */
const contactPersonPatchSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(100).optional().default(''),
  role: z.string().max(100).optional().default(''),
  phone: z.string().max(200).optional().default(''),
  isPrimary: z.boolean().optional().default(false),
});
const bankInfoPatchSchema = z.object({
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(100).optional(),
  shaba: z.string().max(100).optional(),
  cardNumber: z.string().max(100).optional(),
}).optional();
const customerPatchSchema = z.object({
  name: z.string().min(1, 'نام طرف حساب الزامی است').max(150).optional(),
  contactName: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  phone: z.string().max(500).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  partyType: z.enum(['customer', 'supplier', 'both']).optional(),
  party_type: z.enum(['customer', 'supplier', 'both']).optional(),
  supplierCategory: z.string().max(200).optional(),
  supplier_category: z.string().max(200).optional(),
  bankInfo: bankInfoPatchSchema,
  bank_info: bankInfoPatchSchema,
  contacts: z.array(contactPersonPatchSchema).optional(),
});

/**
 * v8.0.122 (TD-403): ویرایش طرف حساب نسخه رکوردی را که فرم از آن ساخته شده می‌فرستد و قفل خوش‌بینانه همیشه اجرا می‌شود.
 * پیش‌تر طرح Zod فیلد version را نداشت و حذفش می‌کرد، پس ویرایش دو کاربر هم‌زمان بی‌خطا روی هم نوشته می‌شد.
 */
const updateCustomerValidation = z.object({
  body: customerPatchSchema.extend({
    version: recordVersion.optional(),
    expectedVersion: recordVersion.optional(),
  }).refine(b => b.version !== undefined || b.expectedVersion !== undefined, {
    message: 'نسخه رکورد طرف حساب ارسال نشده است؛ صفحه را بازخوانی کنید و دوباره ویرایش کنید.',
    path: ['version'],
  }),
  params: z.object({
    id: numericIdString
  })
});

router.get('/customers', authorizePermission(...READ_PERMISSIONS.customers), asyncHandler(async (req, res) => {
  // V9-1.3: صفحه‌بندی NaN-safe با سقف
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
  const search = req.query.search as string;
  const partyTypeFilter = (req.query.partyType || req.query.type) as string;
  const isExport = req.query.export === 'true';

  const conditions = customerListConditions(search, partyTypeFilter);

  let query = orm.select().from(customers).where(conditions);
  query = query.orderBy(customers.name) as any;
  
  if (!isExport && limit > 0) {
    query = query.limit(limit).offset(offset) as any;
  }

  // v9.0.21 (TD-433، ت۶): اطلاعات بانکی فقط برای customers.view / customers.manage / accounting.*
  const allCustomers = await partyRowsForUser(req.user, await query);

  if (isExport) {
    return res.json(allCustomers);
  }

  let countQuery = orm.select({ count: sql`count(*)`.mapWith(Number) }).from(customers).where(conditions);
  
  const totalCountResult = await countQuery;
  const total = totalCountResult[0].count;

  res.json({
    data: allCustomers,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}));

const customerPickListValidation = z.object({
  query: z.object({
    search: z.string().max(200).optional(),
    partyType: z.enum(['all', 'customer', 'supplier', 'both']).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

// v9.0.137 (TD-887، تصمیم ت۱۰ الف): فهرست انتخاب طرف حساب‌ها برای فرم‌های بخش‌های دیگر؛ فهرست کامل بالا فقط با customers.view
router.get('/customers/options', authorizePermission(...READ_PERMISSIONS.customerOptions), validate(customerPickListValidation), asyncHandler(async (req, res) => {
  const query = req.query as { search?: string; partyType?: string; limit?: string };
  res.json({ success: true, data: await listCustomerPicks(req.user, { search: query.search, partyType: query.partyType, limit: parsePickListLimit(query.limit) }) });
}));

// GET /api/customers/export-excel - Structured Excel export rows
router.get('/customers/export-excel', authorizePermission(...READ_PERMISSIONS.customersExport), asyncHandler(async (req, res) => {
  const partyTypeFilter = (req.query.partyType || req.query.type) as string;
  const conditionsList = [eq(customers.isDeleted, 0)];

  if (partyTypeFilter && partyTypeFilter !== 'all') {
    if (partyTypeFilter === 'supplier') {
      conditionsList.push(or(eq(customers.partyType, 'supplier'), eq(customers.partyType, 'both')) as any);
    } else if (partyTypeFilter === 'customer') {
      conditionsList.push(or(eq(customers.partyType, 'customer'), eq(customers.partyType, 'both')) as any);
    } else if (partyTypeFilter === 'both') {
      conditionsList.push(eq(customers.partyType, 'both') as any);
    }
  }

  const list = await orm.select().from(customers).where(and(...conditionsList)).orderBy(customers.id);

  const exportRows = list.map(c => {
    const pType = c.partyType === 'supplier' ? 'تامین‌کننده' : (c.partyType === 'both' ? 'هر دو' : 'مشتری');
    const bank = (c.bankInfo as any) || {};
    return {
      'شناسه': c.id,
      // v8.0.122 (TD-403): درون‌ریزی دوباره همین فایل فقط رکوردی را به‌روز می‌کند که از این نسخه تغییر نکرده باشد
      'نسخه': c.version,
      'نام طرف حساب': c.name || '',
      'شخص رابط': c.contactName || '',
      'شماره تماس': c.phone || '',
      'نوع طرف حساب': pType,
      'دسته تامین': c.supplierCategory || '',
      'کشور': c.country || 'ایران',
      'استان': c.province || '',
      'شهر': c.city || '',
      'آدرس کامل': c.address || '',
      'نام بانک': bank.bankName || '',
      'شماره حساب': bank.accountNumber || '',
      'شماره کارت': bank.cardNumber || '',
      'شماره شبا': bank.shaba || '',
      'یادداشت': c.notes || ''
    };
  });

  res.json({ rows: exportRows, total: exportRows.length });
}));

const customerAccountCardValidation = z.object({
  params: z.object({ id: numericIdString }),
  query: z.object({
    startDate: storageDateParam,
    endDate: storageDateParam,
    currency: z.string().max(10).optional(),
  }).optional(),
});

// v9.0.4 (TD-416): کارت حساب و مانده طرف حساب با شناسه او (صفحه طرف حساب‌ها و پرونده مشتری)
router.get('/customers/:id/account-card', authorizePermission(...READ_PERMISSIONS.partyAccountCard), validate(customerAccountCardValidation), asyncHandler(async (req, res) => {
  const { startDate, endDate, currency } = (req.query as { startDate?: string; endDate?: string; currency?: string }) || {};
  const data = await getCustomerAccountCard(Number(req.params.id), { startDate, endDate, currency });
  res.json({ report: data, ...data });
}));

const customerDocumentsValidation = z.object({
  params: z.object({ id: numericIdString }),
  query: z.object({ page: z.union([z.string(), z.number()]).optional(), limit: z.union([z.string(), z.number()]).optional() }).optional(),
});

// v9.0.6 (TD-417): اسناد فروش پرونده مشتری با نام خریدار برابر، نه جست‌وجوی متنی (همان مجوزهای فهرست اسناد)
router.get('/customers/:id/documents', authorizePermission(...READ_PERMISSIONS.partyDocuments), validate(customerDocumentsValidation), asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
  res.json(await getCustomerSalesDocuments(Number(req.params.id), page, limit));
}));

// POST /api/customers/bulk-import - Bulk import and update counterparties from Excel
router.post('/customers/bulk-import', authorizePermission('customers.manage'), asyncHandler(async (req, res) => {
  const { rows = [], updateIfExists = true } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'لیست طرفین حساب جهت ثبت ارسال نشده است.' });
  }

  const result = await CustomerService.bulkImport(rows, updateIfExists);

  for (const c of result.createdRecords) {
    await logActivity({
      req,
      action: 'CREATE',
      entity: c.partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
      entityId: c.id,
      description: `ثبت دسته‌ای طرف حساب جدید "${c.name}" از طریق فایل اکسل`,
      details: { id: c.id, name: c.name, partyType: c.partyType, phone: c.phone }
    });
  }

  for (const u of result.updatedRecords) {
    await logActivity({
      req,
      action: 'UPDATE',
      entity: u.partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
      entityId: u.id,
      description: `به‌روزرسانی دسته‌ای طرف حساب "${u.name}" از طریق فایل اکسل`,
      details: { after: u.updatedData }
    });
  }

  res.json({
    success: true,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    totalProcessed: result.totalProcessed,
    errors: result.errors
  });
}));

router.post('/customers', authorizePermission('customers.manage'), validate(createCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const { name, country, province, city, address, notes, contacts } = req.body;
  const { contactName, phone } = req.body;
  // v10.0.33 (TD-975): فیلد نفرستاده undefined می‌ماند تا سرویس مقدار کنونی را نگه دارد
  const partyType = req.body.partyType ?? req.body.party_type;
  const supplierCategory = req.body.supplierCategory ?? req.body.supplier_category;
  const bankInfo = req.body.bankInfo ?? req.body.bank_info;

  const created = await CustomerService.createCustomer({
    name,
    contactName,
    country,
    province,
    city,
    phone,
    address,
    notes,
    partyType,
    supplierCategory,
    bankInfo,
    contacts
  });

  await logActivity({
    req,
    action: 'CREATE',
    entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
    entityId: created.id,
    description: `تعریف طرف حساب جدید (${partyType === 'supplier' ? 'تامین‌کننده' : partyType === 'both' ? 'مشتری و تامین‌کننده' : 'مشتری'}) "${created.name}" (تلفن: ${created.phone || 'ثبت نشده'})`,
    details: {
      after: created
    }
  });

  res.json(created);
}));

router.put('/customers/:id', authorizePermission('customers.manage'), validate(updateCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const customerId = Number(req.params.id);
  const { name, country, province, city, address, notes, contacts } = req.body;
  const { contactName, phone } = req.body;
  // v10.0.33 (TD-975): فیلد نفرستاده undefined می‌ماند تا سرویس مقدار کنونی را نگه دارد
  const partyType = req.body.partyType ?? req.body.party_type;
  const supplierCategory = req.body.supplierCategory ?? req.body.supplier_category;
  const bankInfo = req.body.bankInfo ?? req.body.bank_info;

  const { previous: prevCust, current: currentCust } = await CustomerService.updateCustomer(customerId, {
    name,
    contactName,
    country,
    province,
    city,
    phone,
    address,
    notes,
    partyType,
    supplierCategory,
    bankInfo,
    contacts,
    version: req.body.version,
    expectedVersion: req.body.expectedVersion
  });

  const { diff, hasChanges } = computeAuditDiff(prevCust, currentCust);

  await logActivity({
    req,
    action: 'UPDATE',
    entity: currentCust.partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
    entityId: customerId,
    description: `ویرایش اطلاعات طرف حساب "${currentCust.name}"`,
    details: {
      before: prevCust,
      after: currentCust,
      changes: diff,
      hasChanges
    }
  });

  res.json({ success: true });
}));

router.delete('/customers/:id', authorizePermission('customers.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const delCust = await CustomerService.deleteCustomer(customerId);

  await logActivity({
    req,
    action: 'DELETE',
    entity: 'مشتری',
    entityId: customerId,
    description: `حذف مشتری "${delCust.name}" (تلفن: ${delCust.phone || '—'})`,
    details: {
      before: delCust,
      deletedAt: new Date().toISOString()
    }
  });

  res.json({ success: true });
}));

export default router;
