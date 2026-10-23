import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { ProductionProject, ProjectStageSchedulesMap, TaskAssignmentItem } from '../../../types';
import { fetchJson } from '../../../api';
import { errorMessageOf, getTodayIsoDate, toPersianDigits } from '../../../utils';
import { QUERY_KEYS } from '../../../lib/queryKeys';
import { isIdempotentReplay } from '../../../lib/idempotentReplay';
import {
  isScheduleRowLogged, scheduleLogIdOf, scheduleLogItem, withScheduleLogLink, withScheduleRowIds,
  type ScheduleLogItem, type ScheduleRowRef,
} from '../../../lib/projects/scheduleWorkLog';
import type { useProjectVersion } from '../../../hooks/useProjectVersion';
import type { SchedulePlan } from './useSchedulePlan';

const loggable = (t: TaskAssignmentItem) => Boolean(t.assignedPersonnelId && t.taskId && Number(t.quantity) > 0 && !isScheduleRowLogged(t));

/**
 * «ثبت کارمزد» of one plan row and of a whole stage. v9.0.282 (TD-736، تصمیم ت۵ الف): پیش از ثبت کارکرد، برنامه (با شناسه
 * هر ردیف) ذخیره می‌شود تا سرور ردیف را بسنجد و شناسه کارکرد را در همان ردیف بنویسد؛ ردیف ثبت‌شده دوباره ثبت نمی‌شود (۴۰۹)
 * و وضعیت دکمه از همان شناسه خوانده می‌شود. 10.3 (ARCH review finding 3): a work log refreshes every piecework read (this
 * tab's logs, the payroll page) through the cache.
 */
export function useScheduleLogging({ project, plan, projectVersion, onUpdate }: {
  project: ProductionProject;
  plan: SchedulePlan;
  projectVersion: ReturnType<typeof useProjectVersion>;
  onUpdate: () => void;
}) {
  const queryClient = useQueryClient();
  const [loggingTaskId, setLoggingTaskId] = useState<string | null>(null);
  const [batchLoggingStageId, setBatchLoggingStageId] = useState<number | null>(null);
  // v9.0.283 (TD-747، تصمیم ت۶ الف بسته ۱۱): روز کارکرد «ثبت کارمزد»، پیش‌فرض امروز در منطقه زمانی نمایش؛ نه تاریخ شروع کار یا پروژه
  const [logDate, setLogDate] = useState<string>(() => getTodayIsoDate());
  const { schedulesMap, setSchedulesMap, setSavedSchedulesMap } = plan;

  const saveSchedulesForLogging = async (): Promise<ProjectStageSchedulesMap | null> => {
    const withIds = withScheduleRowIds(schedulesMap, () => `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    setSchedulesMap(withIds);
    const res = await fetchJson<{ id?: number; version?: number }>(`/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_schedules: withIds, ...projectVersion.writeBase }),
    });
    if (!res?.id) {
      toast.error('برنامه کارگاه پیش از ثبت کارکرد ذخیره نشد.');
      return null;
    }
    projectVersion.remember(res, ['schedule']);
    setSavedSchedulesMap(withIds);
    return withIds;
  };

  /** The log id of each item, in order (undefined where none is known) */
  const postScheduleLogs = async (items: ScheduleLogItem[]): Promise<Array<number | undefined>> => {
    const res = await fetchJson<unknown>('/piecework/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      acceptReplay: true,
    });
    // v9.0.385 (TD-742): ثبت کارکرد شناسه آن را در ردیف برنامه می‌نویسد و نسخه پروژه را بالا می‌برد؛ ذخیره بعدی با نسخه تازه می‌رود
    // TD-1342 (review N2): only the version is taken; this read may hold other users' changes the tab does not show
    const saved = await fetchJson<{ stage_schedules?: unknown } | null>(`/projects/${project.id}`).catch(() => null);
    projectVersion.remember(saved, []);
    // v10.2.34 (#351 review L1): a repeat of a request that already ran gets no ids; the server wrote them into the saved plan
    if (isIdempotentReplay(res)) return items.map(item => scheduleLogIdOf(saved?.stage_schedules, item.scheduleRef));
    const ids = (res as { insertedIds?: unknown } | null)?.insertedIds;
    return Array.isArray(ids) ? ids : [];
  };

  const markRowsLogged = (links: Array<{ ref: ScheduleRowRef; logId: number }>) => {
    setSchedulesMap(prev => links.reduce((map, l) => withScheduleLogLink(map, l.ref, l.logId), prev));
    // the server wrote the log ids into the saved plan itself
    setSavedSchedulesMap(prev => links.reduce((map, l) => withScheduleLogLink(map, l.ref, l.logId), prev));
  };

  const refreshWorkLogs = () => { void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.piecework.all }); };

  const handleLogSingleTaskToPiecework = async (stageId: number, productId: string, taskIdx: number, task: TaskAssignmentItem) => {
    if (!task.assignedPersonnelId) {
      toast.error('لطفاً ابتدا پرسنل مجری را برای این وظیفه تعیین کنید.');
      return;
    }
    if (!task.taskId) {
      toast.error('لطفاً یک عنوان کارمزدی معتبر از لیست انتخاب کنید.');
      return;
    }
    if (!task.quantity || task.quantity <= 0) {
      toast.error('تعداد کارکرد باید بزرگتر از صفر باشد.');
      return;
    }
    setLoggingTaskId(task.id || `${stageId}-${productId}-${taskIdx}`);
    let saved: ProjectStageSchedulesMap | null = null;
    try {
      saved = await saveSchedulesForLogging();
      const row = (saved?.[stageId]?.[productId] as { tasks?: TaskAssignmentItem[] } | undefined)?.tasks?.[taskIdx];
      if (!row?.id) return;
      const ref: ScheduleRowRef = { stageId, productId, rowId: row.id };
      // v9.0.281 (TD-735): بی نرخ؛ سرور نرخ اختصاصی پرسنل یا نرخ پایه عنوان کار را می‌گذارد
      const [logId] = await postScheduleLogs([scheduleLogItem({
        projectId: project.id,
        ref,
        row,
        date: logDate || getTodayIsoDate(),
        notes: `کارکرد پروژه ${project.project_code || project.title} - ${row.taskTitle}`,
      })]);
      toast.success(`کارکرد «${row.taskTitle}» برای ${row.assignedPersonnelName || 'پرسنل'} در ماژول کارمزدی ثبت شد.`);
      if (logId) markRowsLogged([{ ref, logId }]);
      refreshWorkLogs();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت کارکرد کارمزدی');
    } finally {
      setLoggingTaskId(null);
      // برنامه ذخیره‌نشده با بارگذاری دوباره از دست نمی‌رود
      if (saved) onUpdate();
    }
  };

  const handleBatchLogStageTasks = async (stageId: number, stageTitle: string) => {
    const stagePlans = Object.values((schedulesMap[stageId] ?? {}) as Record<string, { tasks?: TaskAssignmentItem[] }>);
    if (!stagePlans.some(sched => (sched?.tasks || []).some(loggable))) {
      toast.error('هیچ وظیفه ثبت‌نشده‌ای با پرسنل و عنوان کارمزدی معتبر در این مرحله یافت نشد.');
      return;
    }
    setBatchLoggingStageId(stageId);
    let saved: ProjectStageSchedulesMap | null = null;
    try {
      saved = await saveSchedulesForLogging();
      if (!saved) return;
      const refs: ScheduleRowRef[] = [];
      const itemsToLog: ScheduleLogItem[] = [];
      for (const [prodId, sched] of Object.entries((saved[stageId] ?? {}) as Record<string, { tasks?: TaskAssignmentItem[] }>)) {
        for (const t of sched?.tasks || []) {
          if (!t.id || !loggable(t)) continue;
          const ref: ScheduleRowRef = { stageId, productId: prodId, rowId: t.id };
          refs.push(ref);
          itemsToLog.push(scheduleLogItem({
            projectId: project.id,
            ref,
            row: t,
            date: logDate || getTodayIsoDate(),
            notes: `کارکرد مرحله «${stageTitle}» پروژه ${project.project_code || project.title} - ${t.taskTitle}`,
          }));
        }
      }
      const ids = await postScheduleLogs(itemsToLog);
      toast.success(`تعداد ${toPersianDigits(itemsToLog.length)} رکورد کارکرد برای مرحله «${stageTitle}» با موفقیت ثبت شد.`);
      markRowsLogged(refs.flatMap((ref, i) => { const logId = ids[i]; return logId ? [{ ref, logId }] : []; }));
      refreshWorkLogs();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت گروهی کارکردها');
    } finally {
      setBatchLoggingStageId(null);
      if (saved) onUpdate();
    }
  };

  return { loggingTaskId, batchLoggingStageId, logDate, setLogDate, handleLogSingleTaskToPiecework, handleBatchLogStageTasks };
}

export type ScheduleLogging = ReturnType<typeof useScheduleLogging>;
