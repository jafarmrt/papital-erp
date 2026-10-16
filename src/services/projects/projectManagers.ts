import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { projectManagers, users } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { MAX_PROJECT_MANAGERS, type ProjectManagerView } from '../../lib/projects/projectManagers.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { ProjectActor } from './projectStatusSync.js';

/**
 * v10.1.37 (N-01, TD-1283, decision ت۳ الف of the mobile workshop plan): «مسئولان پروژه», the users who review the
 * end-of-task reports of a project's personnel. Saved with the project (create and edit, in their transaction, after
 * the project row) and audited with the same `tx`; a missing, deleted or repeated user refuses the save with 422.
 */
export const PROJECT_MANAGER_INVALID = 'PROJECT_MANAGER_INVALID';

/** Managers of the given projects, by project id, names from the user rows (deleted users included, marked). */
export async function readProjectManagers(executor: DbExecutor, projectIds: number[]): Promise<Map<number, ProjectManagerView[]>> {
  const byProject = new Map<number, ProjectManagerView[]>();
  if (projectIds.length === 0) return byProject;
  const rows = await executor
    .select({ projectId: projectManagers.projectId, userId: projectManagers.userId, fullName: users.fullName, username: users.username, isDeleted: users.isDeleted })
    .from(projectManagers)
    .innerJoin(users, eq(users.id, projectManagers.userId))
    .where(inArray(projectManagers.projectId, projectIds))
    .orderBy(asc(projectManagers.projectId), asc(projectManagers.id));
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ userId: row.userId, fullName: row.fullName || row.username, username: row.username, isDeleted: row.isDeleted === 1 });
    byProject.set(row.projectId, list);
  }
  return byProject;
}

function managerIdsError(message: string, details?: unknown): ValidationError {
  return new ValidationError(message, details, PROJECT_MANAGER_INVALID);
}

/**
 * Replaces a project's managers with `userIds` (the caller holds the project row lock). Users are read `FOR SHARE`, so
 * a user deleted meanwhile cannot become a manager; an unchanged list writes nothing.
 */
export async function setProjectManagers(
  tx: DbExecutor,
  project: { id: number; projectCode: string; title: string },
  userIds: number[],
  actor: ProjectActor & { userId?: number },
): Promise<void> {
  const wanted = userIds.map(Number);
  if (wanted.some(id => !Number.isInteger(id) || id <= 0)) throw managerIdsError('شناسه مسئول پروژه نامعتبر است.');
  if (new Set(wanted).size !== wanted.length) throw managerIdsError('یک کاربر دو بار مسئول پروژه انتخاب شده است.');
  if (wanted.length > MAX_PROJECT_MANAGERS) {
    throw managerIdsError(`یک پروژه حداکثر ${toPersianDigits(MAX_PROJECT_MANAGERS)} مسئول دارد.`);
  }

  const live = wanted.length === 0 ? [] : await tx
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(and(inArray(users.id, wanted), eq(users.isDeleted, 0)))
    .orderBy(asc(users.id))
    .for('share');
  const liveIds = new Set(live.map(u => u.id));
  const missing = wanted.filter(id => !liveIds.has(id));
  if (missing.length > 0) {
    throw managerIdsError('مسئول پروژه باید کاربر فعال سامانه باشد؛ کاربر انتخاب‌شده پیدا نشد یا حذف شده است.', { userIds: missing });
  }

  const current = (await readProjectManagers(tx, [project.id])).get(project.id) ?? [];
  const currentIds = current.map(m => m.userId);
  const removed = currentIds.filter(id => !wanted.includes(id));
  const added = wanted.filter(id => !currentIds.includes(id));
  if (removed.length === 0 && added.length === 0) return;

  if (removed.length > 0) {
    await tx.delete(projectManagers).where(and(eq(projectManagers.projectId, project.id), inArray(projectManagers.userId, removed)));
  }
  if (added.length > 0) {
    await tx.insert(projectManagers).values(added.map(userId => ({ projectId: project.id, userId, createdById: actor.userId ?? null })));
  }

  const nameOf = new Map(live.map(u => [u.id, u.fullName || u.username]));
  current.forEach(m => { if (!nameOf.has(m.userId)) nameOf.set(m.userId, m.fullName); });
  const names = (ids: number[]) => ids.map(id => nameOf.get(id) ?? `#${id}`);
  await logActivity({
    tx,
    req: actor.req as never,
    userId: actor.userId,
    username: actor.username,
    userFullName: actor.userFullName,
    action: 'UPDATE',
    entity: 'پروژه تولید',
    entityId: String(project.id),
    description: `تغییر مسئولان پروژه تولید ${project.projectCode} (${project.title})`,
    details: {
      before: { managers: names(currentIds) },
      after: { managers: names(wanted) },
      changes: { managers: { before: names(currentIds), after: names(wanted) } },
    },
  });
}
