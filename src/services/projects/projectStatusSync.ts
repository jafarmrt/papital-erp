import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { productionProjects, projectStages } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessNowIsoDateTime } from '../../lib/businessClock.js';
import { matrixProjectStatus, projectStatusLabel } from '../../lib/projects/projectStatus.js';
import { loadProjectProgressMatrix } from './projectProgressMatrix.js';

type ProjectRow = typeof productionProjects.$inferSelect;
type StageRow = typeof projectStages.$inferSelect;

export const PROJECT_AUDIT_ENTITY = 'پروژه تولید';

/** کاربر نوشتن برای ردیف ممیزی (`req` کاربر و IP را می‌دهد) */
export interface ProjectActor {
  req?: unknown;
  userId?: number;
  username?: string;
  userFullName?: string;
}

export const actorName = (actor: ProjectActor): string => {
  const reqUser = (actor.req as { user?: { username?: string } } | undefined)?.user;
  return actor.username || reqUser?.username || 'سیستم';
};

/** ردیف پروژه زنده با قفل `FOR UPDATE`؛ نوشتن‌های مرحله و ماتریس پشت هم اجرا می‌شوند */
export async function lockLiveProject(tx: DbExecutor, projectId: number): Promise<ProjectRow> {
  const [project] = await tx.select().from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)))
    .for('update');
  if (!project) throw new NotFoundError('پروژه یافت نشد');
  return project;
}

export interface SyncedStage extends StageRow {
  completedSkusCount?: number;
  applicableSkusCount?: number;
}

export interface ProjectStatusSyncResult {
  project: ProjectRow;
  stages: SyncedStage[];
  weightedProgress: number;
}

/**
 * v9.0.334 (TD-738، تصمیم ت۱ الف): درصد و وضعیت مراحل و وضعیت پروژه از ماتریس پیشرفت، فقط درون تراکنش یک نوشتن و پس
 * از قفل ردیف پروژه (`lockLiveProject`). «متوقف‌شده» و «لغوشده» تغییر نمی‌کنند و هر تغییر وضعیت پروژه یک ردیف ممیزی با
 * پیش و پس در همان تراکنش دارد. خواندن پروژه هرگز این تابع را اجرا نمی‌کند.
 */
export async function syncProjectFromMatrix(tx: DbExecutor, project: ProjectRow, actor: ProjectActor = {}): Promise<ProjectStatusSyncResult> {
  const { stages: rawStages, matrix } = await loadProjectProgressMatrix(tx, project);
  if (rawStages.length === 0) return { project, stages: [], weightedProgress: matrix.weightedProgress };

  const bizNow = await businessNowIsoDateTime();
  let anyProgress = false;
  let allStagesCompleted = true;
  const stages: SyncedStage[] = [];

  for (const [index, stg] of rawStages.entries()) {
    const { applicableCount, completedCount } = matrix.stageCounts[index];
    let percent = Number(stg.progressPercent || 0);
    let status = stg.status || 'pending';
    if (applicableCount > 0) {
      percent = Math.round((completedCount / applicableCount) * 100);
      status = completedCount === applicableCount ? 'completed'
        : completedCount > 0 ? 'in_progress'
        : stg.status === 'blocked' ? 'blocked' : 'pending';
    }
    if (completedCount > 0 || percent > 0) anyProgress = true;
    if (status !== 'completed') allStagesCompleted = false;

    const completedAt = status === 'completed' ? (stg.completedAt || bizNow) : null;
    if (stg.progressPercent !== percent || stg.status !== status) {
      await tx.update(projectStages).set({ progressPercent: percent, status, completedAt }).where(eq(projectStages.id, stg.id));
    }
    stages.push({ ...stg, progressPercent: percent, status, completedAt, completedSkusCount: completedCount, applicableSkusCount: applicableCount });
  }

  const nextStatus = matrixProjectStatus(project.status, {
    allDone: matrix.allProductsDone || allStagesCompleted,
    anyProgress: anyProgress || matrix.weightedProgress > 0,
  });
  let current = project;
  if (nextStatus !== project.status) {
    [current] = await tx.update(productionProjects).set({ status: nextStatus }).where(eq(productionProjects.id, project.id)).returning();
    const before = projectStatusLabel(project.status);
    const after = projectStatusLabel(nextStatus);
    await logActivity({
      tx,
      req: actor.req,
      userId: actor.userId,
      username: actor.username,
      userFullName: actor.userFullName,
      action: 'UPDATE',
      entity: PROJECT_AUDIT_ENTITY,
      entityId: String(project.id),
      description: `وضعیت پروژه تولید ${project.projectCode} با ماتریس پیشرفت از «${before}» به «${after}» تغییر کرد`,
      details: {
        before: { status: before },
        after: { status: after },
        changes: { status: { before, after } },
        completedMatrixCells: matrix.completedCells,
        totalMatrixCells: matrix.totalCells,
      },
    });
  }

  return { project: current, stages, weightedProgress: matrix.weightedProgress };
}
