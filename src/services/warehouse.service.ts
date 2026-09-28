import { eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { warehouses } from '../db/schema.js';
import { NotFoundError, ConflictError, BadRequestError } from '../errors/customErrors.js';

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
    return executor.select().from(warehouses).where(eq(warehouses.isActive, 1));
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

    const [existing] = await executor
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.code, cleanCode));
    if (existing) {
      throw new ConflictError(`انباری با کد «${cleanCode}» از قبل در سیستم تعریف شده است.`);
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
   * Deactivates warehouse after checking for non-zero inventory balances
   */
  static async deactivateWarehouse(
    id: number,
    executor: DbExecutor = orm
  ): Promise<typeof warehouses.$inferSelect> {
    const [wh] = await executor.select().from(warehouses).where(eq(warehouses.id, id));
    if (!wh) {
      throw new NotFoundError('انبار یافت نشد');
    }

    // TD-117: بررسی وجود موجودی کالا در انبار پیش از غیرفعال‌سازی
    const resCheck = await executor.execute(sql`
      SELECT COUNT(*)::int AS n FROM items
      WHERE is_deleted = 0 AND COALESCE((stocks->>${wh.code}::text)::numeric, 0) <> 0`);
    
    if (Number((resCheck.rows[0] as { n?: number })?.n || 0) > 0) {
      throw new ConflictError(`انبار «${wh.name}» هنوز موجودی دارد؛ ابتدا موجودی را با سند انتقال خالی کنید.`);
    }

    await executor
      .update(warehouses)
      .set({ isActive: 0 })
      .where(eq(warehouses.id, id));

    return wh;
  }
}
