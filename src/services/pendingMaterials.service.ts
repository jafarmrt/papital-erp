import { eq, and } from 'drizzle-orm';
import type { Request } from 'express';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { pendingMaterials, items, productionProjects } from '../db/schema.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors/customErrors.js';
import { moneyOr } from '../lib/money.js';
import { logActivity } from '../lib/auditLogger.js';
import { isDataUrl, uploadBase64ToStorage } from '../lib/storage.js';
import { ItemCatalogService } from './items/itemCatalog.service.js';
import { WorkflowEngineService } from './workflow/workflowEngineService.js';
import { terminateOpenWorkflows } from './workflow/workflowTermination.js';

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

/** The user who sends or reviews a request; the audit row is written with `req`, or with the id and name */
export interface PendingMaterialActor {
  req?: Request;
  userId?: number;
  username?: string;
  /** v9.0.379 (TD-826): the change comes from a transition of the request's own workflow, which stays open for it */
  viaWorkflow?: boolean;
}

type PendingMaterialRow = typeof pendingMaterials.$inferSelect;

const ENTITY = 'ماده اولیه';
const STATUS_LABELS: Record<string, string> = { pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده' };

/** v9.0.378 (TD-825): a number of the request; the route schema read it with `decimalInput` and refused a negative one */
const quantityOf = (value: number | string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** The request's image: a data URL goes to a file (JPG, PNG, WEBP or GIF up to 3 MB, else 422), a stored path stays */
const storedImage = async (value: string | undefined, kind: 'image' | 'thumbnail'): Promise<string> =>
  isDataUrl(value) ? uploadBase64ToStorage(value, kind) : (value || '');

/** The request row for the audit, without the image (older requests may hold a large data URL) */
export function pendingMaterialAuditSnapshot(row: PendingMaterialRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    category: row.category,
    status: STATUS_LABELS[row.status ?? ''] ?? row.status,
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    reorderPoint: Number(row.reorderPoint ?? 0),
    weightedAverageCost: Number(row.weightedAverageCost ?? 0),
    color: row.color,
    weight: Number(row.weight ?? 0),
    material: row.material,
    size: row.size,
    itemId: row.itemId ?? null,
    rejectionReason: row.rejectionReason
  };
}

/**
 * v9.0.378 (TD-825، یافته B07-09): ردیف درخواست زنده با قفل `FOR UPDATE`. تأیید، رد، ویرایش و حذف هر کدام در یک تراکنش با
 * همین قفل اجرا می‌شوند، پس دو بررسی هم‌زمان یک درخواست پشت سر هم می‌روند و دومی وضعیت تازه را می‌بیند.
 */
async function lockLiveRequest(tx: DbExecutor, id: number): Promise<PendingMaterialRow> {
  const [row] = await tx.select().from(pendingMaterials)
    .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)))
    .for('update');
  if (!row) throw new NotFoundError('ماده اولیه مورد نظر یافت نشد', undefined, 'PENDING_MATERIAL_NOT_FOUND');
  return row;
}

/**
 * فقط درخواست «در انتظار تأیید» تأیید، رد، ویرایش یا حذف می‌شود؛ پیش‌تر درخواست تأییدشده رد یا حذف و درخواست ردشده دوباره
 * تأیید می‌شد (دو کالا از یک درخواست)
 */
function assertStillPending(row: PendingMaterialRow, action: string): void {
  if (row.status === 'pending') return;
  const status = STATUS_LABELS[row.status ?? ''] ?? row.status;
  throw new ConflictError(
    `این درخواست ماده اولیه قبلاً بررسی شده است (${status}) و ${action} نمی‌شود`,
    { status: row.status, itemId: row.itemId ?? null },
    'PENDING_MATERIAL_NOT_PENDING'
  );
}

/**
 * v9.0.379 (TD-826، تصمیم ت۵): تأیید، رد یا حذف مستقیم فرایند در جریان درخواست را در همان تراکنش می‌بندد (پس از قفل ردیف
 * درخواست، همان ترتیب «موجودیت ← نمونه» انتقال گردش کار)، مثل سندی که بیرون از گردش کار قطعی می‌شود
 */
async function closeOpenWorkflow(tx: DbExecutor, id: number, actor: PendingMaterialActor, actionTitle: string): Promise<void> {
  if (actor.viaWorkflow) return;
  await terminateOpenWorkflows(tx, {
    entityType: 'pending_material', entityId: id, actionKey: 'terminate', actionTitle, comment: actionTitle,
    userId: actor.userId ?? null, userName: actor.username ?? null,
  });
}

/**
 * v9.0.379 (TD-826): پروژه درخواست زنده است و عنوانش از خود پروژه خوانده می‌شود (۴۲۲ برای پروژه ناموجود یا حذف‌شده)؛ پیش‌تر
 * عنوان از بدنه درخواست می‌آمد.
 */
async function requestProject(tx: DbExecutor, projectId: number | string | null | undefined): Promise<{ id: number | null; title: string }> {
  if (projectId === undefined || projectId === null || projectId === '') return { id: null, title: '' };
  const id = Number(projectId);
  const [project] = Number.isSafeInteger(id) && id > 0
    ? await tx.select({ id: productionProjects.id, title: productionProjects.title }).from(productionProjects)
      .where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0))).for('share')
    : [];
  if (!project) throw new ValidationError('پروژه این درخواست ماده اولیه پیدا نشد یا حذف شده است', { projectId }, 'PENDING_MATERIAL_PROJECT_INVALID');
  return { id: project.id, title: project.title };
}

const inTransaction = <T>(externalTx: DbExecutor | undefined, work: (tx: DbExecutor) => Promise<T>): Promise<T> =>
  externalTx ? work(externalTx) : orm.transaction(work);

export class PendingMaterialsService {
  /**
   * Retrieves pending material by ID
   */
  static async getById(id: number, executor: DbExecutor = orm): Promise<PendingMaterialRow | null> {
    const [row] = await executor
      .select()
      .from(pendingMaterials)
      .where(and(eq(pendingMaterials.id, id), eq(pendingMaterials.isDeleted, 0)));
    return row || null;
  }

  /**
   * Submits a new pending raw material from project control.
   * v9.0.378 (TD-825): no `TEMP-<ms>` code (the reviewer gives the code), numbers come validated by the route schema and an
   * inline image is stored as a file; the request and its audit row are written in one transaction.
   */
  static async submitPendingMaterial(
    input: CreatePendingMaterialInput,
    actor: PendingMaterialActor = {},
    externalTx?: DbExecutor
  ): Promise<PendingMaterialRow> {
    const image = await storedImage(input.image, 'image');
    const thumbnail = await storedImage(input.thumbnail, 'thumbnail');
    return inTransaction(externalTx, async (tx) => {
      const project = await requestProject(tx, input.projectId);
      const [inserted] = await tx
        .insert(pendingMaterials)
        .values({
          code: (input.code ?? '').trim(),
          name: input.name.trim(),
          unit: input.unit?.trim() || 'عدد',
          category: input.category?.trim() || 'عمومی',
          type: 'raw_material',
          projectId: project.id,
          projectTitle: project.title,
          requestedBy: input.requestedBy || actor.username || 'کاربر سامانه',
          status: 'pending',
          reorderPoint: quantityOf(input.reorderPoint, 0),
          weightedAverageCost: moneyOr(input.weightedAverageCost, 0),
          color: input.color || '',
          weight: quantityOf(input.weight, 0),
          material: input.material || '',
          size: input.size || '',
          image,
          thumbnail,
          isDeleted: 0
        })
        .returning();

      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'CREATE',
        entity: ENTITY,
        entityId: inserted.id,
        description: `ثبت درخواست ماده اولیه "${inserted.name}" جهت بررسی انباردار`,
        details: { after: pendingMaterialAuditSnapshot(inserted) }
      });
      // v9.0.379 (TD-826): with an active «pending_material» definition the request's workflow starts in the same transaction
      await WorkflowEngineService.maybeStartWorkflow({
        entityType: 'pending_material', entityId: inserted.id, userId: actor.userId, userName: actor.username, tx,
      });
      return inserted;
    });
  }

  /**
   * Approves a pending material and registers it into the official items catalog.
   * v9.0.378 (TD-825, finding B07-09): one transaction under the request row lock and only from `pending` (409
   * `PENDING_MATERIAL_NOT_PENDING`). The item is made by `ItemCatalogService.createItem` (code and name unique case-insensitively,
   * code series counter, image to a file) and its id stays on the request (`item_id`); the item's CREATE row and the
   * request's UPDATE row are written in the same transaction. Before, two approvals made two items with one code and an
   * approved request could be rejected and approved again into a second item.
   */
  static async approvePendingMaterial(
    id: number,
    overrides: ApprovePendingMaterialInput = {},
    actor: PendingMaterialActor = {},
    externalTx?: DbExecutor
  ): Promise<{ pendingRecord: PendingMaterialRow; officialItem: typeof items.$inferSelect }> {
    return inTransaction(externalTx, async (tx) => {
      const existing = await lockLiveRequest(tx, id);
      assertStillPending(existing, 'تأیید');
      await closeOpenWorkflow(tx, id, actor, 'بستن فرایند با تأیید مستقیم درخواست ماده اولیه');

      const code = (overrides.code ?? existing.code ?? '').trim();
      if (!code) throw new ValidationError('برای ثبت ماده اولیه در انبار، کد کالا را وارد کنید', undefined, 'PENDING_MATERIAL_CODE_REQUIRED');
      const name = (overrides.name || existing.name).trim();
      const unit = (overrides.unit || existing.unit).trim();
      const category = (overrides.category || existing.category || 'عمومی').trim();

      const { item } = await ItemCatalogService.createItem({
        type: 'raw_material',
        name,
        code,
        unit,
        category,
        image: overrides.image ?? existing.image ?? '',
        thumbnail: overrides.thumbnail ?? existing.thumbnail ?? '',
        reorder_point: overrides.reorderPoint ?? existing.reorderPoint ?? 0,
        weighted_average_cost: overrides.weightedAverageCost ?? Number(existing.weightedAverageCost ?? 0),
        color: overrides.color ?? existing.color ?? '',
        weight: overrides.weight ?? existing.weight ?? 0,
        material: overrides.material ?? existing.material ?? '',
        size: overrides.size ?? existing.size ?? ''
      }, { id: actor.userId, username: actor.username }, tx);

      const [approved] = await tx.update(pendingMaterials)
        .set({ status: 'approved', code: item.code, name: item.name, unit: item.unit, category: item.category ?? category, itemId: item.id })
        .where(eq(pendingMaterials.id, id))
        .returning();

      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'CREATE',
        entity: 'کالا',
        entityId: item.id,
        description: `کالای "${item.name}" با کد "${item.code}" از درخواست ماده اولیه شماره ${id} تأیید و در انبار ثبت شد`,
        details: {
          after: {
            id: item.id, name: item.name, code: item.code, type: item.type, category: item.category, unit: item.unit,
            reorderPoint: Number(item.reorderPoint ?? 0), weightedAverageCost: Number(item.weightedAverageCost ?? 0),
            color: item.color, weight: item.weight, material: item.material, size: item.size
          },
          pendingMaterialId: id
        }
      });
      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'UPDATE',
        entity: ENTITY,
        entityId: id,
        description: `درخواست ماده اولیه "${item.name}" تأیید شد و کالای شماره ${item.id} ساخته شد`,
        details: { before: pendingMaterialAuditSnapshot(existing), after: pendingMaterialAuditSnapshot(approved) }
      });

      return { pendingRecord: approved, officialItem: item };
    });
  }

  /**
   * Rejects a pending material request.
   * v9.0.378 (TD-825): only from `pending`, under the row lock, with its audit row in the same transaction.
   */
  static async rejectPendingMaterial(
    id: number,
    rejectionReason?: string,
    actor: PendingMaterialActor = {},
    externalTx?: DbExecutor
  ): Promise<PendingMaterialRow> {
    return inTransaction(externalTx, async (tx) => {
      const existing = await lockLiveRequest(tx, id);
      assertStillPending(existing, 'رد');
      await closeOpenWorkflow(tx, id, actor, 'بستن فرایند با رد مستقیم درخواست ماده اولیه');
      const reason = rejectionReason?.trim() || 'عدم تأیید توسط انباردار';
      const [rejected] = await tx.update(pendingMaterials)
        .set({ status: 'rejected', rejectionReason: reason })
        .where(eq(pendingMaterials.id, id))
        .returning();

      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'UPDATE',
        entity: ENTITY,
        entityId: id,
        description: `درخواست ماده اولیه "${rejected.name}" رد شد و کالایی در انبار ثبت نشد`,
        details: { before: pendingMaterialAuditSnapshot(existing), after: pendingMaterialAuditSnapshot(rejected) }
      });
      return rejected;
    });
  }

  /**
   * Updates details of a pending material (only while pending; TD-302).
   * v9.0.378 (TD-825): under the row lock, with its audit row in the same transaction.
   */
  static async updatePendingMaterial(
    id: number,
    data: UpdatePendingMaterialInput,
    actor: PendingMaterialActor = {},
    externalTx?: DbExecutor
  ): Promise<PendingMaterialRow> {
    return inTransaction(externalTx, async (tx) => {
      const existing = await lockLiveRequest(tx, id);
      assertStillPending(existing, 'ویرایش');
      const [updated] = await tx
        .update(pendingMaterials)
        .set({
          code: data.code !== undefined ? data.code.trim() : existing.code,
          name: data.name !== undefined ? data.name.trim() : existing.name,
          unit: data.unit !== undefined ? data.unit.trim() : existing.unit,
          category: data.category !== undefined ? data.category.trim() : existing.category,
          reorderPoint: quantityOf(data.reorderPoint, Number(existing.reorderPoint ?? 0)),
          weightedAverageCost: data.weightedAverageCost !== undefined ? moneyOr(data.weightedAverageCost, 0) : existing.weightedAverageCost,
          color: data.color !== undefined ? data.color : existing.color,
          weight: quantityOf(data.weight, Number(existing.weight ?? 0)),
          material: data.material !== undefined ? data.material : existing.material,
          size: data.size !== undefined ? data.size : existing.size
        })
        .where(eq(pendingMaterials.id, id))
        .returning();

      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'UPDATE',
        entity: ENTITY,
        entityId: id,
        description: `ویرایش مشخصات درخواست ماده اولیه "${updated.name}"`,
        details: { before: pendingMaterialAuditSnapshot(existing), after: pendingMaterialAuditSnapshot(updated) }
      });
      return updated;
    });
  }

  /**
   * Soft-deletes a pending material.
   * v9.0.378 (TD-825): only while pending (a reviewed request is the record of its item or its rejection), under the row
   * lock, with its audit row in the same transaction.
   */
  static async deletePendingMaterial(
    id: number,
    actor: PendingMaterialActor = {},
    externalTx?: DbExecutor
  ): Promise<PendingMaterialRow> {
    return inTransaction(externalTx, async (tx) => {
      const existing = await lockLiveRequest(tx, id);
      assertStillPending(existing, 'حذف');
      await closeOpenWorkflow(tx, id, actor, 'بستن فرایند با حذف درخواست ماده اولیه');
      await tx.update(pendingMaterials).set({ isDeleted: 1 }).where(eq(pendingMaterials.id, id));

      await logActivity({
        req: actor.req, userId: actor.userId, username: actor.username, tx,
        action: 'DELETE',
        entity: ENTITY,
        entityId: id,
        description: `حذف درخواست ماده اولیه "${existing.name}"`,
        details: { before: pendingMaterialAuditSnapshot(existing) }
      });
      return existing;
    });
  }
}
