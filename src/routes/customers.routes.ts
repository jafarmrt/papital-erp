import { Router } from 'express';
import { sql, ilike, or, and, eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { customers } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination } from '../lib/pagination.js';
import { CustomerService } from '../services/customer.service.js';

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

const updateCustomerValidation = z.object({
  body: customerSchema,
  params: z.object({
    id: numericIdString
  })
});

router.get('/customers', asyncHandler(async (req, res) => {
  // V9-1.3: صفحه‌بندی NaN-safe با سقف
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
  const search = req.query.search as string;
  const partyTypeFilter = (req.query.partyType || req.query.type) as string;
  const isExport = req.query.export === 'true';

  const conditionsList = [eq(customers.isDeleted, 0)];

  if (search) {
    conditionsList.push(
      or(
        ilike(customers.name, `%${search}%`),
        ilike(customers.phone, `%${search}%`),
        ilike(customers.contactName, `%${search}%`),
        ilike(customers.supplierCategory, `%${search}%`),
        sql`${customers.contacts}::text ILIKE ${'%' + search + '%'}`
      ) as any
    );
  }

  if (partyTypeFilter && partyTypeFilter !== 'all') {
    if (partyTypeFilter === 'supplier') {
      conditionsList.push(or(eq(customers.partyType, 'supplier'), eq(customers.partyType, 'both')) as any);
    } else if (partyTypeFilter === 'customer') {
      conditionsList.push(or(eq(customers.partyType, 'customer'), eq(customers.partyType, 'both')) as any);
    } else if (partyTypeFilter === 'both') {
      conditionsList.push(eq(customers.partyType, 'both') as any);
    }
  }

  const conditions = and(...conditionsList);

  let query = orm.select().from(customers).where(conditions);
  query = query.orderBy(customers.name) as any;
  
  if (!isExport && limit > 0) {
    query = query.limit(limit).offset(offset) as any;
  }

  const allCustomers = await query;

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

// GET /api/customers/export-excel - Structured Excel export rows
router.get('/customers/export-excel', asyncHandler(async (req, res) => {
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

// POST /api/customers/bulk-import - Bulk import and update counterparties from Excel
router.post('/customers/bulk-import', authorize('admin', 'manager', 'sales_manager', 'customers.manage'), asyncHandler(async (req, res) => {
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

router.post('/customers', authorize('admin', 'manager', 'sales_manager', 'customers.manage'), validate(createCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const { name, country, province, city, address, notes, contacts } = req.body;
  const { contactName, phone } = req.body;
  const partyType = req.body.partyType || req.body.party_type || 'customer';
  const supplierCategory = req.body.supplierCategory || req.body.supplier_category || '';
  const bankInfo = req.body.bankInfo || req.body.bank_info || {};

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

router.put('/customers/:id', authorize('admin', 'manager', 'sales_manager', 'customers.manage'), validate(updateCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const customerId = Number(req.params.id);
  const { name, country, province, city, address, notes, contacts } = req.body;
  const { contactName, phone } = req.body;
  const partyType = req.body.partyType || req.body.party_type || 'customer';
  const supplierCategory = req.body.supplierCategory || req.body.supplier_category || '';
  const bankInfo = req.body.bankInfo || req.body.bank_info || {};

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
    entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
    entityId: customerId,
    description: `ویرایش اطلاعات طرف حساب "${name}"`,
    details: {
      before: prevCust,
      after: currentCust,
      changes: diff,
      hasChanges
    }
  });

  res.json({ success: true });
}));

router.delete('/customers/:id', authorize('admin', 'manager', 'sales_manager', 'customers.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
