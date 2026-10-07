import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.51 (TD-461، یافته B14-19): کلیدهای خارجی میان جدول‌های گردش کار و یکتایی شماره نسخه تعریف (مهاجرت 0059).
 * مهاجرت هر کلید را NOT VALID می‌افزاید و فقط وقتی هیچ ردیف قدیمی آن را نمی‌شکند اعتبارسنجی می‌کند، و شاخص یکتای نسخه را
 * فقط روی داده بی تکرار می‌سازد؛ ردیف‌های قدیمی دست نمی‌خورند و آنچه ناتمام مانده در بررسی سلامت فهرست می‌شود.
 */
export const WORKFLOW_FOREIGN_KEYS = [
  { name: 'fk_wf_states_definition', table: 'workflow_states', column: 'workflow_definition_id', ref: 'workflow_definitions' },
  { name: 'fk_wf_transitions_definition', table: 'workflow_transitions', column: 'workflow_definition_id', ref: 'workflow_definitions' },
  { name: 'fk_wf_transitions_from_state', table: 'workflow_transitions', column: 'from_state_id', ref: 'workflow_states' },
  { name: 'fk_wf_transitions_to_state', table: 'workflow_transitions', column: 'to_state_id', ref: 'workflow_states' },
  { name: 'fk_wf_instances_definition', table: 'workflow_instances', column: 'workflow_definition_id', ref: 'workflow_definitions' },
  { name: 'fk_wf_versions_definition', table: 'workflow_definition_versions', column: 'definition_id', ref: 'workflow_definitions' },
  { name: 'fk_wf_history_instance', table: 'workflow_history_logs', column: 'instance_id', ref: 'workflow_instances' },
  { name: 'fk_wf_tasks_instance', table: 'workflow_tasks', column: 'instance_id', ref: 'workflow_instances' },
  { name: 'fk_wf_pending_instance', table: 'workflow_pending_approvals', column: 'instance_id', ref: 'workflow_instances' },
] as const;

export const WORKFLOW_VERSION_UNIQUE_INDEX = 'uq_wdv_definition_version';

export interface WorkflowForeignKeyGap {
  name: string;
  table: string;
  column: string;
  ref: string;
  state: 'missing' | 'not_valid';
  orphanRows: number;
}

export interface DuplicateDefinitionVersion {
  definitionId: number;
  version: number;
  rows: number;
}

export interface WorkflowReferenceIntegrity {
  foreignKeyGaps: WorkflowForeignKeyGap[];
  duplicateVersions: DuplicateDefinitionVersion[];
  versionIndexPresent: boolean;
}

type Row = Record<string, unknown>;
const rowsOf = (res: { rows?: unknown[] }): Row[] => (Array.isArray(res.rows) ? (res.rows as Row[]) : []);

export async function findWorkflowReferenceGaps(db: DbExecutor = orm): Promise<WorkflowReferenceIntegrity> {
  const present = new Map<string, boolean>();
  const constraints = rowsOf(await db.execute(sql`
    SELECT c.conname, c.convalidated FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid IN (${sql.join(WORKFLOW_FOREIGN_KEYS.map(fk => sql`to_regclass(${fk.table})`), sql`, `)})
  `));
  for (const r of constraints) present.set(String(r.conname), Boolean(r.convalidated));

  const foreignKeyGaps: WorkflowForeignKeyGap[] = [];
  for (const fk of WORKFLOW_FOREIGN_KEYS) {
    const validated = present.get(fk.name);
    if (validated === true) continue;
    const [orphans] = rowsOf(await db.execute(sql`
      SELECT count(*)::int AS n FROM ${sql.identifier(fk.table)} c
      WHERE c.${sql.identifier(fk.column)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${sql.identifier(fk.ref)} p WHERE p.id = c.${sql.identifier(fk.column)})
    `));
    foreignKeyGaps.push({ ...fk, state: validated === undefined ? 'missing' : 'not_valid', orphanRows: Number(orphans?.n) || 0 });
  }

  const duplicateVersions = rowsOf(await db.execute(sql`
    SELECT definition_id, version, count(*)::int AS n FROM workflow_definition_versions
    GROUP BY definition_id, version HAVING count(*) > 1 ORDER BY definition_id, version
  `)).map(r => ({ definitionId: Number(r.definition_id), version: Number(r.version), rows: Number(r.n) }));

  const [index] = rowsOf(await db.execute(sql`SELECT to_regclass(${WORKFLOW_VERSION_UNIQUE_INDEX}) IS NOT NULL AS present`));
  return { foreignKeyGaps, duplicateVersions, versionIndexPresent: Boolean(index?.present) };
}

export function buildWorkflowReferenceHealthTest(integrity: WorkflowReferenceIntegrity): HealthCheckTestResult {
  const { foreignKeyGaps, duplicateVersions, versionIndexPresent } = integrity;
  const issueCount = foreignKeyGaps.length + duplicateVersions.length + (versionIndexPresent || duplicateVersions.length > 0 ? 0 : 1);
  return {
    id: 'workflow_reference_integrity',
    category: 'system',
    title: 'پیوستگی ارجاع‌های گردش کار',
    description: 'گام، اقدام، فرایند، تاریخچه، کار و نسخه هر گردش کار به ردیف موجود اشاره می‌کنند و شماره نسخه هر تعریف یکتاست؛ پایگاه‌داده با کلید خارجی و شاخص یکتا از ارجاع آویزان جلوگیری می‌کند',
    status: issueCount > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, issueCount),
    count: issueCount,
    message: issueCount > 0
      ? `${issueCount} قید پیوستگی گردش کار در پایگاه‌داده کامل اعمال نشده است؛ ردیف‌های قدیمی خودکار تغییر نمی‌کنند. ارجاع‌های آویزان را بررسی کنید.`
      : 'همه ارجاع‌های جدول‌های گردش کار با کلید خارجی در پایگاه‌داده پشتیبانی می‌شوند و شماره نسخه هر تعریف یکتاست.',
    items: [
      ...foreignKeyGaps.map(g => ({
        id: g.name,
        code: g.name,
        title: `${g.table}.${g.column} ← ${g.ref}`,
        subtitle: g.state === 'missing' ? 'کلید خارجی ساخته نشده است' : 'کلید خارجی اعتبارسنجی نشده است',
        details: `${g.orphanRows} ردیف به ردیف ناموجود اشاره می‌کند.`,
      })),
      ...duplicateVersions.map(d => ({
        id: `${d.definitionId}:${d.version}`,
        code: `گردش کار ${d.definitionId}`,
        title: `نسخه ${d.version}`,
        subtitle: 'شماره نسخه تکراری',
        details: `${d.rows} نسخه با یک شماره.`,
      })),
    ],
    metrics: {
      foreignKeyGaps: foreignKeyGaps.length,
      orphanRows: foreignKeyGaps.reduce((sum, g) => sum + g.orphanRows, 0),
      duplicateVersions: duplicateVersions.length,
      versionIndexPresent: versionIndexPresent ? 1 : 0,
    },
  };
}
