import { orm } from '../../db/drizzle';
import { 
  workflowInstances, 
  workflowStates, 
  workflowHistoryLogs,
  workflowTaskReopenLog
} from '../../db/schema';
import { desc } from 'drizzle-orm';
import { isUsableSnapshot } from './workflowSnapshot.js';
import type { WorkflowSnapshotDsl } from './workflowTransitionExecutor.js';

type StateRow = typeof workflowStates.$inferSelect;
interface ResolvedState { rowId: number; title: string; color: string; slaHours: number }

/**
 * v9.0.49 (TD-457، B14-15): گام هر فرایند از تصویر نسخه خودش خوانده می‌شود (عنوان و مهلت)، و در گزارش گام‌ها زیر گامِ
 * جاری با همان کلید در همان تعریف شمرده می‌شود؛ ذخیره طرح گام‌ها را با شناسه تازه می‌سازد و پیش‌تر فرایند در جریان
 * «نامشخص، مهلت ۲۴» می‌شد و از شمار فعال گامش بیرون می‌افتاد. گامی که از طرح حذف شده ردیف خودش را می‌گیرد.
 */
function createStateResolver(states: StateRow[]) {
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
   * SLA Analytics & Process Bottleneck Analysis
   */
  static async getSlaAnalytics() {
    const allInstances = await orm.select().from(workflowInstances);
    const activeInstances = allInstances.filter(i => i.status === 'IN_PROGRESS');
    const completedInstances = allInstances.filter(i => i.status === 'COMPLETED');
    const instanceById = new Map(allInstances.map(i => [i.id, i]));

    const states = await orm.select().from(workflowStates);
    const resolve = createStateResolver(states);
    const historyLogs = await orm.select().from(workflowHistoryLogs).orderBy(workflowHistoryLogs.createdAt);

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
      const state = resolve(inst.workflowDefinitionId, inst.snapshotDsl, inst.currentStateId);
      const slaHours = state?.slaHours ?? 24;
      const lastUpdate = inst.updatedAt ? new Date(inst.updatedAt).getTime() : new Date(inst.createdAt || '').getTime();
      const hoursInState = Math.round(((now - lastUpdate) / (1000 * 60 * 60)) * 10) / 10;
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

    // Calculate historical durations from logs
    const instanceLogsMap: Record<number, (typeof workflowHistoryLogs.$inferSelect)[]> = {};
    for (const log of historyLogs) {
      if (!instanceLogsMap[log.instanceId]) instanceLogsMap[log.instanceId] = [];
      instanceLogsMap[log.instanceId].push(log);
    }

    for (const instId in instanceLogsMap) {
      const logs = instanceLogsMap[instId];
      const inst = instanceById.get(Number(instId));
      for (let i = 0; i < logs.length - 1; i++) {
        const currentLog = logs[i];
        const nextLog = logs[i + 1];
        const state = inst ? resolve(inst.workflowDefinitionId, inst.snapshotDsl, currentLog.toStateId) : undefined;
        if (state) {
          if (!stateStatsMap[state.rowId]) addStateRow(state.rowId, state.title, state.color, state.slaHours);
          const t1 = new Date(currentLog.createdAt || '').getTime();
          const t2 = new Date(nextLog.createdAt || '').getTime();
          const durationHours = (t2 - t1) / (1000 * 60 * 60);

          stateStatsMap[state.rowId].totalCompletedTransitions++;
          stateStatsMap[state.rowId].totalDurationHours += durationHours;
          totalTransitionsChecked++;

          if (durationHours > state.slaHours) {
            totalSlaViolations++;
          }
        }
      }
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
        totalInstances: allInstances.length,
        activeInstances: activeInstances.length,
        completedInstances: completedInstances.length,
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
