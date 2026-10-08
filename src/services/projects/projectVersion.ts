import { ConflictError } from '../../errors/customErrors.js';
import { PROJECT_VERSION_CONFLICT_MESSAGE } from '../../lib/projects/projectVersion.js';

/** v9.0.343 (TD-742، تصمیم ت۳ الف): ۴۰۹ `OCC_CONFLICT` ویرایش پروژه از نسخه کهنه */
export const projectVersionConflict = (projectId: number, expectedVersion: number, currentVersion?: number | null): ConflictError =>
  new ConflictError(PROJECT_VERSION_CONFLICT_MESSAGE, { projectId, expectedVersion, currentVersion: currentVersion ?? null }, 'OCC_CONFLICT');

/** نسخه‌ای که ویرایش از آن ساخته شده باید نسخه ردیف قفل‌شده باشد */
export function assertProjectVersion(project: { id: number; version: number | null }, expectedVersion: number): void {
  const currentVersion = project.version ?? 1;
  if (currentVersion !== expectedVersion) throw projectVersionConflict(project.id, expectedVersion, currentVersion);
}
