import { orm } from '../../db/drizzle';
import { 
  workflowStates, 
  workflowHistoryLogs,
  workflowTaskReopenLog
} from '../../db/schema';
import { desc, sql } from 'drizzle-orm';
import { isUsableSnapshot } from './workflowSnapshot.js';
import type { WorkflowSnapshotDsl } from './workflowTransitionExecutor.js';

type StateRow = typeof workflowStates.$inferSelect;
type HistoryRow = typeof workflowHistoryLogs.$inferSelect;

/**
 * OBS-R2-72: a history row that moved the instance into its target step. A partial signature (`<action>_SIGN`) keeps the
 * instance in its step, so it is no entry: SLA counts from when the step was entered, never from the last signature
 * (the signature rewrites `workflow_instances.updated_at`, which the overdue check read).
 */
export function isStepEntry(row: Pick<HistoryRow, 'actionKey'>): boolean {
  return !String(row.actionKey || '').endsWith('_SIGN');
}

/** OBS-R2-72: when the instance entered its current step: its latest entry row into that step, else its start */
export function currentStepEnteredAt(
  instance: { currentStateId: number | null; createdAt: string | null },
  logs: Array<Pick<HistoryRow, 'actionKey' | 'toStateId' | 'createdAt'>>,
): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (isStepEntry(log) && log.toStateId === instance.currentStateId) return log.createdAt;
  }
  return instance.createdAt;
}

interface ResolvedState { rowId: number; title: string; color: string; slaHours: number }

/**
 * v9.0.49 (TD-457، B14-15): گام هر فرایند از تصویر نسخه خودش خوانده می‌شود (عنوان و مهلت)، و در گزارش گام‌ها زیر گامِ
 * جاری با همان کلید در همان تعریف شمرده می‌شود؛ ذخیره طرح گام‌ها را با شناسه تازه می‌سازد و پیش‌تر فرایند در جریان
 * «نامشخص، مهلت ۲۴» می‌شد و از شمار فعال گامش بیرون می‌افتاد. گامی که از طرح حذف شده ردیف خودش را می‌گیرد.
 */
export function createStateResolver(states: StateRow[]) {
  const currentById = new Map(states.map(s => [s.id, s]));
  const currentByKey = new Map(states.map(s => [`${s.workflowDefinitionId}:${s.stateKey}`, s]));
  const resolve = (definitionId: number, snapshot: unknown, stateId: number | null | undefined): ResolvedState | undefined => {
    if (!stateId) return undefined;
    const dsl = snapshot as WorkflowSnapshotDsl | null;
    const own = isUsableSnapshot(dsl) ? dsl.states?.find(s => s.id === stateId) : undefined;
    const live = currentById.get(stateId);
    const key = own?.stateKey ?? live?.stateKey;
    const row = live ?? (key !== undefined ? currentByKey.get(`${definitionId}:${key}`) : undefined);
    const source = own ?? live;
    if (!source) return undefined;
    return {
      rowId: row?.id ?? source.id,
      title: source.title,
      color: (own as { color?: string | null } | undefined)?.color ?? row?.color ?? 'gray',
      slaHours: Number(source.slaHours) || 24,
    };
  };
  return resolve;
}

/** OBS-R2-72 in SQL: a history row that entered its target step, `isStepEntry` (a partial signature ends with `_SIGN`) */
const STEP_ENTRY_SQL = sql.raw(String.raw`h.action_key NOT LIKE '%\_SIGN'`);

/**
 * OBS-R2-71 (TD-1323): each step entry with the hours until the instance's next entry, in (created_at, id) order. The hours
 * are whole milliseconds ÷ 3,600,000 in double precision, as the earlier loop computed them from the timestamps it read.
 * Each instance's snapshot is hashed once (`inst`, materialized): hashing it per joined row made the report time out.
 */
function stepDurationsCte() {
  return sql`inst AS MATERIALIZED (
      SELECT id, workflow_definition_id, md5(snapshot_dsl::text) AS key FROM workflow_instances
    ),
    entries AS (
      SELECT h.instance_id, h.to_state_id, h.created_at,
             lead(h.created_at) OVER (PARTITION BY h.instance_id ORDER BY h.created_at, h.id) AS next_at
      FROM workflow_history_logs h
      WHERE ${STEP_ENTRY_SQL}
    ),
    durations AS (
      SELECT i.workflow_definition_id AS definition_id, i.key, e.to_state_id,
             (extract(epoch FROM date_trunc('milliseconds', e.next_at) - date_trunc('milliseconds', e.created_at)) * 1000)::float8
               / 3600000.0::float8 AS hours
      FROM entries e
      JOIN inst i ON i.id = e.instance_id
      WHERE e.next_at IS NOT NULL AND e.to_state_id IS NOT NULL
    )`;
}

interface ActiveInstanceRow {
  id: number;
  definitionId: number;
  currentStateId: number | null;
  createdAt: string | null;
  entityType: string;
  entityId: string;
  startedByName: string | null;
  key: string | null;
  enteredAt: string | null;
}

interface DurationGroupRow {
  definitionId: number;
  key: string | null;
  stateId: number;
  transitions: number;
  hours: number;
}

const rowsOf = <T>(result: unknown): T[] => {
  const rows = (result as { rows?: unknown })?.rows ?? result;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

export interface OverdueInstance {
  instanceId: number;
  entityType: string;
  entityId: string;
  stateTitle: string;
  stateColor: string;
  hoursInState: number;
  slaHours: number;
  excessHours: number;
  startedByName?: string | null;
}

export interface StateSlaReportItem {
  stateId: number;
  stateTitle: string;
  stateColor: string;
  slaHours: number;
  transitionCount: number;
  avgHours: number;
  maxHours: number;
  violationsCount: number;
  violationRate: number;
  isBottleneck: boolean;
}

/** v7.0.101 (TD-085، «بازگشایی با گزارش»): کارهایی که پیش از این نسخه خودکار منقضی شده بودند و سرنوشت هرکدام */
export interface ReopenedTasksReport {
  reopenedCount: number;
  keptExpiredCount: number;
  rows: Array<{ taskId: number; instanceId: number; taskTitle: string; dueAt: string | null; action: string; reason: string }>;
}

export class WorkflowSlaEvaluator {
  static async getReopenedTasksReport(): Promise<ReopenedTasksReport> {
    const rows = await orm.select().from(workflowTaskReopenLog).orderBy(desc(workflowTaskReopenLog.id));
    return {
      reopenedCount: rows.filter(r => r.action === 'reopened').length,
      keptExpiredCount: rows.filter(r => r.action === 'kept_expired').length,
      rows: rows.map(r => ({ taskId: r.taskId, instanceId: r.instanceId, taskTitle: r.taskTitle, dueAt: r.dueAt, action: r.action, reason: r.reason })),
    };
  }

  /**
   * SLA Analytics & Process Bottleneck Analysis.
   * OBS-R2-71 (TD-1323): the report no longer loads every instance, its snapshot and every history row. PostgreSQL counts
   * the instances, reads the running ones with the entry time of their current step, keeps each distinct snapshot once and
   * sums the step durations per (definition, snapshot, step); the steps are still resolved from each instance's own
   * snapshot (`createStateResolver`), and the numbers are those of the earlier in-memory loop.
   */
  static async getSlaAnalytics() {
    const counts = rowsOf<{ total: number; active: number; completed: number }>(await orm.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS active,
             count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed
      FROM workflow_instances`))[0] ?? { total: 0, active: 0, completed: 0 };

    // each distinct snapshot once: instances of one published version share it
    const snapshots = new Map<string | null, unknown>();
    for (const row of rowsOf<{ key: string | null; snapshot: unknown }>(await orm.execute(sql`
      SELECT DISTINCT ON (md5(snapshot_dsl::text)) md5(snapshot_dsl::text) AS key, snapshot_dsl AS snapshot
      FROM workflow_instances`))) {
      snapshots.set(row.key, row.snapshot);
    }

    const states = await orm.select().from(workflowStates);
    const resolve = createStateResolver(states);
    const resolveKeyed = (definitionId: number, key: string | null, stateId: number | null) =>
      resolve(definitionId, snapshots.get(key) ?? null, stateId);

    // OBS-R2-72 / OBS-R2-69: the running instances with the latest entry row into their current step, in (created_at, id) order
    const activeInstances = rowsOf<ActiveInstanceRow>(await orm.execute(sql`
      SELECT i.id, i.workflow_definition_id AS "definitionId", i.current_state_id AS "currentStateId",
             i.created_at AS "createdAt", i.entity_type AS "entityType", i.entity_id AS "entityId",
             i.started_by_name AS "startedByName", md5(i.snapshot_dsl::text) AS key,
             (SELECT h.created_at FROM workflow_history_logs h
               WHERE h.instance_id = i.id AND h.to_state_id = i.current_state_id AND ${STEP_ENTRY_SQL}
               ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS "enteredAt"
      FROM workflow_instances i
      WHERE i.status = 'IN_PROGRESS'
      ORDER BY i.id`));

    const now = new Date().getTime();

    // 1. Analyze Overdue / Stuck Instances
    const overdueInstances: OverdueInstance[] = [];
    let totalSlaViolations = 0;
    let totalTransitionsChecked = 0;

    // 2. Bottlenecks per State
    const stateStatsMap: Record<number, {
      stateId: number;
      stateTitle: string;
      color: string;
      slaHours: number;
      activeCount: number;
      overdueCount: number;
      totalCompletedTransitions: number;
      totalDurationHours: number;
      avgDurationHours: number;
    }> = {};
    const addStateRow = (id: number, title: string, color: string, slaHours: number) => {
      stateStatsMap[id] = {
        stateId: id, stateTitle: title, color, slaHours,
        activeCount: 0, overdueCount: 0, totalCompletedTransitions: 0, totalDurationHours: 0, avgDurationHours: 0
      };
    };
    for (const s of states) addStateRow(s.id, s.title, s.color || 'gray', s.slaHours || 24);

    for (const inst of activeInstances) {
      const state = resolveKeyed(inst.definitionId, inst.key, inst.currentStateId);
      const slaHours = state?.slaHours ?? 24;
      // OBS-R2-72: from the step's entry, not `updated_at` (a partial signature rewrote it and restarted the count)
      const enteredAt = inst.enteredAt ?? inst.createdAt;
      const hoursInState = Math.round(((now - new Date(enteredAt || '').getTime()) / (1000 * 60 * 60)) * 10) / 10;
      const isOverdue = hoursInState > slaHours;

      if (state) {
        if (!stateStatsMap[state.rowId]) addStateRow(state.rowId, state.title, state.color, state.slaHours);
        stateStatsMap[state.rowId].activeCount++;
        if (isOverdue) stateStatsMap[state.rowId].overdueCount++;
      }

      if (isOverdue) {
        totalSlaViolations++;
        overdueInstances.push({
          instanceId: inst.id,
          entityType: inst.entityType,
          entityId: inst.entityId,
          stateTitle: state?.title || 'نامشخص',
          stateColor: state?.color || 'gray',
          hoursInState,
          slaHours,
          excessHours: Math.round((hoursInState - slaHours) * 10) / 10,
          startedByName: inst.startedByName
        });
      }
    }

    // Historical durations: from one step entry to the next (OBS-R2-72: a signature is no entry), summed per
    // (definition, snapshot, step) in SQL; the violations of each group are counted against its resolved SLA
    const groups = rowsOf<DurationGroupRow>(await orm.execute(sql`
      WITH ${stepDurationsCte()}
      SELECT d.definition_id AS "definitionId", d.key, d.to_state_id AS "stateId",
             count(*)::int AS transitions, COALESCE(sum(d.hours), 0)::float8 AS hours
      FROM durations d
      GROUP BY d.definition_id, d.key, d.to_state_id`));
    const thresholds: Array<{ definitionId: number; key: string | null; stateId: number; sla: number }> = [];
    for (const group of groups) {
      const state = resolveKeyed(group.definitionId, group.key, group.stateId);
      if (!state) continue;
      if (!stateStatsMap[state.rowId]) addStateRow(state.rowId, state.title, state.color, state.slaHours);
      stateStatsMap[state.rowId].totalCompletedTransitions += group.transitions;
      stateStatsMap[state.rowId].totalDurationHours += Number(group.hours);
      totalTransitionsChecked += group.transitions;
      thresholds.push({ definitionId: group.definitionId, key: group.key, stateId: group.stateId, sla: state.slaHours });
    }
    if (thresholds.length > 0) {
      // a plain equality on the key (an md5 is never empty; a NULL snapshot is ''), so the thresholds join by hash
      const [row] = rowsOf<{ violations: number }>(await orm.execute(sql`
        WITH ${stepDurationsCte()}
        SELECT count(*)::int AS violations
        FROM durations d
        JOIN jsonb_to_recordset(${JSON.stringify(thresholds)}::jsonb)
          AS t("definitionId" int, key text, "stateId" int, sla float8)
          ON t."definitionId" = d.definition_id AND COALESCE(t.key, '') = COALESCE(d.key, '') AND t."stateId" = d.to_state_id
        WHERE d.hours > t.sla`));
      totalSlaViolations += Number(row?.violations ?? 0);
    }

    // Compute averages
    const stateSlaReport = Object.values(stateStatsMap).map(st => {
      const avg = st.totalCompletedTransitions > 0 
        ? Math.round((st.totalDurationHours / st.totalCompletedTransitions) * 10) / 10 
        : 0;
      return {
        ...st,
        avgDurationHours: avg,
        isBottleneck: avg > st.slaHours || st.overdueCount > 0
      };
    });

    const slaComplianceRate = totalTransitionsChecked > 0 
      ? Math.round(((totalTransitionsChecked - totalSlaViolations) / totalTransitionsChecked) * 100) 
      : 100;

    // Find top bottleneck state
    const bottleneck = [...stateSlaReport].sort((a, b) => (b.overdueCount + b.avgDurationHours) - (a.overdueCount + a.avgDurationHours))[0] || null;

    return {
      kpi: {
        totalInstances: Number(counts.total),
        activeInstances: activeInstances.length,
        completedInstances: Number(counts.completed),
        overdueInstancesCount: overdueInstances.length,
        slaComplianceRate: Math.max(0, slaComplianceRate),
        bottleneckState: bottleneck ? bottleneck.stateTitle : 'بدون گلوگاه'
      },
      overdueInstances,
      stateSlaReport,
      reopenedTasks: await this.getReopenedTasksReport()
    };
  }

  static async evaluateSlaStatus(instanceId: number) {
    const analytics = await this.getSlaAnalytics();
    const match = analytics.overdueInstances.find(i => i.instanceId === instanceId);
    return match || null;
  }

  static async getWorkflowAnalytics() {
    return this.getSlaAnalytics();
  }
}
