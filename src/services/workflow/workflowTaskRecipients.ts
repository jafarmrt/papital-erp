import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { roles as rolesTable, users, workflowTasks, workflowTransitions } from '../../db/schema.js';
import { WorkflowDelegationService } from './workflowDelegationService.js';
import { snapshotTransitionsOf } from './workflowSnapshot.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';

/**
 * کسانی که یک کار گردش کار را در کارتابل خود می‌بینند و پیامش به آن‌ها می‌رسد: کاربر تعیین‌شده و کاربران نامزد، وگرنه
 * کاربران نقش کار (نقش «همه» یعنی مدیر سیستم و دارندگان workflow.approve / execute)، هر کدام فقط با مجوز لازم انتقال، به‌علاوه
 * جانشین فعالِ هم‌حوزه آن‌ها. یادآوری مهلت (v7.0.101) و اعلان رسیدن کار (v10.1.42، طرح پیام‌رسان بخش ۳) هر دو همین را می‌خوانند.
 */
const ALL_ROLES = new Set(['all', '*']);
/** v9.0.44 (TD-460، ت۱۰ الف): گیرندگان کار گام بی‌نقش */
const ROLELESS_TASK_PERMISSIONS = ['workflow.approve', 'workflow.execute'];

export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;

const positiveIds = (values: unknown): number[] =>
  (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > 0);

/**
 * v9.0.128 (TD-542): مجوز لازم انتقال کار، از تصویر نسخه فرایند یا جدول جاری؛ همان مجوزی که کارتابل از عضو نقش یا گام
 * بی‌نقش می‌خواهد. پس از تبدیل گام نقش‌دار به گام «فقط مجوز» پیام به دارنده همان مجوز می‌رسد، نه به هر تأییدکننده.
 */
async function transitionPermissionOf(tx: DbExecutor, task: WorkflowTaskRow, snapshotDsl: unknown): Promise<string> {
  if (!task.transitionId) return '';
  const fromSnapshot = snapshotTransitionsOf(snapshotDsl)?.find((t) => t.id === task.transitionId);
  if (fromSnapshot) return (fromSnapshot.requiredPermission || '').trim();
  const [live] = await tx.select({ requiredPermission: workflowTransitions.requiredPermission }).from(workflowTransitions)
    .where(eq(workflowTransitions.id, task.transitionId));
  return (live?.requiredPermission || '').trim();
}

/** کاربران فعالی که این کار به آن‌ها سپرده شده یا در نقششان است، با جانشین فعال هم‌حوزه */
export async function workflowTaskRecipients(tx: DbExecutor, task: WorkflowTaskRow, workflowCode: string, snapshotDsl: unknown, now: Date): Promise<number[]> {
  const requiredPermission = await transitionPermissionOf(tx, task, snapshotDsl);
  const assigned = [...new Set([...positiveIds([task.assignedUserId]), ...positiveIds(task.candidateUsers)])];
  let owners: number[];
  if (assigned.length > 0) {
    const active = await tx.select({ id: users.id }).from(users)
      .where(and(inArray(users.id, assigned), eq(users.isDeleted, 0)));
    owners = active.map((u) => u.id);
  } else {
    const candidateRoles = (Array.isArray(task.candidateRoles) ? task.candidateRoles : [])
      .map((r) => String(r).trim().toLowerCase()).filter(Boolean);
    const roles = candidateRoles.length > 0 ? candidateRoles : [String(task.assignedRole || '').trim().toLowerCase()].filter(Boolean);
    if (roles.length === 0) return [];
    // v9.0.44 (TD-460، ت۱۰ الف): گام بی‌نقش («همه») فقط به مدیر سیستم و دارندگان مجوز تأیید یا اجرای گردش کار (از
    // مجوزهای نقش) می‌رسد؛ پیش‌تر به همه کاربران فعال، حتی بی هیچ مجوز گردش کار، با شماره سند می‌رفت
    const isSystemAdmin = sql`lower(${users.role}) = ${SYSTEM_ADMIN_ROLE}`;
    const holdsPermission = requiredPermission
      ? sql`(${isSystemAdmin} OR coalesce(${rolesTable.permissions}, '[]'::jsonb) ? ${requiredPermission})`
      : sql`true`;
    const byRole = roles.some((r) => ALL_ROLES.has(r))
      ? await tx.select({ id: users.id }).from(users)
        .leftJoin(rolesTable, sql`lower(${rolesTable.code}) = lower(${users.role})`)
        .where(and(eq(users.isDeleted, 0), holdsPermission, sql`(${isSystemAdmin} OR coalesce(${rolesTable.permissions}, '[]'::jsonb) ?| array[${sql.join(ROLELESS_TASK_PERMISSIONS.map(p => sql`${p}`), sql`, `)}]::text[])`))
      : await tx.select({ id: users.id }).from(users)
        .leftJoin(rolesTable, sql`lower(${rolesTable.code}) = lower(${users.role})`)
        .where(and(eq(users.isDeleted, 0), holdsPermission, inArray(sql`lower(${users.role})`, roles)));
    owners = byRole.map((u) => u.id);
  }
  // v8.0.97 (TD-377): جانشین فعالِ هم‌حوزه مسئولان کار (کاربر تعیین‌شده، نامزد یا عضو نقش) هم پیام می‌گیرد
  const delegates = await WorkflowDelegationService.activeDelegations(tx, { fromUserIds: owners }, now);
  const deputies = delegates.filter((d) => WorkflowDelegationService.delegationCovers(d.scope, workflowCode)).map((d) => d.toUserId);
  return [...new Set([...owners, ...deputies])];
}
