import { Router } from 'express';
import { sql, ilike, or, and, eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { customers } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity, computeAuditDiff } from '../lib/auditLogger.js';
import { checkOccVersion, nextVersion } from '../lib/occHelper.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination } from '../lib/pagination.js';
import { NotFoundError, BadRequestError } from '../errors/customErrors.js';

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

router.post('/customers', authorize('admin', 'manager', 'sales_manager'), validate(createCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const { name, country, province, city, address, notes, contacts } = req.body;
  let { contactName, phone } = req.body;
  const partyType = req.body.partyType || req.body.party_type || 'customer';
  const supplierCategory = req.body.supplierCategory || req.body.supplier_category || '';
  const bankInfo = req.body.bankInfo || req.body.bank_info || {};

  // Auto-derive contactName and phone from contacts if available
  const activeContacts = ((contacts || []) as ContactPerson[]).filter((c) => c.name?.trim() || c.phone?.trim());
  if (activeContacts.length > 0) {
    const primary = activeContacts.find((c) => c.isPrimary) || activeContacts[0];
    if (!contactName) {
      contactName = primary.role ? `${primary.name} (${primary.role})` : primary.name;
    }
    if (!phone) {
      const allPhones = activeContacts.map((c) => c.phone).filter(Boolean);
      phone = Array.from(new Set(allPhones)).join(', ');
    }
  }

  if (name) {
    const existingName = await orm.select().from(customers).where(and(eq(customers.name, name), eq(customers.isDeleted, 0)));
    if (existingName.length > 0) {
      throw new BadRequestError('طرف حساب با این نام قبلاً ثبت شده است.');
    }
  }
  
  if (phone) {
    const existingPhone = await orm.select().from(customers).where(and(eq(customers.phone, phone), eq(customers.isDeleted, 0)));
    if (existingPhone.length > 0) {
      throw new BadRequestError('طرف حساب با این شماره تلفن قبلاً ثبت شده است.');
    }
  }

  const createdAt = new Date().toISOString();
  const [info] = await orm.insert(customers).values({
    name,
    contactName,
    country,
    province,
    phone,
    city,
    address,
    notes,
    partyType,
    supplierCategory,
    bankInfo,
    contacts: activeContacts,
    createdAt
  }).returning({ id: customers.id });

  await logActivity({
    req,
    action: 'CREATE',
    entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
    entityId: info.id,
    description: `تعریف طرف حساب جدید (${partyType === 'supplier' ? 'تامین‌کننده' : partyType === 'both' ? 'مشتری و تامین‌کننده' : 'مشتری'}) "${name}" (تلفن: ${phone || 'ثبت نشده'})`,
    details: {
      after: {
        id: info.id,
        name,
        contactName,
        phone,
        city,
        province,
        country,
        address,
        notes,
        partyType,
        supplierCategory,
        bankInfo,
        contacts: activeContacts
      }
    }
  });

  res.json({ id: info.id, name, contactName, country, province, phone, city, address, notes, partyType, supplierCategory, bankInfo, contacts: activeContacts, createdAt });
}));

router.put('/customers/:id', authorize('admin', 'manager', 'sales_manager'), validate(updateCustomerValidation), asyncHandler(async (req, res) => {
  req.body = sanitizeCustomerPayload(req.body);
  const { name, country, province, city, address, notes, contacts } = req.body;
  let { contactName, phone } = req.body;
  const partyType = req.body.partyType || req.body.party_type || 'customer';
  const supplierCategory = req.body.supplierCategory || req.body.supplier_category || '';
  const bankInfo = req.body.bankInfo || req.body.bank_info || {};
  const customerId = Number(req.params.id);

  const [prevCust] = await orm.select().from(customers).where(eq(customers.id, customerId));
  if (!prevCust) {
    throw new NotFoundError('طرف حساب مورد نظر یافت نشد.');
  }

  if (req.body.version !== undefined || req.body.expectedVersion !== undefined) {
    checkOccVersion(prevCust, {
      entityType: 'Customer',
      entityId: customerId,
      expectedVersion: Number(req.body.expectedVersion ?? req.body.version)
    });
  }

  const activeContacts = ((contacts || []) as ContactPerson[]).filter((c) => c.name?.trim() || c.phone?.trim());
  if (activeContacts.length > 0) {
    const primary = activeContacts.find((c) => c.isPrimary) || activeContacts[0];
    if (!contactName) {
      contactName = primary.role ? `${primary.name} (${primary.role})` : primary.name;
    }
    if (!phone) {
      const allPhones = activeContacts.map((c) => c.phone).filter(Boolean);
      phone = Array.from(new Set(allPhones)).join(', ');
    }
  }

  if (name) {
    const existingName = await orm.select().from(customers).where(and(eq(customers.name, name), eq(customers.isDeleted, 0)));
    if (existingName.length > 0 && existingName[0].id !== customerId) {
      throw new BadRequestError('طرف حساب با این نام قبلاً ثبت شده است.');
    }
  }
  
  if (phone) {
    const existingPhone = await orm.select().from(customers).where(and(eq(customers.phone, phone), eq(customers.isDeleted, 0)));
    if (existingPhone.length > 0 && existingPhone[0].id !== customerId) {
      throw new BadRequestError('طرف حساب با این شماره تلفن قبلاً ثبت شده است.');
    }
  }

  const updatedData: Partial<typeof customers.$inferInsert> = {
    name,
    contactName,
    country,
    province,
    phone,
    city,
    address,
    notes,
    partyType,
    supplierCategory,
    bankInfo,
    contacts: activeContacts,
    version: nextVersion(prevCust.version)
  };

  await orm.update(customers)
    .set(updatedData)
    .where(sql`${customers.id} = ${req.params.id}`);

  const { diff, hasChanges } = computeAuditDiff(prevCust, { ...prevCust, ...updatedData });

  await logActivity({
    req,
    action: 'UPDATE',
    entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
    entityId: customerId,
    description: `ویرایش اطلاعات طرف حساب "${name}"`,
    details: {
      before: prevCust,
      after: { ...prevCust, ...updatedData },
      changes: diff,
      hasChanges
    }
  });

  res.json({ success: true });
}));

router.delete('/customers/:id', authorize('admin', 'manager', 'sales_manager'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const customerId = Number(req.params.id);
  const [delCust] = await orm.select().from(customers).where(eq(customers.id, customerId));
  if (!delCust) {
    throw new NotFoundError('مشتری یافت نشد.');
  }

  await orm.update(customers)
    .set({ isDeleted: 1 })
    .where(sql`${customers.id} = ${req.params.id}`);

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
