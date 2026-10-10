import { eq, sql, asc, desc, and, ne } from 'drizzle-orm';
import { orm, type DbExecutor, type DbTransaction } from '../db/drizzle.js';
import { warehouses, items, itemWarehouseStocks } from '../db/schema.js';
import { NotFoundError, ConflictError, BadRequestError, ValidationError } from '../errors/customErrors.js';
import { isLedgerReservedWarehouseCode } from './inventory/warehouseResolver.js';
import { ADVISORY_LOCK_KEYS } from '../lib/advisoryLock.js';

export interface CreateWarehouseInput {
  name: string;
  code: string;
}

export interface UpdateWarehouseInput {
  name: string;
}

export class WarehouseService {
  /**
   * Retrieves active warehouses
   */
  static async listActive(executor: DbExecutor = orm): Promise<Array<typeof warehouses.$inferSelect>> {
    // v7.0.36 (P2-3): ترتیب قطعی — رابط کاربری اولین انبار فهرست را پیش‌فرض فرم‌ها قرار می‌دهد
    return executor.select().from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id));
  }

  /**
   * v9.0.112 (TD-490): همه انبارها، فعال و غیرفعال، برای «مدیریت انبارها» و فعال‌سازی دوباره
   */
  static async listAll(executor: DbExecutor = orm): Promise<Array<typeof warehouses.$inferSelect>> {
    return executor.select().from(warehouses).orderBy(desc(warehouses.isActive), asc(warehouses.id));
  }

  /**
   * Retrieves warehouse by ID
   */
  static async getById(id: number, executor: DbExecutor = orm): Promise<typeof warehouses.$inferSelect | null> {
    const [row] = await executor.select().from(warehouses).where(eq(warehouses.id, id));
    return row || null;
  }

  /**
   * Creates a new warehouse with sanitized code
   */
  static async createWarehouse(
    input: CreateWarehouseInput,
    executor: DbExecutor = orm
  ): Promise<typeof warehouses.$inferSelect> {
    const name = input.name.trim();
    const cleanCode = input.code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanCode) {
      throw new BadRequestError('کد انبار نامعتبر است');
    }
    if (isLedgerReservedWarehouseCode(cleanCode)) {
      throw new ValidationError(
        `کد «${cleanCode}» در کاردکس به معنای انبار پیش‌فرض است و برای انبار تازه پذیرفته نمی‌شود. کد دیگری وارد کنید.`,
        { field: 'code', value: cleanCode },
        'WAREHOUSE_CODE_RESERVED'
      );
    }

    const [existing] = await executor
      .select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
      .from(warehouses)
      .where(eq(warehouses.code, cleanCode));
    if (existing) {
      // v9.0.112 (TD-490، تصمیم ت۵): کد انبار غیرفعال با فعال‌سازی دوباره برمی‌گردد، نه با ساخت انبار تازه
      throw new ConflictError(existing.isActive === 1
        ? `انباری با کد «${cleanCode}» از قبل در سامانه تعریف شده است.`
        : `انبار «${existing.name}» با کد «${cleanCode}» غیرفعال است. مدیر سامانه می‌تواند آن را در «مدیریت انبارها» دوباره فعال کند.`,
      { field: 'code', value: cleanCode, warehouseId: existing.id, isActive: existing.isActive });
    }

    const [created] = await executor
      .insert(warehouses)
      .values({ name, code: cleanCode, isActive: 1 })
      .returning();

    return created;
  }

  /**
   * Updates warehouse title
   */
  static async updateWarehouse(
    id: number,
    input: UpdateWarehouseInput,
    executor: DbExecutor = orm
  ): Promise<{ previous: typeof warehouses.$inferSelect; current: typeof warehouses.$inferSelect }> {
    const [wh] = await executor.select().from(warehouses).where(eq(warehouses.id, id));
    if (!wh) {
      throw new NotFoundError('انبار یافت نشد');
    }

    const name = input.name.trim();
    const [updated] = await executor
      .update(warehouses)
      .set({ name })
      .where(eq(warehouses.id, id))
      .returning();

    return { previous: wh, current: updated || { ...wh, name } };
  }

  /**
   * v9.0.112 (TD-490، تصمیم ت۵ الف): غیرفعال‌سازی در یک تراکنش، زیر قفل مجموعه انبارهای فعال و قفل `FOR UPDATE` ردیف
   * انبار. هر گردش موجودی ردیف همان انبار را `FOR KEY SHARE` قفل می‌کند (`ItemWarehouseStockService.applyMovement`)،
   * پس بررسی «موجودی ندارد» پس از commit گردش‌های در جریان انجام می‌شود و گردش بعدی انبار غیرفعال را نمی‌پذیرد.
   * آخرین انبار فعال غیرفعال نمی‌شود (۴۲۲).
   */
  static async deactivateWarehouse(
    id: number,
    executor: DbExecutor = orm
  ): Promise<typeof warehouses.$inferSelect> {
    const run = async (tx: DbTransaction) => {
      const wh = await lockWarehouseForActivation(tx, id);
      if (wh.isActive !== 1) {
        throw new ConflictError(`انبار «${wh.name}» پیش‌تر غیرفعال شده است.`, { warehouseId: wh.id }, 'WAREHOUSE_ALREADY_INACTIVE');
      }

      const [others] = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(warehouses)
        .where(and(eq(warehouses.isActive, 1), ne(warehouses.id, wh.id)));
      if (Number(others?.n || 0) === 0) {
        throw new ValidationError(
          `انبار «${wh.name}» تنها انبار فعال است و غیرفعال نمی‌شود؛ بی انبار فعال هیچ رسید، فروش یا انتقالی ثبت نمی‌شود. ابتدا انبار دیگری تعریف کنید.`,
          { warehouseId: wh.id },
          'WAREHOUSE_LAST_ACTIVE'
        );
      }

      // TD-117: بررسی وجود موجودی کالا در انبار پیش از غیرفعال‌سازی
      // v7.0.52 (TD-219): از item_warehouse_stocks (تنها منبع موجودی)؛ ستون items.stocks در v7.0.48 حذف شد و این
      // بررسی از آن زمان با خطای 500 شکست می‌خورد و هیچ انباری غیرفعال نمی‌شد
      const [stockCheck] = await tx
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(itemWarehouseStocks)
        .innerJoin(items, eq(items.id, itemWarehouseStocks.itemId))
        .where(and(
          eq(itemWarehouseStocks.warehouseId, wh.id),
          eq(items.isDeleted, 0),
          ne(itemWarehouseStocks.currentStock, 0)
        ));

      if (Number(stockCheck?.n || 0) > 0) {
        throw new ConflictError(`انبار «${wh.name}» هنوز موجودی دارد؛ ابتدا موجودی را با سند انتقال خالی کنید.`);
      }

      await tx
        .update(warehouses)
        .set({ isActive: 0 })
        .where(eq(warehouses.id, id));

      return wh;
    };
    return executor === orm ? orm.transaction(run) : run(executor as DbTransaction);
  }

  /**
   * v9.0.112 (TD-490، تصمیم ت۵ الف): فعال‌سازی دوباره انبار غیرفعال (فقط مدیر سیستم، در route)، زیر همان قفل‌ها.
   * انبار با کد رزرو کاردکس (TD-482) فعال نمی‌شود.
   */
  static async reactivateWarehouse(
    id: number,
    executor: DbExecutor = orm
  ): Promise<{ previous: typeof warehouses.$inferSelect; current: typeof warehouses.$inferSelect }> {
    const run = async (tx: DbTransaction) => {
      const wh = await lockWarehouseForActivation(tx, id);
      if (wh.isActive === 1) {
        throw new ConflictError(`انبار «${wh.name}» فعال است.`, { warehouseId: wh.id }, 'WAREHOUSE_ALREADY_ACTIVE');
      }
      if (isLedgerReservedWarehouseCode(wh.code)) {
        throw new ValidationError(
          `کد «${wh.code}» در کاردکس به معنای انبار پیش‌فرض است و انبار «${wh.name}» با این کد دوباره فعال نمی‌شود.`,
          { warehouseId: wh.id, code: wh.code },
          'WAREHOUSE_CODE_RESERVED'
        );
      }
      const [current] = await tx
        .update(warehouses)
        .set({ isActive: 1 })
        .where(eq(warehouses.id, id))
        .returning();
      return { previous: wh, current: current || { ...wh, isActive: 1 } };
    };
    return executor === orm ? orm.transaction(run) : run(executor as DbTransaction);
  }
}

/**
 * v9.0.112 (TD-490): قفل تراکنشی مجموعه انبارهای فعال (دو غیرفعال‌سازی هم‌زمان هر کدام انبار دیگر را فعال نبینند)، سپس
 * قفل `FOR UPDATE` ردیف انبار که با قفل `FOR KEY SHARE` گردش‌های همان انبار ناسازگار است.
 */
async function lockWarehouseForActivation(tx: DbTransaction, id: number): Promise<typeof warehouses.$inferSelect> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.WAREHOUSE_ACTIVE_SET}::bigint)`);
  const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, id)).for('update');
  if (!wh) {
    throw new NotFoundError('انبار یافت نشد');
  }
  return wh;
}
