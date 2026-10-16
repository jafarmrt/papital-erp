import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { notifications, personnel, projectManagers, roles, users } from '../../db/schema.js';
import { ForbiddenError, ValidationError } from '../../errors/customErrors.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { WORKSHOP_ERRORS } from '../../lib/workshop/workshopSchedule.js';

/**
 * v10.1.38 (N-01 part 2): who the workshop cartable's user is. A worker acts only as the live personnel linked to their
 * user (`personnel.user_id`, TD-435); a reviewer reviews only the projects they manage (`project_managers`, decision ت۳
 * الف), the system admin every project.
 */

export interface WorkshopUser {
  id: number;
  username: string;
  fullName: string;
  isAdmin: boolean;
}

export function workshopUserOf(user: { id?: number; username?: string; fullName?: string | null; role?: string } | undefined): WorkshopUser {
  const id = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new ForbiddenError('ورود شما معتبر نیست؛ دوباره وارد شوید.');
  return {
    id,
    username: user?.username || '',
    fullName: user?.fullName || user?.username || '',
    isAdmin: user?.role === SYSTEM_ADMIN_ROLE,
  };
}

/** Who writes: the user and the request (for the audit row's address and trace id). */
export interface WorkshopActor {
  user: WorkshopUser;
  req?: unknown;
}

export interface LinkedPersonnel {
  id: number;
  fullName: string;
}

/** The live personnel linked to the user, else 422 «حساب شما به پرونده پرسنلی وصل نیست». */
export async function requireLinkedPersonnel(executor: DbExecutor, userId: number, lock = false): Promise<LinkedPersonnel> {
  const query = executor.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
    .where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0)))
    .orderBy(asc(personnel.id)).limit(1);
  const [row] = lock ? await query.for('share') : await query;
  if (!row) throw new ValidationError(WORKSHOP_ERRORS.personnelNotLinked.message, undefined, WORKSHOP_ERRORS.personnelNotLinked.code);
  return { id: row.id, fullName: row.fullName };
}

/** The managers of a project (user ids of live users). */
export async function projectManagerUserIds(executor: DbExecutor, projectId: number): Promise<number[]> {
  const rows = await executor.select({ userId: projectManagers.userId }).from(projectManagers)
    .innerJoin(users, eq(users.id, projectManagers.userId))
    .where(and(eq(projectManagers.projectId, projectId), eq(users.isDeleted, 0)))
    .orderBy(asc(projectManagers.userId));
  return rows.map(r => r.userId);
}

/** Projects the user reviews: every project for the system admin (null), else the ones naming them as manager. */
export async function reviewableProjectIds(executor: DbExecutor, user: WorkshopUser): Promise<number[] | null> {
  if (user.isAdmin) return null;
  const rows = await executor.select({ projectId: projectManagers.projectId }).from(projectManagers)
    .where(eq(projectManagers.userId, user.id)).orderBy(asc(projectManagers.projectId));
  return rows.map(r => r.projectId);
}

export async function assertProjectReviewer(executor: DbExecutor, user: WorkshopUser, projectId: number): Promise<void> {
  if (user.isAdmin) return;
  const [row] = await executor.select({ id: projectManagers.id }).from(projectManagers)
    .where(and(eq(projectManagers.projectId, projectId), eq(projectManagers.userId, user.id)));
  if (!row) throw new ForbiddenError(WORKSHOP_ERRORS.notProjectManager.message, undefined, WORKSHOP_ERRORS.notProjectManager.code);
}

/** The system admin and every live user whose role holds the key (the rule of `can`), read with the caller's `tx`. */
export async function permissionHolderIds(executor: DbExecutor, permission: string): Promise<number[]> {
  const rows = await executor.select({ id: users.id }).from(users)
    .leftJoin(roles, eq(roles.code, users.role))
    .where(and(eq(users.isDeleted, 0), sql`(${users.role} = ${SYSTEM_ADMIN_ROLE} OR coalesce(${roles.permissions}, '[]'::jsonb) ? ${permission})`))
    .orderBy(asc(users.id));
  return rows.map(r => r.id);
}

/** Live users with these ids (a removed user gets no notification). */
export async function liveUserIds(executor: DbExecutor, ids: readonly number[]): Promise<number[]> {
  const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  const rows = await executor.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, unique), eq(users.isDeleted, 0))).orderBy(asc(users.id));
  return rows.map(r => r.id);
}

export interface WorkshopNotification {
  type: string;
  title: string;
  message: string;
  link: string;
}

/** One in-app notification per recipient, in the caller's transaction; the sender never notifies themselves. */
export async function notifyUsers(tx: DbExecutor, recipientIds: readonly number[], sender: WorkshopUser, note: WorkshopNotification): Promise<void> {
  const ids = [...new Set(recipientIds)].filter(id => id !== sender.id);
  if (ids.length === 0) return;
  await tx.insert(notifications).values(ids.map(userId => ({
    userId,
    senderId: sender.id,
    senderName: sender.fullName || sender.username || 'کارتابل کارگاه',
    type: note.type,
    title: note.title,
    message: note.message,
    link: note.link,
    isRead: 0,
  })));
}
