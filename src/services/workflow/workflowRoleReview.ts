import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.111 (TD-542، مدل مجوز §۴.۴ بند ۳): اقدام‌های گردش کاری که مهاجرت 0065 برای تصمیم مدیر فهرست کرد: نقش اقدام
 * تعریف نشده است (فقط مدیر سیستم امضا می‌کند) یا نقش‌های دیگری پیش‌تر فقط با هم‌ارزی نقش، مجوز ثبت بخش یا `*` آن را
 * امضا می‌کردند. ردیف تا وقتی فهرست می‌شود که اقدام طرح جاری هنوز همان نقش را دارد (ذخیره طرح شناسه اقدام‌ها را عوض
 * می‌کند) یا فرایند هنوز پایان نیافته است.
 */
export const WORKFLOW_ROLE_REVIEW_SOURCE = 'td542_workflow_role_review';

export interface WorkflowRoleReviewRow {
  logId: number;
  scope: 'definition' | 'instance';
  definitionId: number;
  definitionTitle: string;
  instanceId: number | null;
  transitionId: number;
  transitionTitle: string;
  requiredRole: string;
  roleExists: boolean;
  lostRoles: Array<{ id: number; code: string; name: string }>;
}

interface ReviewDetails {
  scope?: string;
  definitionId?: number;
  definitionTitle?: string | null;
  definitionCode?: string;
  instanceId?: number | null;
  transitionId?: number;
  transitionTitle?: string;
  requiredRole?: string;
  roleExists?: boolean;
  lostRoles?: Array<{ id: number; code: string; name: string }>;
}

export async function findWorkflowRoleReviews(db: DbExecutor = orm): Promise<WorkflowRoleReviewRow[]> {
  const result = await db.execute(sql`
    SELECT l.id, l.details
    FROM activity_logs l
    WHERE l.details ->> 'source' = ${WORKFLOW_ROLE_REVIEW_SOURCE}
      AND (
        (l.details ->> 'scope' = 'definition' AND EXISTS (
          SELECT 1 FROM workflow_transitions t
          WHERE t.id = (l.details ->> 'transitionId')::int
            AND lower(btrim(coalesce(t.required_role, ''))) = lower(l.details ->> 'requiredRole')))
        OR (l.details ->> 'scope' = 'instance' AND EXISTS (
          SELECT 1 FROM workflow_instances i
          WHERE i.id = (l.details ->> 'instanceId')::int AND i.status IN ('IN_PROGRESS', 'REJECTED')))
      )
    ORDER BY l.id`);
  const rows = (Array.isArray(result.rows) ? result.rows : []) as Array<{ id: number; details: ReviewDetails }>;
  return rows.map(({ id, details: d }) => ({
    logId: Number(id),
    scope: d.scope === 'instance' ? 'instance' : 'definition',
    definitionId: Number(d.definitionId),
    definitionTitle: d.definitionTitle || d.definitionCode || '',
    instanceId: d.instanceId == null ? null : Number(d.instanceId),
    transitionId: Number(d.transitionId),
    transitionTitle: d.transitionTitle || '',
    requiredRole: d.requiredRole || '',
    roleExists: d.roleExists === true,
    lostRoles: Array.isArray(d.lostRoles) ? d.lostRoles : [],
  }));
}

const persianDigits = (n: number): string => n.toLocaleString('fa-IR', { useGrouping: false });

export function buildWorkflowRoleReviewHealthTest(rows: WorkflowRoleReviewRow[]): HealthCheckTestResult {
  return {
    id: 'workflow_role_review',
    category: 'system',
    title: 'گام‌های گردش کار برای بازبینی نقش',
    description: 'گام نقش‌دار گردش کار فقط برای همان نقش (و مدیر سیستم) است؛ گام‌هایی که نقششان تعریف نشده یا نقش دیگری پیش‌تر فقط با هم‌ارزی نقش‌ها آن را امضا می‌کرد این‌جا فهرست می‌شوند تا مدیر تصمیم بگیرد',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${persianDigits(rows.length)} گام گردش کار بازبینی نقش می‌خواهد؛ در طراح گردش کار برای هر گام نقش درست یا مجوز تعیین کنید.`
      : 'هیچ گام گردش کاری بازبینی نقش نمی‌خواهد.',
    items: rows.map(r => ({
      id: r.logId,
      code: r.requiredRole,
      title: r.definitionTitle,
      subtitle: r.scope === 'instance'
        ? `اقدام «${r.transitionTitle}» در فرایند در جریان شماره ${persianDigits(r.instanceId ?? 0)}`
        : `اقدام «${r.transitionTitle}»`,
      details: r.roleExists
        ? `نقش‌هایی که دیگر این گام را امضا نمی‌کنند: ${r.lostRoles.map(x => x.name || x.code).join('، ')}`
        : 'نقش این گام تعریف نشده است و فقط مدیر سیستم آن را امضا می‌کند.',
    })),
    metrics: { reviews: rows.length, missingRoles: rows.filter(r => !r.roleExists).length },
  };
}
