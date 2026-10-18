import type { DbExecutor } from '../../db/drizzle.js';
import type { AuditActor } from './pieceworkAudit.js';

/**
 * 10.2 package 12, item 3 (D6, owner decision ت۴۲ الف): a project's progress counts the done work of its workshop
 * schedule rows, so a work log linked to a schedule row (written, deleted, moved to another project or given another
 * quantity) syncs the stage percents and the project status in the log's own transaction, after the project row lock.
 * The piecework package does not import the projects package (package boundary, phase-2 decision ت۳ الف); the composition
 * root (`registerWorkflowDomainActions`) registers the projects sync (`syncProjectsAfterScheduleWork`).
 */
export type ScheduleProgressSync = (tx: DbExecutor, projectIds: readonly number[], actor: AuditActor) => Promise<void>;

let sync: ScheduleProgressSync | null = null;

export function registerScheduleProgressSync(next: ScheduleProgressSync): void {
  sync = next;
}

/** Syncs each project once, in id order (the order the schedule links lock them). */
export async function syncScheduleProgress(tx: DbExecutor, projectIds: ReadonlyArray<number | null>, actor: AuditActor = {}): Promise<void> {
  const ids = [...new Set(projectIds)].filter((id): id is number => id !== null && Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (!sync || ids.length === 0) return;
  await sync(tx, ids, actor);
}
