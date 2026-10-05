import { eq, and } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { pendingMaterials, items } from '../db/schema.js';
import { NotFoundError, ConflictError } from '../errors/customErrors.js';
import { moneyOr } from '../lib/money.js';

export interface CreatePendingMaterialInput {
  name: string;
  code?: string;
  unit?: string;
  category?: string;
  projectId?: number | string | null;
  projectTitle?: string;
  requestedBy?: string;
  reorderPoint?: number | string;
  weightedAverageCost?: number | string;
  color?: string;
  weight?: number | string;
  material?: string;
  size?: string;
  image?: string;
  thumbnail?: string;
}

export interface ApprovePendingMaterialInput {
  code?: string;
  name?: string;
  unit?: string;
  category?: string;
  reorderPoint?: number | string;
  weightedAverageCost?: number | string;
  color?: string;
  weight?: number | string;
  material?: string;
  size?: string;
  image?: string;
  thumbnail?: string;
}

export interface UpdatePendingMaterialInput {
  code?: string;
  name?: string;
  unit?: string;
  category?: string;
  reorderPoint?: number | string;
  weightedAverageCost?: number | string;
  color?: string;
  weight?: number | string;
  material?: string;
  size?: string;
}

export class PendingMaterialsService {
  /**
   * Retrieves pending material by ID
   */
  static async getById(id: number, executor: DbExecutor = orm): Promise<typeof pendingMaterials.$inferSelect | null> {
    const [row] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));
    return row || null;
  }

  /**
   * Submits a new pending raw material from project control
   */
  static async submitPendingMaterial(
    input: CreatePendingMaterialInput,
    executor: DbExecutor = orm
  ): Promise<typeof pendingMaterials.$inferSelect> {
    const code = input.code ? input.code.trim() : `TEMP-${Date.now()}`;
    const name = input.name.trim();
    const unit = input.unit ? input.unit.trim() : 'عدد';
    const category = input.category ? input.category.trim() : 'عمومی';
    const projectId = input.projectId ? Number(input.projectId) : null;
    const projectTitle = input.projectTitle ? input.projectTitle.trim() : '';
    const requestedBy = input.requestedBy || 'کاربر سیستم';

    const [inserted] = await executor
      .insert(pendingMaterials)
      .values({
        code,
        name,
        unit,
        category,
        type: 'raw_material',
        projectId,
        projectTitle,
        requestedBy,
        status: 'pending',
        reorderPoint: Number(input.reorderPoint) || 0,
        weightedAverageCost: moneyOr(input.weightedAverageCost, 0),
        color: input.color || '',
        weight: Number(input.weight) || 0,
        material: input.material || '',
        size: input.size || '',
        image: input.image || '',
        thumbnail: input.thumbnail || '',
        isDeleted: 0
      })
      .returning();

    return inserted;
  }

  /**
   * Approves pending material and registers it into official items catalog
   */
  static async approvePendingMaterial(
    id: number,
    overrides?: ApprovePendingMaterialInput,
    executor: DbExecutor = orm
  ): Promise<{ pendingRecord: typeof pendingMaterials.$inferSelect; officialItem: typeof items.$inferSelect }> {
    const [existing] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('ماده اولیه مورد نظر یافت نشد');
    }

    const finalCode = (overrides?.code || existing.code).trim();
    const finalName = (overrides?.name || existing.name).trim();
    const finalUnit = (overrides?.unit || existing.unit).trim();
    const finalCategory = (overrides?.category || existing.category || 'عمومی').trim();

    // Check code duplication in official items
    const [codeDup] = await executor
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.code, finalCode), eq(items.isDeleted, 0)));

    if (codeDup) {
      throw new ConflictError(`کد کالا «${finalCode}» قبلاً در انبار ثبت شده است. لطفاً کد دیگری انتخاب کنید.`);
    }

    // Register into official items table
    const [newItem] = await executor
      .insert(items)
      .values({
        type: 'raw_material',
        name: finalName,
        code: finalCode,
        unit: finalUnit,
        category: finalCategory,
        currentStock: 0,
        reorderPoint: Number(overrides?.reorderPoint ?? existing.reorderPoint) || 0,
        weightedAverageCost: moneyOr(overrides?.weightedAverageCost ?? existing.weightedAverageCost, 0),
        color: overrides?.color ?? existing.color ?? '',
        weight: Number(overrides?.weight ?? existing.weight) || 0,
        material: overrides?.material ?? existing.material ?? '',
        size: overrides?.size ?? existing.size ?? '',
        image: overrides?.image ?? existing.image ?? '',
        thumbnail: overrides?.thumbnail ?? existing.thumbnail ?? '',
        isDeleted: 0,
        version: 1
      })
      .returning();

    // Update pending_materials status
    const [updatedPending] = await executor
      .update(pendingMaterials)
      .set({
        status: 'approved',
        code: finalCode,
        name: finalName,
        unit: finalUnit,
        category: finalCategory
      })
      .where(eq(pendingMaterials.id, id))
      .returning();

    return {
      pendingRecord: updatedPending || { ...existing, status: 'approved' },
      officialItem: newItem
    };
  }

  /**
   * Rejects pending material request
   */
  static async rejectPendingMaterial(
    id: number,
    rejectionReason?: string,
    executor: DbExecutor = orm
  ): Promise<typeof pendingMaterials.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('ماده اولیه مورد نظر یافت نشد');
    }

    const reason = rejectionReason ? rejectionReason.trim() : 'عدم تأیید توسط انباردار';
    const [updated] = await executor
      .update(pendingMaterials)
      .set({
        status: 'rejected',
        rejectionReason: reason
      })
      .where(eq(pendingMaterials.id, id))
      .returning();

    return updated || { ...existing, status: 'rejected', rejectionReason: reason };
  }

  /**
   * Updates details of pending material
   */
  static async updatePendingMaterial(
    id: number,
    data: UpdatePendingMaterialInput,
    executor: DbExecutor = orm
  ): Promise<typeof pendingMaterials.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('ماده اولیه مورد نظر یافت نشد');
    }
    // حوزه H (TD-302): درخواست تأییدشده یا ردشده دیگر ویرایش نمی‌شود
    if (existing.status !== 'pending') {
      throw new ConflictError('این درخواست ماده اولیه قبلاً بررسی شده است و قابل ویرایش نیست');
    }

    const [updated] = await executor
      .update(pendingMaterials)
      .set({
        code: data.code !== undefined ? data.code.trim() : existing.code,
        name: data.name !== undefined ? data.name.trim() : existing.name,
        unit: data.unit !== undefined ? data.unit.trim() : existing.unit,
        category: data.category !== undefined ? data.category.trim() : existing.category,
        reorderPoint: data.reorderPoint !== undefined ? Number(data.reorderPoint) || 0 : existing.reorderPoint,
        weightedAverageCost: data.weightedAverageCost !== undefined ? moneyOr(data.weightedAverageCost, 0) : existing.weightedAverageCost,
        color: data.color !== undefined ? data.color : existing.color,
        weight: data.weight !== undefined ? Number(data.weight) || 0 : existing.weight,
        material: data.material !== undefined ? data.material : existing.material,
        size: data.size !== undefined ? data.size : existing.size
      })
      .where(eq(pendingMaterials.id, id))
      .returning();

    return updated;
  }

  /**
   * Soft-deletes a pending material
   */
  static async deletePendingMaterial(
    id: number,
    executor: DbExecutor = orm
  ): Promise<typeof pendingMaterials.$inferSelect> {
    const [existing] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      throw new NotFoundError('ماده اولیه مورد نظر یافت نشد');
    }

    await executor
      .update(pendingMaterials)
      .set({ isDeleted: 1 })
      .where(eq(pendingMaterials.id, id));

    return existing;
  }
}
