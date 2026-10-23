import { useEffect, useEffectEvent, useMemo } from 'react';
import toast from 'react-hot-toast';
import { DEFAULT_WORKFLOW_PRESETS, type WorkflowPreset } from '../../../constants/presets';
import type { Personnel, PieceworkTask } from '../../../types';
import { errorMessageOf } from '../../../utils';
import { useSettingsQuery, type SettingItem } from '../../../hooks/queries/useSettingsQueries';
import { usePersonnelListQuery } from '../../../hooks/queries/usePersonnelQueries';
import { usePieceworkTasksQuery } from '../../../hooks/queries/usePieceworkQueries';
import { useProjectWorkLogsQuery, type ProjectWorkLog } from '../../../hooks/queries/useProjectWorkspaceQueries';
import { useOpeningRead } from '../../../hooks/queries/readOnEveryOpening';

/** a personnel row as the workshop tab reads it; older answers named some fields in snake case */
export type SchedulePerson = Personnel & {
  first_name?: string;
  last_name?: string;
  name?: string;
  job_title?: string;
  role?: string;
  personnel_code?: string;
};

export function personNameOf(person: SchedulePerson): string {
  return person.fullName
    || `${person.firstName || person.first_name || ''} ${person.lastName || person.last_name || ''}`.trim()
    || person.name
    || '';
}

/** the workflow presets saved in the settings; the default ones when none is saved or the saved value is unreadable */
function workflowPresetsOf(settings: readonly SettingItem[] | undefined): { presets: WorkflowPreset[]; unreadable: boolean } {
  const value = settings?.find(s => s.key === 'project_workflow_presets')?.value;
  if (!value) return { presets: DEFAULT_WORKFLOW_PRESETS, unreadable: false };
  try {
    const parsed: unknown = JSON.parse(value);
    return { presets: Array.isArray(parsed) && parsed.length > 0 ? parsed as WorkflowPreset[] : DEFAULT_WORKFLOW_PRESETS, unreadable: false };
  } catch {
    return { presets: DEFAULT_WORKFLOW_PRESETS, unreadable: true };
  }
}

const NO_PERSONNEL: SchedulePerson[] = [];
const NO_TASKS: PieceworkTask[] = [];
const NO_LOGS: ProjectWorkLog[] = [];

/**
 * 10.3 (ARCH review finding 3): what the workshop tab reads besides the project, through the shared cache: the workflow
 * presets of the settings, the personnel and the piecework titles (the keys the settings, personnel and piecework screens
 * refresh), and the project's work logs, read again on each opening of the tab. A change saved elsewhere refreshes them
 * while the tab is open. The lists count whenever the cache read them; a failure is said once, and only one of this visit.
 */
export function useScheduleReferenceData(projectId: number) {
  const settingsQuery = useSettingsQuery();
  const personnelQuery = usePersonnelListQuery();
  const tasksQuery = usePieceworkTasksQuery('active');
  const logsQuery = useProjectWorkLogsQuery(projectId);
  const settingsFailedAt = useOpeningRead(settingsQuery, true).failedAt;
  const personnelFailedAt = useOpeningRead(personnelQuery, true).failedAt;
  const tasksFailedAt = useOpeningRead(tasksQuery, true).failedAt;
  const logsRead = useOpeningRead(logsQuery, true);
  const presets = useMemo(() => workflowPresetsOf(settingsQuery.data), [settingsQuery.data]);

  const say = useEffectEvent((message: string) => { toast.error(message); });
  // v9.0.422 (TD-766): a failed read is said, not shown as no presets, no personnel or no work logs
  useEffect(() => {
    if (settingsFailedAt) say('الگوهای گردش کار از تنظیمات دریافت نشد؛ الگوی پیش‌فرض به کار رفت');
  }, [settingsFailedAt]);
  useEffect(() => {
    if (presets.unreadable) say('الگوهای گردش کار در تنظیمات خوانا نیستند؛ الگوی پیش‌فرض به کار رفت');
  }, [presets]);
  useEffect(() => {
    if (personnelFailedAt) say('خطا در دریافت لیست پرسنل');
  }, [personnelFailedAt]);
  useEffect(() => {
    if (tasksFailedAt) say('خطا در دریافت لیست عناوین کارمزدی');
  }, [tasksFailedAt]);
  const sayLogsFailed = useEffectEvent(() => say(errorMessageOf(logsRead.error) || 'خطا در دریافت کارکردهای ثبت‌شده پروژه'));
  useEffect(() => {
    if (logsRead.failedAt) sayLogsFailed();
  }, [logsRead.failedAt]);

  return {
    workflowPresets: presets.presets,
    personnelList: (personnelQuery.data ?? NO_PERSONNEL) as SchedulePerson[],
    pieceworkTasksList: tasksQuery.data ?? NO_TASKS,
    recordedLogs: logsRead.data ?? NO_LOGS,
    loadingLogs: logsQuery.isFetching,
    reloadLogs: () => { void logsQuery.refetch(); },
  };
}
