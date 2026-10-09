import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { users, roles } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { invalidateRoleCache } from '../../lib/memoryCache.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../errors/customErrors.js';
import { ROLE_CODE_PATTERN } from '../../middleware/authorize.js';
import { isCatalogPermission, isSystemAdminRole, missingRequiredPermissions, withRequiredPermissions } from '../../lib/permissions/permissionCatalog.js';
import { assertGrantWithinOwn, assertNotOwnRole, grantorPermissions } from './grantBoundary.js';

export type RoleRow = typeof roles.$inferSelect;

/** Titles of the workflows whose steps need the role; given by the caller, since workflow ranks above users (decision t3 A) */
export type WorkflowsRequiringRole = (db: Parameters<Parameters<typeof orm.transaction>[0]>[0], roleCode: string) => Promise<string[]>;

export interface RoleCreateInput { name: string; code: string; description?: string; permissions?: unknown }
export interface RoleUpdateInput { name?: string; description?: string; permissions?: unknown }

const ROLE_NOT_FOUND = 'نقش یافت نشد';
const ROLE_ENTITY = 'نقش و دسترسی';

/**
 * حوزه H (TD-304): مجوز تازه نقش فقط از کاتالوگ است (نه «*» و نه کلید ناشناخته). کلیدی که نقش از پیش داشت
 * با ویرایش نقش حذف نمی‌شود و ذخیره را رد نمی‌کند.
 */
function assertKnownNewPermissions(requested: string[], existing: string[] = []): void {
  const unknownKeys = requested.filter(p => !isCatalogPermission(p) && !existing.includes(p));
  if (unknownKeys.length > 0) throw new BadRequestError(`مجوز ناشناخته: ${unknownKeys.join('، ')}`);
}

/**
 * v10.0.28 (series 10 phase 3, L5 E7; part of TD-960): a role is created, edited and deleted in one transaction under
 * its row lock, with its audit row written with the same `tx`. Before, the routes wrote the role on the pool and then
 * logged the audit row outside it, so a failed audit write left a role change without its record.
 */
export async function createRole(req: Request, input: RoleCreateInput): Promise<RoleRow> {
  const requested: string[] = Array.isArray(input.permissions) ? input.permissions : [];
  assertKnownNewPermissions(requested);
  // v9.0.86 (TD-880): هر مجوز با نیازهایش ذخیره می‌شود (مثلاً «ویرایش فاکتورها» با «مشاهده فاکتورها»)
  const addedByRequirement = missingRequiredPermissions(requested);
  // v9.0.129 (TD-520، ت۳): نقش تازه فقط مجوزهایی را می‌گیرد که سازنده دارد
  assertGrantWithinOwn(await grantorPermissions(req.user?.role), withRequiredPermissions(requested));

  const slugCode = input.code.trim().toLowerCase().replace(/\s+/g, '_');
  // v7.0.51 (audit P2-10): کد نقش نقطه ندارد تا با کلید مجوز (مثل customers.manage) اشتباه گرفته نشود
  if (!ROLE_CODE_PATTERN.test(slugCode)) {
    throw new BadRequestError('کد نقش فقط می‌تواند حروف کوچک انگلیسی، عدد، خط تیره و زیرخط داشته باشد (نقطه مخصوص نام مجوزهاست)');
  }

  const newRole = await orm.transaction(async (tx) => {
    const existing = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, slugCode));
    if (existing.length > 0) throw new BadRequestError('نقشی با این کد انگلیسی قبلاً وجود دارد');

    const [row] = await tx.insert(roles).values({
      name: input.name,
      code: slugCode,
      description: input.description || '',
      permissions: withRequiredPermissions(requested),
      isSystem: 0,
    }).returning();

    const permissions = (row.permissions as string[] | null) || [];
    await logActivity({
      tx,
      req,
      action: 'CREATE',
      entity: ROLE_ENTITY,
      entityId: row.id,
      description: `ایجاد نقش جدید "${input.name}" با کد "${slugCode}" (${permissions.length} مجوز)`,
      details: {
        after: { id: row.id, name: row.name, code: row.code, description: row.description, permissions: row.permissions },
        addedByRequirement,
      },
    });
    return row;
  });
  invalidateRoleCache(slugCode);
  return newRole;
}

export async function updateRole(req: Request, roleId: number, input: RoleUpdateInput): Promise<void> {
  const grantor = await grantorPermissions(req.user?.role);
  const roleCode = await orm.transaction(async (tx) => {
    const [targetRole] = await tx.select().from(roles).where(eq(roles.id, roleId)).for('update');
    if (!targetRole) throw new NotFoundError(ROLE_NOT_FOUND);
    // v9.0.129 (TD-520، ت۳): نقش خود ویرایشگر ویرایش نمی‌شود
    assertNotOwnRole(req.user?.role, targetRole.code);
    // v9.0.136 (TD-886، قاعده ۳ مدل مجوز): نقش ثابت «مدیر سیستم» را فقط مدیر سیستم ویرایش می‌کند، و فقط نام و توضیح آن را
    if (isSystemAdminRole(targetRole.code)) {
      if (!isSystemAdminRole(req.user?.role)) {
        throw new ForbiddenError('نقش «مدیر سیستم» را فقط مدیر سیستم ویرایش می‌کند', undefined, 'SYSTEM_ADMIN_ROLE_FIXED');
      }
      if (input.permissions !== undefined) {
        throw new ConflictError('مجوزهای نقش «مدیر سیستم» ویرایش نمی‌شود؛ این نقش همیشه همه مجوزها را دارد', undefined, 'SYSTEM_ADMIN_ROLE_FIXED');
      }
    }

    const prevPermissions: string[] = (targetRole.permissions as string[]) || [];
    const sent = Array.isArray(input.permissions);
    const requested: string[] = sent ? input.permissions as string[] : prevPermissions;
    assertKnownNewPermissions(requested, prevPermissions);
    // v9.0.86 (TD-880): فهرست تازه با نیازهایش ذخیره می‌شود؛ ویرایش بی فهرست مجوز، فهرست قبلی را دست نمی‌زند
    const addedByRequirement = sent ? missingRequiredPermissions(requested) : [];
    const newPermissions: string[] = sent ? withRequiredPermissions(requested) : prevPermissions;
    const addedPermissions = newPermissions.filter(p => !prevPermissions.includes(p));
    const removedPermissions = prevPermissions.filter(p => !newPermissions.includes(p));
    // v9.0.129 (TD-520، ت۳): افزوده‌ها فقط از مجوزهای ویرایشگر
    assertGrantWithinOwn(grantor, addedPermissions);

    const updateData: Partial<typeof roles.$inferInsert> = {
      name: input.name || targetRole.name,
      description: input.description !== undefined ? input.description : targetRole.description,
      permissions: newPermissions,
    };
    await tx.update(roles).set(updateData).where(eq(roles.id, roleId));

    await logActivity({
      tx,
      req,
      action: 'UPDATE',
      entity: ROLE_ENTITY,
      entityId: roleId,
      description: `ویرایش مجوزها و اطلاعات نقش "${updateData.name}" (${addedPermissions.length} افزوده، ${removedPermissions.length} حذف شده)`,
      details: {
        roleId,
        roleName: updateData.name,
        roleCode: targetRole.code,
        beforePermissions: prevPermissions,
        afterPermissions: newPermissions,
        addedPermissions,
        removedPermissions,
        addedByRequirement,
      },
    });
    return targetRole.code;
  });
  invalidateRoleCache(roleCode);
}

export async function deleteRole(req: Request, roleId: number, workflowsRequiringRole: WorkflowsRequiringRole): Promise<void> {
  const roleCode = await orm.transaction(async (tx) => {
    const [targetRole] = await tx.select().from(roles).where(eq(roles.id, roleId)).for('update');
    if (!targetRole) throw new NotFoundError(ROLE_NOT_FOUND);

    // v9.0.135 (TD-885، تصمیم ت۹ الف): فقط نقش ثابت «مدیر سیستم» حذف نمی‌شود؛ نقش‌های پیش‌فرض قدیمی نقش عادی‌اند
    if (isSystemAdminRole(targetRole.code)) throw new BadRequestError('نقش «مدیر سیستم» حذف نمی‌شود');

    // v9.0.179 (TD-535، یافته B02-20): فقط کاربران حذف‌نشده نقش را نگه می‌دارند؛ کاربر حذف‌شده با بازگرداندن نقش تازه می‌گیرد
    const assignedUsers = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.role, targetRole.code), eq(users.isDeleted, 0)));
    if (assignedUsers.length > 0) {
      throw new BadRequestError(`این نقش به ${assignedUsers.length} کاربر تخصیص یافته است و ابتدا باید نقش کاربران تغییر یابد`);
    }

    // v9.0.128 (TD-542): نقشی که اقدامی از گردش کار (طرح جاری یا فرایند پایان‌نیافته) به آن بسته است حذف نمی‌شود
    const requiringWorkflows = await workflowsRequiringRole(tx, targetRole.code);
    if (requiringWorkflows.length > 0) {
      throw new ConflictError(
        `این نقش نقش گام در گردش کار ${requiringWorkflows.map(t => `«${t}»`).join('، ')} است؛ نخست در طراح گردش کار نقش آن گام‌ها را عوض کنید.`,
        undefined, 'ROLE_USED_BY_WORKFLOW',
      );
    }

    await tx.delete(roles).where(eq(roles.id, roleId));
    await logActivity({
      tx,
      req,
      action: 'DELETE',
      entity: ROLE_ENTITY,
      entityId: roleId,
      description: `حذف نقش "${targetRole.name}" (کد: ${targetRole.code})`,
      details: { before: targetRole, deletedAt: new Date().toISOString() },
    });
    return targetRole.code;
  });
  invalidateRoleCache(roleCode);
}
