import { Router } from 'express';
import { orm } from '../db/drizzle.js';
import { authenticateToken } from '../middleware/auth.js';
import { transactions, items, users } from '../db/schema.js';
import { eq, desc, sql, and, gte, lte, or, ilike } from 'drizzle-orm';
import { parsePagination } from '../lib/pagination.js';

const router = Router();
router.use(authenticateToken);

router.get('/transactions', async (req, res) => {
  try {
    // V9-1.3: صفحه‌بندی NaN-safe با سقف
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const type = req.query.type as string;
    const documentType = req.query.documentType as string;
    const itemId = req.query.itemId ? parseInt(req.query.itemId as string, 10) : undefined;
    const isExport = req.query.export === 'true';
    const includeDeleted = req.query.includeDeleted === 'true' || req.query.showDeleted === 'true';

    const conditions = [];
    if (!includeDeleted) {
      conditions.push(eq(transactions.isDeleted, 0));
    }

    if (type && (type === 'in' || type === 'out')) {
      conditions.push(eq(transactions.type, type));
    }
    if (documentType && documentType !== 'all') {
      conditions.push(eq(transactions.documentType, documentType));
    }
    if (itemId && !isNaN(itemId)) {
      conditions.push(eq(transactions.itemId, itemId));
    }
    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }
    if (endDate) {
      const endCondition = endDate.length <= 10 ? endDate + 'T23:59:59.999Z' : endDate;
      conditions.push(lte(transactions.date, endCondition));
    }
    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`;
      conditions.push(or(
        ilike(items.name, s),
        ilike(items.code, s),
        ilike(transactions.documentRef, s),
        ilike(transactions.notes, s),
        ilike(transactions.createdBy, s),
        ilike(users.fullName, s)
      )!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let query = orm.select({
      id: transactions.id,
      itemId: transactions.itemId,
      type: transactions.type,
      quantity: transactions.quantity,
      date: transactions.date,
      documentType: transactions.documentType,
      documentRef: transactions.documentRef,
      user: transactions.createdBy,
      userFullName: users.fullName,
      notes: transactions.notes,
      location: transactions.location,
      reversalOfId: transactions.reversalOfId,
      isDeleted: transactions.isDeleted,
      itemName: items.name,
      itemCode: items.code,
      itemUnit: items.unit,
      itemType: items.type
    })
    .from(transactions)
    .innerJoin(items, eq(transactions.itemId, items.id))
    // یک موجودیت هویت کاربر: نمایش همیشه «نام کامل» کاربر (resolve از جدول users) با fallback به مقدار ثبت‌شده
    .leftJoin(users, eq(users.username, transactions.createdBy));

    if (whereClause) {
      query = query.where(whereClause) as any;
    }

    query = query.orderBy(desc(transactions.date), desc(transactions.id)) as any;

    if (!isExport && limit > 0) {
      query = query.limit(limit).offset(offset) as any;
    }

    const result = await query;

    const mappedResult = result.map(row => ({
      id: row.id,
      item_id: row.itemId,
      type: row.type,
      quantity: row.quantity,
      date: row.date,
      document_type: row.documentType,
      document_ref: row.documentRef,
      user: row.userFullName || row.user,
      notes: row.notes,
      location: row.location,
      reversal_of_id: row.reversalOfId,
      reversalOfId: row.reversalOfId,
      is_deleted: row.isDeleted,
      isDeleted: row.isDeleted,
      item_name: row.itemName,
      item_code: row.itemCode,
      item_unit: row.itemUnit,
      item_type: row.itemType
    }));

    if (isExport) {
      return res.json(mappedResult);
    }

    let countQuery = orm.select({ count: sql`count(*)`.mapWith(Number) })
      .from(transactions)
      .innerJoin(items, eq(transactions.itemId, items.id));

    if (whereClause) {
      countQuery = countQuery.where(whereClause) as any;
    }
    
    const totalCountQuery = await countQuery;
    const total = totalCountQuery[0]?.count || 0;

    res.json({
      data: mappedResult,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    throw err;
  }
});

export default router;
