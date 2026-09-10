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
router.post('/customers/bulk-import', authorize('admin', 'manager', 'sales_manager'), asyncHandler(async (req, res) => {
  const { rows = [], updateIfExists = true } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'لیست طرفین حساب جهت ثبت ارسال نشده است.' });
  }

  let createdCount = 0;
  let updatedCount = 0;
  const errors: Array<{ row: number; name?: string; message: string }> = [];

  const existingList = await orm.select().from(customers).where(eq(customers.isDeleted, 0));

  const idMap = new Map<number, typeof customers.$inferSelect>();
  const nameMap = new Map<string, typeof customers.$inferSelect>();
  const phoneMap = new Map<string, typeof customers.$inferSelect>();

  existingList.forEach(c => {
    idMap.set(c.id, c);
    if (c.name && c.name.trim()) {
      nameMap.set(c.name.trim().toLowerCase(), c);
    }
    if (c.phone && c.phone.trim()) {
      phoneMap.set(c.phone.trim(), c);
    }
  });

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const rowIndex = i + 1;

    try {
      const name = String(item.name || '').trim();
      if (!name) {
        errors.push({ row: rowIndex, message: 'نام طرف حساب مشخص نشده است.' });
        continue;
      }

      const id = item.id ? Number(item.id) : undefined;
      const contactName = String(item.contactName || '').trim();
      const phone = String(item.phone || '').trim();
      const rawType = String(item.partyType || '').trim().toLowerCase();
      let partyType: 'customer' | 'supplier' | 'both' = 'customer';
      if (rawType.includes('تامین') || rawType === 'supplier') {
        partyType = 'supplier';
      } else if (rawType.includes('هر دو') || rawType.includes('مشتری و تامین') || rawType === 'both') {
        partyType = 'both';
      } else {
        partyType = 'customer';
      }

      const supplierCategory = String(item.supplierCategory || '').trim();
      const country = String(item.country || 'ایران').trim();
      const province = String(item.province || '').trim();
      const city = String(item.city || '').trim();
      const address = String(item.address || '').trim();
      const notes = String(item.notes || '').trim();

      const bankInfo = {
        bankName: String(item.bankName || item.bankInfo?.bankName || '').trim(),
        accountNumber: String(item.accountNumber || item.bankInfo?.accountNumber || '').trim(),
        shaba: String(item.shaba || item.bankInfo?.shaba || '').trim(),
        cardNumber: String(item.cardNumber || item.bankInfo?.cardNumber || '').trim(),
      };

      // Match existing counterparty
      let matchedCust: typeof customers.$inferSelect | undefined;
      if (id && idMap.has(id)) {
        matchedCust = idMap.get(id);
      } else if (nameMap.has(name.toLowerCase())) {
        matchedCust = nameMap.get(name.toLowerCase());
      } else if (phone && phoneMap.has(phone)) {
        matchedCust = phoneMap.get(phone);
      }

      if (matchedCust) {
        if (updateIfExists) {
          const updatedData: Partial<typeof customers.$inferInsert> = {
            name,
            contactName: contactName || matchedCust.contactName,
            country: country || matchedCust.country,
            province: province || matchedCust.province,
            city: city || matchedCust.city,
            phone: phone || matchedCust.phone,
            address: address || matchedCust.address,
            notes: notes || matchedCust.notes,
            partyType,
            supplierCategory: supplierCategory || matchedCust.supplierCategory,
            bankInfo: {
              ...((matchedCust.bankInfo as any) || {}),
              ...(bankInfo.bankName ? { bankName: bankInfo.bankName } : {}),
              ...(bankInfo.accountNumber ? { accountNumber: bankInfo.accountNumber } : {}),
              ...(bankInfo.shaba ? { shaba: bankInfo.shaba } : {}),
              ...(bankInfo.cardNumber ? { cardNumber: bankInfo.cardNumber } : {}),
            },
            version: nextVersion(matchedCust.version)
          };

          await orm.update(customers)
            .set(updatedData)
            .where(eq(customers.id, matchedCust.id));

          await logActivity({
            req,
            action: 'UPDATE',
            entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
            entityId: matchedCust.id,
            description: `به‌روزرسانی دسته‌ای طرف حساب "${name}" از طریق فایل اکسل`,
            details: { after: updatedData }
          });

          updatedCount++;
        } else {
          errors.push({
            row: rowIndex,
            name,
            message: `طرف حساب "${name}" از قبل در سیستم وجود دارد و گزینه به‌روزرسانی غیرفعال بود.`
          });
        }
      } else {
        const [newCust] = await orm.insert(customers).values({
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
          contacts: contactName || phone ? [{ id: '1', name: contactName, role: 'رابط اصلی', phone, isPrimary: true }] : [],
          createdAt: new Date().toISOString()
        }).returning({ id: customers.id });

        idMap.set(newCust.id, { id: newCust.id, name, phone } as any);
        nameMap.set(name.toLowerCase(), { id: newCust.id, name, phone } as any);
        if (phone) phoneMap.set(phone, { id: newCust.id, name, phone } as any);

        await logActivity({
          req,
          action: 'CREATE',
          entity: partyType === 'supplier' ? 'تامین‌کننده' : 'طرف حساب',
          entityId: newCust.id,
          description: `ثبت دسته‌ای طرف حساب جدید "${name}" از طریق فایل اکسل`,
          details: { id: newCust.id, name, partyType, phone }
        });

        createdCount++;
      }
    } catch (err: any) {
      errors.push({
        row: rowIndex,
        name: rows[i]?.name,
        message: err.message || 'خطای ناشناخته در پردازش سطر'
      });
    }
  }

  res.json({
    success: true,
    createdCount,
    updatedCount,
    totalProcessed: rows.length,
    errors
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
