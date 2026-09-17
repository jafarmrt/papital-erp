import { eq, and, desc, asc, ilike, or, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { templateEntities, type TemplateEntityInsert } from './schema.js';
import type { CreateTemplateDTO, UpdateTemplateDTO, TemplateFilterQueryDTO, PaginatedTemplateResponse, TemplateEntity } from './types.js';
import { NotFoundError, ConflictError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';

export class TemplateService {
  /**
   * تولید خودکار کد یکتای رکورد مبتنی بر شمارنده اتمیک یا الگو
   */
  private static async generateCode(tx?: any): Promise<string> {
    const db = tx || orm;
    const result = await db.select({
      count: sql<number>`count(*)::int`
    }).from(templateEntities);
    const nextSeq = (result[0]?.count || 0) + 1;
    const year = new Date().getFullYear();
    return `TMP-${year}-${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * دریافت فهرست صفحه‌بندی‌شده با فیلتر و جستجوی بهینه
   */
  static async list(params: TemplateFilterQueryDTO = {}): Promise<PaginatedTemplateResponse<TemplateEntity>> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(templateEntities.isDeleted, 0)];

    if (params.status) {
      conditions.push(eq(templateEntities.status, params.status));
    }

    if (params.search && params.search.trim()) {
      const searchPattern = `%${params.search.trim()}%`;
      conditions.push(
        or(
          ilike(templateEntities.title, searchPattern),
          ilike(templateEntities.code, searchPattern)
        )!
      );
    }

    const whereClause = and(...conditions);

    // شمارش کل رکوردها
    const countRes = await orm.select({
      total: sql<number>`count(*)::int`
    }).from(templateEntities).where(whereClause);

    const total = countRes[0]?.total || 0;

    // چینش نتایج
    const orderColumn = params.sortBy === 'title' ? templateEntities.title
      : params.sortBy === 'amount' ? templateEntities.amount
      : templateEntities.createdAt;
    const orderExpr = params.sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);

    const rows = await orm.select()
      .from(templateEntities)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(limit)
      .offset(offset);

    return {
      data: rows as TemplateEntity[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * دریافت اطلاعات تکی بر اساس شناسه
   */
  static async getById(id: number): Promise<TemplateEntity> {
    const rows = await orm.select()
      .from(templateEntities)
      .where(and(eq(templateEntities.id, id), eq(templateEntities.isDeleted, 0)))
      .limit(1);

    if (!rows.length) {
      throw new NotFoundError(`رکورد با شناسه ${id} یافت نشد.`);
    }

    return rows[0] as TemplateEntity;
  }

  /**
   * ایجاد رکورد جدید با ثبت لاگ ممیزی و تولید اتمیک کد
   */
  static async create(
    data: CreateTemplateDTO,
    context?: { userId?: number; username?: string; req?: any }
  ): Promise<TemplateEntity> {
    return await orm.transaction(async (tx) => {
      const code = data.code?.trim() || await this.generateCode(tx);

      // بررسی یکتایی کد
      const existing = await tx.select({ id: templateEntities.id })
        .from(templateEntities)
        .where(and(eq(templateEntities.code, code), eq(templateEntities.isDeleted, 0)))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictError(`کد '${code}' قبلاً در سیستم ثبت شده است.`);
      }

      const now = systemNowUtcIso();
      const insertData: TemplateEntityInsert = {
        code,
        title: data.title.trim(),
        status: data.status || 'draft',
        amount: data.amount ?? 0,
        quantity: data.quantity ?? 0,
        metadata: data.metadata || {},
        notes: data.notes?.trim() || null,
        version: 1,
        isDeleted: 0,
        createdBy: context?.username || 'system',
        createdAt: now,
        updatedAt: now,
      };

      const insertedRows = await tx.insert(templateEntities)
        .values(insertData)
        .returning();

      const createdRecord = insertedRows[0] as TemplateEntity;

      // ثبت لاگ ممیزی
      if (context?.req) {
        await logActivity({
          action: 'CREATE',
          entity: 'موجودیت_شابلون',
          entityId: createdRecord.id,
          description: `ایجاد رکورد جدید با کد ${createdRecord.code}`,
          req: context.req,
          tx,
          details: {
            after: createdRecord,
          }
        });
      }

      return createdRecord;
    });
  }

  /**
   * به‌روزرسانی بر مبنای الگوی Read-Calculate-Update و کنترل هم‌زمانی (OCC)
   */
  static async update(
    id: number,
    data: UpdateTemplateDTO,
    context?: { userId?: number; username?: string; req?: any }
  ): Promise<TemplateEntity> {
    return await orm.transaction(async (tx) => {
      // قفل سطری جهت جلوگیری از شرایط رقابتی هم‌زمان
      const rows = await tx.select()
        .from(templateEntities)
        .where(and(eq(templateEntities.id, id), eq(templateEntities.isDeleted, 0)))
        .for('update')
        .limit(1);

      if (!rows.length) {
        throw new NotFoundError(`رکورد با شناسه ${id} یافت نشد.`);
      }

      const current = rows[0];

      // کنترل نسخه خوش‌بینانه در صورت ارسال version
      if (data.version !== undefined && current.version !== data.version) {
        throw new ConflictError('این رکورد توسط کاربر دیگری تغییر یافته است. لطفاً صفحه را تازه‌سازی نمایید.');
      }

      const now = systemNowUtcIso();
      const updatedFields: Partial<TemplateEntityInsert> = {
        title: data.title !== undefined ? data.title.trim() : current.title,
        status: data.status !== undefined ? data.status : current.status,
        amount: data.amount !== undefined ? data.amount : current.amount,
        quantity: data.quantity !== undefined ? data.quantity : current.quantity,
        metadata: data.metadata !== undefined ? data.metadata : current.metadata,
        notes: data.notes !== undefined ? (data.notes.trim() || null) : current.notes,
        version: current.version + 1,
        updatedAt: now,
      };

      const updatedRows = await tx.update(templateEntities)
        .set(updatedFields)
        .where(eq(templateEntities.id, id))
        .returning();

      const updatedRecord = updatedRows[0] as TemplateEntity;

      // ثبت لاگ ممیزی قبل و بعد
      if (context?.req) {
        await logActivity({
          action: 'UPDATE',
          entity: 'موجودیت_شابلون',
          entityId: id,
          description: `به‌روزرسانی رکورد با کد ${updatedRecord.code}`,
          req: context.req,
          tx,
          details: {
            before: current,
            after: updatedRecord,
          }
        });
      }

      return updatedRecord;
    });
  }

  /**
   * حذف منطقی (Soft Delete) با حفظ یکپارچگی داده و تاریخچه
   */
  static async softDelete(
    id: number,
    context?: { userId?: number; username?: string; req?: any }
  ): Promise<{ success: boolean; message: string }> {
    return await orm.transaction(async (tx) => {
      const rows = await tx.select()
        .from(templateEntities)
        .where(and(eq(templateEntities.id, id), eq(templateEntities.isDeleted, 0)))
        .for('update')
        .limit(1);

      if (!rows.length) {
        throw new NotFoundError(`رکورد با شناسه ${id} یافت نشد.`);
      }

      const current = rows[0];
      const now = systemNowUtcIso();

      await tx.update(templateEntities)
        .set({
          isDeleted: 1,
          updatedAt: now,
          version: current.version + 1,
        })
        .where(eq(templateEntities.id, id));

      if (context?.req) {
        await logActivity({
          action: 'DELETE',
          entity: 'موجودیت_شابلون',
          entityId: id,
          description: `حذف منطقی رکورد با کد ${current.code}`,
          req: context.req,
          tx,
          details: {
            before: current,
          }
        });
      }

      return {
        success: true,
        message: `رکورد با کد '${current.code}' با موفقیت حذف گردید.`
      };
    });
  }
}
