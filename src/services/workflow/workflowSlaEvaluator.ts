import { orm } from '../../db/drizzle';
import { 
  workflowInstances, 
  workflowStates, 
  workflowHistoryLogs 
} from '../../db/schema';

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

export class WorkflowSlaEvaluator {
  /**
   * SLA Analytics & Process Bottleneck Analysis
   */
  static async getSlaAnalytics() {
    const allInstances = await orm.select().from(workflowInstances);
    const activeInstances = allInstances.filter(i => i.status === 'IN_PROGRESS');
    const completedInstances = allInstances.filter(i => i.status === 'COMPLETED');

    const states = await orm.select().from(workflowStates);
    const stateById = new Map(states.map(s => [s.id, s]));
    const historyLogs = await orm.select().from(workflowHistoryLogs).orderBy(workflowHistoryLogs.createdAt);

    const now = new Date().getTime();

    // 1. Analyze Overdue / Stuck Instances
    const overdueInstances: OverdueInstance[] = [];
    let totalSlaViolations = 0;
    let totalTransitionsChecked = 0;

    for (const inst of activeInstances) {
      const state = stateById.get(inst.currentStateId);
      const slaHours = state?.slaHours || 24;
      const lastUpdate = inst.updatedAt ? new Date(inst.updatedAt).getTime() : new Date(inst.createdAt || '').getTime();
      const hoursInState = Math.round(((now - lastUpdate) / (1000 * 60 * 60)) * 10) / 10;

      if (hoursInState > slaHours) {
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

    for (const s of states) {
      stateStatsMap[s.id] = {
        stateId: s.id,
        stateTitle: s.title,
        color: s.color || 'gray',
        slaHours: s.slaHours || 24,
        activeCount: 0,
        overdueCount: 0,
        totalCompletedTransitions: 0,
        totalDurationHours: 0,
        avgDurationHours: 0
      };
    }

    // Populate active and overdue counts
    for (const inst of activeInstances) {
      if (stateStatsMap[inst.currentStateId]) {
        stateStatsMap[inst.currentStateId].activeCount++;
        const state = stateById.get(inst.currentStateId);
        const slaHours = state?.slaHours || 24;
        const lastUpdate = inst.updatedAt ? new Date(inst.updatedAt).getTime() : new Date(inst.createdAt || '').getTime();
        const hoursInState = (now - lastUpdate) / (1000 * 60 * 60);
        if (hoursInState > slaHours) {
          stateStatsMap[inst.currentStateId].overdueCount++;
        }
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
      for (let i = 0; i < logs.length - 1; i++) {
        const currentLog = logs[i];
        const nextLog = logs[i + 1];
        if (currentLog.toStateId && stateStatsMap[currentLog.toStateId]) {
          const t1 = new Date(currentLog.createdAt || '').getTime();
          const t2 = new Date(nextLog.createdAt || '').getTime();
          const durationHours = (t2 - t1) / (1000 * 60 * 60);
          
          stateStatsMap[currentLog.toStateId].totalCompletedTransitions++;
          stateStatsMap[currentLog.toStateId].totalDurationHours += durationHours;
          totalTransitionsChecked++;

          if (durationHours > stateStatsMap[currentLog.toStateId].slaHours) {
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
      stateSlaReport
    };
  }

  static async evaluateSlaStatus(instanceId: number) {
    const analytics = await this.getSlaAnalytics();
    const match = analytics.overdueInstances.find(i => i.instanceId === instanceId);
    return match || null;
  }

  static async getBottleneckAnalytics() {
    const analytics = await this.getSlaAnalytics();
    return analytics.stateSlaReport.filter(s => s.isBottleneck);
  }

  static async getSlaComplianceStats() {
    const analytics = await this.getSlaAnalytics();
    return {
      slaComplianceRate: analytics.kpi.slaComplianceRate,
      overdueInstancesCount: analytics.kpi.overdueInstancesCount
    };
  }

  static async getWorkflowAnalytics() {
    return this.getSlaAnalytics();
  }
}
