import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { personnel, users } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { normalizePhoneNumber, normalizeNationalId } from '../utils.js';
import { canAccessSensitivePersonnelData, sanitizePersonnelRecord } from '../lib/piiMasker.js';

const router = Router();
router.use(authenticateToken);

const createPersonnelSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    fullName: z.string().optional(),
    personnelCode: z.string().optional(),
    userId: z.union([z.number(), z.string(), z.null()]).optional(),
    gender: z.string().optional(),
    birthDate: z.string().optional(),
    nationality: z.string().optional(),
    nationalId: z.string().optional(),
    phone: z.string().optional(),
    employmentStatus: z.string().optional(),
    salaryType: z.enum(['none', 'piecework', 'monthly_fixed', 'mixed']).optional(),
    monthlySalary: z.union([z.number(), z.string()]).optional(),
    jobTitle: z.string().optional(),
    education: z.string().optional(),
    endDate: z.string().optional(),
    terminationReason: z.string().optional(),
    specializedSkills: z.string().optional(),
    otherSkills: z.string().optional(),
    referralSource: z.string().optional(),
    cardNumber: z.string().optional(),
    accountNumber: z.string().optional(),
    shebaNumber: z.string().optional(),
    bankName: z.string().optional(),
    nobitexUsername: z.string().optional(),
    nobitexPassword: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional()
  })
});

const updatePersonnelSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    fullName: z.string().optional(),
    personnelCode: z.string().optional(),
    userId: z.union([z.number(), z.string(), z.null()]).optional(),
    gender: z.string().optional(),
    birthDate: z.string().optional(),
    nationality: z.string().optional(),
    nationalId: z.string().optional(),
    phone: z.string().optional(),
    employmentStatus: z.string().optional(),
    salaryType: z.enum(['none', 'piecework', 'monthly_fixed', 'mixed']).optional(),
    monthlySalary: z.union([z.number(), z.string()]).optional(),
    jobTitle: z.string().optional(),
    education: z.string().optional(),
    endDate: z.string().optional(),
    terminationReason: z.string().optional(),
    specializedSkills: z.string().optional(),
    otherSkills: z.string().optional(),
    referralSource: z.string().optional(),
    cardNumber: z.string().optional(),
    accountNumber: z.string().optional(),
    shebaNumber: z.string().optional(),
    bankName: z.string().optional(),
    nobitexUsername: z.string().optional(),
    nobitexPassword: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

// GET /api/personnel/export - Export all personnel for Excel
router.get('/personnel/export', authorize('admin', 'manager', 'personnel.manage', 'payroll.view_sensitive'), async (req, res) => {
  try {
    const list = await orm
      .select({
        id: personnel.id,
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        fullName: personnel.fullName,
        personnelCode: personnel.personnelCode,
        gender: personnel.gender,
        birthDate: personnel.birthDate,
        nationality: personnel.nationality,
        nationalId: personnel.nationalId,
        phone: personnel.phone,
        employmentStatus: personnel.employmentStatus,
        salaryType: personnel.salaryType,
        monthlySalary: personnel.monthlySalary,
        jobTitle: personnel.jobTitle,
        education: personnel.education,
        specializedSkills: personnel.specializedSkills,
        otherSkills: personnel.otherSkills,
        referralSource: personnel.referralSource,
        cardNumber: personnel.cardNumber,
        accountNumber: personnel.accountNumber,
        shebaNumber: personnel.shebaNumber,
        bankName: personnel.bankName,
        address: personnel.address,
        notes: personnel.notes,
        createdAt: personnel.createdAt
      })
      .from(personnel)
      .where(eq(personnel.isDeleted, 0))
      .orderBy(desc(personnel.id));

    const exportRows = list.map((p) => ({
      'کد پرسنلی': p.personnelCode || '',
      'نام': p.firstName || '',
      'نام خانوادگی': p.lastName || '',
      'نام و نام خانوادگی': p.fullName || '',
      'عنوان شغلی': p.jobTitle || '',
      'شماره تماس': p.phone ? normalizePhoneNumber(p.phone) : '',
      'کد ملی': p.nationalId ? normalizeNationalId(p.nationalId) : '',
      'وضعیت همکاری': p.employmentStatus || 'فعال',
      'جنسیت': p.gender || 'مرد',
      'تاریخ تولد': p.birthDate || '',
      'تحصیلات': p.education || '',
      'شماره شبا': p.shebaNumber || '',
      'شماره کارت': p.cardNumber || '',
      'شماره حساب': p.accountNumber || '',
      'نام بانک': p.bankName || '',
      'مهارت‌های تخصصی': p.specializedSkills || '',
      'سایر مهارت‌ها': p.otherSkills || '',
      'معرف': p.referralSource || '',
      'آدرس': p.address || '',
      'توضیحات': p.notes || ''
    }));

    res.json({ rows: exportRows, total: exportRows.length });
  } catch (err) {
    logger.error({ message: 'Error exporting personnel', error: err });
    throw err;
  }
});

// POST /api/personnel/bulk-import - Bulk import personnel from Excel
router.post('/personnel/bulk-import', authorize('admin', 'manager', 'personnel.manage'), async (req, res) => {
  try {
    const { rows = [], updateIfExists = true } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'لیست پرسنل جهت ثبت ارسال نشده است.' });
    }

    let createdCount = 0;
    let updatedCount = 0;
    const errors: Array<{ row: number; code?: string; name?: string; message: string }> = [];

    // Fetch existing active personnel to check codes
    const existingPersonnel = await orm
      .select()
      .from(personnel)
      .where(eq(personnel.isDeleted, 0));

    const codeMap = new Map<string, typeof personnel.$inferSelect>();
    existingPersonnel.forEach((p) => {
      if (p.personnelCode && p.personnelCode.trim()) {
        codeMap.set(p.personnelCode.trim(), p);
      }
    });

    const nowIso = new Date().toISOString();

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      const rowIndex = i + 1;

      try {
        const firstName = String(item.firstName || '').trim();
        const lastName = String(item.lastName || '').trim();
        let fullName = String(item.fullName || '').trim();

        if (!fullName) {
          if (firstName || lastName) {
            fullName = `${firstName} ${lastName}`.trim();
          } else {
            errors.push({ row: rowIndex, message: 'نام یا نام خانوادگی مشخص نشده است.' });
            continue;
          }
        }

        const personnelCode = String(item.personnelCode || '').trim();
        const phone = normalizePhoneNumber(item.phone || '');
        const nationalId = normalizeNationalId(item.nationalId || '');
        const jobTitle = String(item.jobTitle || '').trim();
        const gender = item.gender === 'زن' ? 'زن' : 'مرد';
        const employmentStatus = ['فعال', 'قطع همکاری', 'مرخصی', 'تعلیق'].includes(item.employmentStatus)
          ? item.employmentStatus
          : 'فعال';
        const birthDate = String(item.birthDate || '').trim();
        const nationality = String(item.nationality || 'ایرانی').trim();
        const education = String(item.education || '').trim();
        const cardNumber = String(item.cardNumber || '').trim();
        const accountNumber = String(item.accountNumber || '').trim();
        const shebaNumber = String(item.shebaNumber || '').trim();
        const bankName = String(item.bankName || '').trim();
        const specializedSkills = String(item.specializedSkills || '').trim();
        const otherSkills = String(item.otherSkills || '').trim();
        const referralSource = String(item.referralSource || '').trim();
        const address = String(item.address || '').trim();
        const notes = String(item.notes || '').trim();

        // Check if existing by personnelCode
        const existing = personnelCode ? codeMap.get(personnelCode) : null;

        if (existing) {
          if (updateIfExists) {
            await orm
              .update(personnel)
              .set({
                firstName: firstName || existing.firstName,
                lastName: lastName || existing.lastName,
                fullName: fullName || existing.fullName,
                phone: phone || existing.phone,
                nationalId: nationalId || existing.nationalId,
                jobTitle: jobTitle || existing.jobTitle,
                gender: gender || existing.gender,
                employmentStatus: employmentStatus || existing.employmentStatus,
                birthDate: birthDate || existing.birthDate,
                nationality: nationality || existing.nationality,
                education: education || existing.education,
                cardNumber: cardNumber || existing.cardNumber,
                accountNumber: accountNumber || existing.accountNumber,
                shebaNumber: shebaNumber || existing.shebaNumber,
                bankName: bankName || existing.bankName,
                specializedSkills: specializedSkills || existing.specializedSkills,
                otherSkills: otherSkills || existing.otherSkills,
                referralSource: referralSource || existing.referralSource,
                address: address || existing.address,
                notes: notes || existing.notes,
                updatedAt: nowIso
              })
              .where(eq(personnel.id, existing.id));

            updatedCount++;
          } else {
            errors.push({
              row: rowIndex,
              code: personnelCode,
              name: fullName,
              message: `کد پرسنلی «${personnelCode}» تکراری است و به‌روزرسانی غیرفعال بود.`
            });
          }
        } else {
          const [newRecord] = await orm
            .insert(personnel)
            .values({
              firstName,
              lastName,
              fullName,
              personnelCode,
              gender,
              birthDate,
              nationality,
              nationalId,
              phone,
              employmentStatus,
              jobTitle,
              education,
              cardNumber,
              accountNumber,
              shebaNumber,
              bankName,
              specializedSkills,
              otherSkills,
              referralSource,
              address,
              notes,
              createdAt: nowIso,
              updatedAt: nowIso
            })
            .returning();

          if (personnelCode) {
            codeMap.set(personnelCode, newRecord);
          }
          createdCount++;
        }
      } catch (rowErr) {
        errors.push({
          row: rowIndex,
          message: rowErr instanceof Error ? rowErr.message : (typeof rowErr === 'string' ? rowErr : 'خطا در ثبت ردیف')
        });
      }
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'پرسنل',
      description: `ورود دسته‌جمعی پرسنل از اکسل: ${createdCount} پرسنل جدید، ${updatedCount} به‌روزرسانی شده${errors.length > 0 ? ` (${errors.length} خطا)` : ''}`
    });

    res.json({
      success: true,
      createdCount,
      updatedCount,
      totalProcessed: rows.length,
      errors
    });
  } catch (err) {
    logger.error({ message: 'Error bulk importing personnel', error: err });
    throw err;
  }
});

// GET /api/personnel - List personnel
router.get('/personnel', async (req, res) => {
  try {
    const search = (req.query.search as string) || '';
    const status = (req.query.status as string) || '';

    const allPersonnel = await orm
      .select({
        id: personnel.id,
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        fullName: personnel.fullName,
        personnelCode: personnel.personnelCode,
        userId: personnel.userId,
        username: users.username,
        userFullName: users.fullName,
        gender: personnel.gender,
        birthDate: personnel.birthDate,
        nationality: personnel.nationality,
        nationalId: personnel.nationalId,
        phone: personnel.phone,
        employmentStatus: personnel.employmentStatus,
        // V1.3.3 (باگ اصلی): بدون این دو فیلد، فرم پرسنل پس از ذخیره/رفرش به پیش‌فرض برمی‌گشت
        salaryType: personnel.salaryType,
        monthlySalary: personnel.monthlySalary,
        jobTitle: personnel.jobTitle,
        education: personnel.education,
        endDate: personnel.endDate,
        terminationReason: personnel.terminationReason,
        specializedSkills: personnel.specializedSkills,
        otherSkills: personnel.otherSkills,
        referralSource: personnel.referralSource,
        cardNumber: personnel.cardNumber,
        accountNumber: personnel.accountNumber,
        shebaNumber: personnel.shebaNumber,
        bankName: personnel.bankName,
        nobitexUsername: personnel.nobitexUsername,
        nobitexPassword: personnel.nobitexPassword,
        address: personnel.address,
        notes: personnel.notes,
        createdAt: personnel.createdAt,
        updatedAt: personnel.updatedAt
      })
      .from(personnel)
      .leftJoin(users, eq(personnel.userId, users.id))
      .where(eq(personnel.isDeleted, 0))
      .orderBy(desc(personnel.id));

    let filtered = allPersonnel;

    if (status) {
      filtered = filtered.filter(p => p.employmentStatus === status);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(p => 
        (p.fullName && p.fullName.toLowerCase().includes(q)) ||
        (p.firstName && p.firstName.toLowerCase().includes(q)) ||
        (p.lastName && p.lastName.toLowerCase().includes(q)) ||
        (p.personnelCode && p.personnelCode.toLowerCase().includes(q)) ||
        (p.phone && p.phone.includes(q)) ||
        (p.nationalId && p.nationalId.includes(q)) ||
        (p.jobTitle && p.jobTitle.toLowerCase().includes(q)) ||
        (p.specializedSkills && p.specializedSkills.toLowerCase().includes(q)) ||
        (p.otherSkills && p.otherSkills.toLowerCase().includes(q)) ||
        (p.education && p.education.toLowerCase().includes(q)) ||
        (p.bankName && p.bankName.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q)) ||
        (p.address && p.address.toLowerCase().includes(q))
      );
    }

    const canViewSensitive = await canAccessSensitivePersonnelData(req.user);
    const sanitizedList = filtered.map(p => sanitizePersonnelRecord(p, canViewSensitive));

    res.json(sanitizedList);
  } catch (err) {
    logger.error({ message: 'Error fetching personnel', error: err });
    throw err;
  }
});

// GET /api/personnel/:id - Single personnel detail
router.get('/personnel/:id', validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [record] = await orm
      .select({
        id: personnel.id,
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        fullName: personnel.fullName,
        personnelCode: personnel.personnelCode,
        userId: personnel.userId,
        username: users.username,
        userFullName: users.fullName,
        gender: personnel.gender,
        birthDate: personnel.birthDate,
        nationality: personnel.nationality,
        nationalId: personnel.nationalId,
        phone: personnel.phone,
        employmentStatus: personnel.employmentStatus,
        // V1.3.3: فیلدهای مدل حقوق
        salaryType: personnel.salaryType,
        monthlySalary: personnel.monthlySalary,
        jobTitle: personnel.jobTitle,
        education: personnel.education,
        endDate: personnel.endDate,
        terminationReason: personnel.terminationReason,
        specializedSkills: personnel.specializedSkills,
        otherSkills: personnel.otherSkills,
        referralSource: personnel.referralSource,
        cardNumber: personnel.cardNumber,
        accountNumber: personnel.accountNumber,
        shebaNumber: personnel.shebaNumber,
        bankName: personnel.bankName,
        nobitexUsername: personnel.nobitexUsername,
        nobitexPassword: personnel.nobitexPassword,
        address: personnel.address,
        notes: personnel.notes,
        createdAt: personnel.createdAt,
        updatedAt: personnel.updatedAt
      })
      .from(personnel)
      .leftJoin(users, eq(personnel.userId, users.id))
      .where(and(eq(personnel.id, id), eq(personnel.isDeleted, 0)));

    if (!record) {
      return res.status(404).json({ error: 'اطلاعات پرسنل مورد نظر یافت نشد' });
    }

    const canViewSensitive = await canAccessSensitivePersonnelData(req.user, record.userId);
    res.json(sanitizePersonnelRecord(record, canViewSensitive));
  } catch (err) {
    throw err;
  }
});

// POST /api/personnel - Create new personnel
router.post('/personnel', authorize('admin', 'manager', 'personnel.manage'), validate(createPersonnelSchema), async (req, res) => {
  try {
    const {
      firstName = '',
      lastName = '',
      fullName: reqFullName,
      personnelCode = '',
      userId = null,
      gender = 'مرد',
      birthDate = '',
      nationality = 'ایرانی',
      nationalId = '',
      phone = '',
      employmentStatus = 'فعال',
      salaryType,
      monthlySalary,
      jobTitle = '',
      education = '',
      endDate = '',
      terminationReason = '',
      specializedSkills = '',
      otherSkills = '',
      referralSource = '',
      cardNumber = '',
      accountNumber = '',
      shebaNumber = '',
      bankName = '',
      nobitexUsername = '',
      nobitexPassword = '',
      address = '',
      notes = ''
    } = req.body;

    const computedFullName = reqFullName && reqFullName.trim() !== '' 
      ? reqFullName.trim() 
      : `${firstName} ${lastName}`.trim() || 'بدون نام';

    // Uniqueness check for personnelCode if provided
    if (personnelCode.trim()) {
      const [existing] = await orm
        .select()
        .from(personnel)
        .where(and(eq(personnel.personnelCode, personnelCode.trim()), eq(personnel.isDeleted, 0)));
      if (existing) {
        return res.status(400).json({ error: `کد پرسنلی «${personnelCode}» قبلاً برای پرسنل دیگری ثبت شده است.` });
      }
    }

    const nowIso = new Date().toISOString();

    const [inserted] = await orm
      .insert(personnel)
      .values({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fullName: computedFullName,
        personnelCode: personnelCode.trim(),
        userId: userId ? Number(userId) : null,
        gender,
        birthDate,
        nationality,
        nationalId: normalizeNationalId(nationalId),
        phone: normalizePhoneNumber(phone),
        employmentStatus,
        salaryType: salaryType && ['none', 'piecework', 'monthly_fixed', 'mixed'].includes(String(salaryType)) ? String(salaryType) : 'none',
        monthlySalary: monthlySalary !== undefined ? Number(monthlySalary) || 0 : 0,
        jobTitle: jobTitle.trim(),
        education: education.trim(),
        endDate,
        terminationReason,
        specializedSkills,
        otherSkills,
        referralSource,
        cardNumber: cardNumber.trim(),
        accountNumber: accountNumber.trim(),
        shebaNumber: shebaNumber.trim(),
        bankName: bankName.trim(),
        nobitexUsername: nobitexUsername.trim(),
        nobitexPassword: nobitexPassword.trim(),
        address: address.trim(),
        notes: notes.trim(),
        createdAt: nowIso,
        updatedAt: nowIso
      })
      .returning();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'پرسنل',
      entityId: inserted.id,
      description: `ثبت پرسنل جدید «${computedFullName}» (کد پرسنلی: ${personnelCode || '---'})`
    });

    res.status(201).json(inserted);
  } catch (err) {
    logger.error({ message: 'Error creating personnel', error: err });
    throw err;
  }
});

// PUT /api/personnel/:id - Update personnel
router.put('/personnel/:id', authorize('admin', 'manager', 'personnel.manage'), validate(updatePersonnelSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [existing] = await orm
      .select()
      .from(personnel)
      .where(and(eq(personnel.id, id), eq(personnel.isDeleted, 0)));

    if (!existing) {
      return res.status(404).json({ error: 'اطلاعات پرسنل مورد نظر یافت نشد' });
    }

    const {
      firstName = existing.firstName,
      lastName = existing.lastName,
      fullName: reqFullName,
      personnelCode = existing.personnelCode,
      userId = existing.userId,
      gender = existing.gender,
      birthDate = existing.birthDate,
      nationality = existing.nationality,
      nationalId = existing.nationalId,
      phone = existing.phone,
      employmentStatus = existing.employmentStatus,
      salaryType = existing.salaryType,
      monthlySalary = existing.monthlySalary,
      jobTitle = existing.jobTitle,
      education = existing.education,
      endDate = existing.endDate,
      terminationReason = existing.terminationReason,
      specializedSkills = existing.specializedSkills,
      otherSkills = existing.otherSkills,
      referralSource = existing.referralSource,
      cardNumber = existing.cardNumber,
      accountNumber = existing.accountNumber,
      shebaNumber = existing.shebaNumber,
      bankName = existing.bankName,
      nobitexUsername = existing.nobitexUsername,
      nobitexPassword = existing.nobitexPassword,
      address = existing.address,
      notes = existing.notes
    } = req.body;

    const computedFullName = reqFullName && reqFullName.trim() !== '' 
      ? reqFullName.trim() 
      : `${firstName} ${lastName}`.trim() || existing.fullName;

    // Check code uniqueness if changed
    if (personnelCode && personnelCode.trim() !== existing.personnelCode) {
      const [other] = await orm
        .select()
        .from(personnel)
        .where(and(
          eq(personnel.personnelCode, personnelCode.trim()),
          eq(personnel.isDeleted, 0),
          sql`${personnel.id} != ${id}`
        ));
      if (other) {
        return res.status(400).json({ error: `کد پرسنلی «${personnelCode}» قبلاً برای پرسنل دیگری ثبت شده است.` });
      }
    }

    const nowIso = new Date().toISOString();

    await orm
      .update(personnel)
      .set({
        firstName: firstName ? firstName.trim() : '',
        lastName: lastName ? lastName.trim() : '',
        fullName: computedFullName,
        personnelCode: personnelCode ? personnelCode.trim() : '',
        userId: userId ? Number(userId) : null,
        gender,
        birthDate,
        nationality,
        nationalId: nationalId ? normalizeNationalId(nationalId) : '',
        phone: phone ? normalizePhoneNumber(phone) : '',
        employmentStatus,
        // V10-4.4: مدل حقوق ثابت/ترکیبی
        salaryType: salaryType && ['none', 'piecework', 'monthly_fixed', 'mixed'].includes(String(salaryType)) ? String(salaryType) : 'none',
        monthlySalary: monthlySalary !== undefined ? Number(monthlySalary) || 0 : 0,
        jobTitle: jobTitle ? jobTitle.trim() : '',
        education: education ? education.trim() : '',
        endDate: endDate || '',
        terminationReason: terminationReason || '',
        specializedSkills: specializedSkills || '',
        otherSkills: otherSkills || '',
        referralSource: referralSource || '',
        cardNumber: cardNumber ? cardNumber.trim() : '',
        accountNumber: accountNumber ? accountNumber.trim() : '',
        shebaNumber: shebaNumber ? shebaNumber.trim() : '',
        bankName: bankName ? bankName.trim() : '',
        nobitexUsername: nobitexUsername ? nobitexUsername.trim() : '',
        nobitexPassword: nobitexPassword ? nobitexPassword.trim() : '',
        address: address ? address.trim() : '',
        notes: notes ? notes.trim() : '',
        updatedAt: nowIso
      })
      .where(eq(personnel.id, id));

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'پرسنل',
      entityId: id,
      description: `ویرایش اطلاعات پرسنل «${computedFullName}» (کد ${id})`
    });

    res.json({ status: 'ok', message: 'اطلاعات پرسنل با موفقیت ویرایش شد' });
  } catch (err) {
    logger.error({ message: 'Error updating personnel', error: err });
    throw err;
  }
});

// DELETE /api/personnel/:id - Soft delete
router.delete('/personnel/:id', authorize('admin', 'manager', 'personnel.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [existing] = await orm
      .select()
      .from(personnel)
      .where(and(eq(personnel.id, id), eq(personnel.isDeleted, 0)));

    if (!existing) {
      return res.status(404).json({ error: 'اطلاعات پرسنل مورد نظر یافت نشد' });
    }

    await orm
      .update(personnel)
      .set({
        isDeleted: 1,
        updatedAt: new Date().toISOString()
      })
      .where(eq(personnel.id, id));

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'پرسنل',
      entityId: id,
      description: `حذف پرسنل «${existing.fullName}» (کد ${id})`
    });

    res.json({ status: 'ok', message: 'اطلاعات پرسنل با موفقیت حذف شد' });
  } catch (err) {
    throw err;
  }
});

// Asynchronous background remediation: Ensure existing records have leading zeros for phone and nationalId
(async () => {
  try {
    const list = await orm.select().from(personnel);
    for (const p of list) {
      const fixedPhone = p.phone ? normalizePhoneNumber(p.phone) : '';
      const fixedNationalId = p.nationalId ? normalizeNationalId(p.nationalId) : '';
      if ((p.phone && fixedPhone !== p.phone) || (p.nationalId && fixedNationalId !== p.nationalId)) {
        await orm.update(personnel).set({
          phone: fixedPhone || p.phone,
          nationalId: fixedNationalId || p.nationalId
        }).where(eq(personnel.id, p.id));
      }
    }
  } catch (err) {
    logger.warn('Personnel leading zeros migration check notice:', err);
  }
})().catch(() => {});

export default router;
