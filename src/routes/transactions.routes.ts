import { Router } from 'express';
import { orm } from '../db/drizzle.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { transactions, items, users } from '../db/schema.js';
import { eq, desc, sql, and, gte, lte, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { validate, numericIdString } from '../middleware/validate.js';
import { logActivity } from '../lib/auditLogger.js';
import { DocumentService } from '../services/document.service.js';
import { NotFoundError } from '../errors/customErrors.js';
import { parsePagination } from '../lib/pagination.js';
import { businessNowIsoDateTime } from '../lib/businessClock.js';

const router = Router();
router.use(authenticateToken);

const deleteTxSchema = z.object({
  params: z.object({
    id: numericIdString
  })
});

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

router.delete('/transactions/:id', authorize('admin'), validate(deleteTxSchema), async (req, res) => {
  try {
    const txId = parseInt(req.params.id);
    const [existingTx] = await orm.select().from(transactions).where(eq(transactions.id, txId));
    if (!existingTx) {
      return res.status(404).json({ error: 'تراکنش یافت نشد.' });
    }

    if (existingTx.isDeleted) {
      return res.status(400).json({ error: 'این تراکنش قبلاً حذف شده است.' });
    }

    if (existingTx.documentId) {
      return res.status(400).json({ error: 'این تراکنش به یک سند متصل است و امکان حذف مستقیم آن وجود ندارد. لطفاً سند مربوطه را حذف یا ویرایش نمایید.' });
    }

    let auditDetail: Record<string, unknown> | null = null;

    await orm.transaction(async (tx) => {
      // ۱. خواندن تراکنش اصلی
      const [original] = await tx.select()
        .from(transactions)
        .where(eq(transactions.id, txId))
        .for('update');
      
      if (!original) throw new NotFoundError(`Transaction ${txId} not found`);
      if (original.isDeleted) throw new Error('Transaction already deleted');
      
      const loc = original.location || 'main';
      const qty = Number(original.quantity);
      const itemId = original.itemId;
      const reversalType = original.type === 'in' ? 'out' : 'in';

      // ۲. soft-delete تراکنش اصلی
      await tx.update(transactions)
        .set({ 
          isDeleted: 1,
          notes: `${original.notes || ''} [Soft-deleted by admin at ${new Date().toISOString()}]`.trim()
        })
        .where(eq(transactions.id, txId));

      const origUnitPrice = Number(original.unitPrice) || 0;
      const origTotalPrice = Number(original.totalPrice) || (origUnitPrice * qty);

      // ۳. اعمال حرکت انبار معکوس و ثبت تراکنش بازگشتی از طریق DocumentService.applyStockMovement
      const username = req.user?.username || original.createdBy || 'admin';
      const bizNow = await businessNowIsoDateTime();

      await DocumentService.applyStockMovement(tx, {
        itemId: original.itemId,
        documentId: original.documentId || 0,
        inOut: reversalType as 'in' | 'out',
        quantity: qty,
        price: origUnitPrice,
        date: bizNow,
        documentType: original.documentType || 'reversal',
        documentRef: original.documentRef ? `REVERSAL-${original.documentRef}` : `REVERSAL-${txId}`,
        user: username,
        targetLoc: loc,
      });

      // اتصال reversalOfId به آخرین تراکنش درج‌شده برای حفظ audit trail
      const [latestTx] = await tx.select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.itemId, original.itemId))
        .orderBy(desc(transactions.id))
        .limit(1);

      if (latestTx?.id) {
        await tx.update(transactions)
          .set({ 
            reversalOfId: txId,
            notes: `Reversal of transaction ${txId}`
          })
          .where(eq(transactions.id, latestTx.id));
      }

      const [itemData] = await tx.select({ name: items.name, code: items.code, currentStock: items.currentStock }).from(items).where(eq(items.id, itemId));
      auditDetail = {
        transactionId: txId,
        reversalTransactionId: latestTx?.id,
        itemId: itemId,
        itemName: itemData?.name || '',
        itemCode: itemData?.code || '',
        type: original.type,
        reversalType: reversalType,
        quantity: qty,
        location: loc,
        afterStock: itemData?.currentStock || 0
      };
    });

    if (auditDetail) {
      await logActivity({
        req,
        action: 'DELETE',
        entity: 'موجودی انبار',
        entityId: Number(auditDetail.itemId),
        description: `ابطال و حذف نرم تراکنش انبارداری #${txId} و ایجاد تراکنش برگشتی #${auditDetail.reversalTransactionId} برای کالای "${auditDetail.itemName}"`,
        details: auditDetail
      });
    }

    res.json({ success: true, reversalId: auditDetail?.reversalTransactionId });
  } catch (err) {
    throw err;
  }
});

export default router;
