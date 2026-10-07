/**
 * v9.0.260 (TD-635, finding B13-10, product-owner decision ت۳ ب): a daily log is recorded only as onsite or remote,
 * like the form. Logs stored earlier as leave, mission or hybrid keep their value and are shown and counted as such:
 * never as onsite or remote, and the hours of a leave are not work hours.
 */
export const DAILY_LOG_WORK_MODES = ['onsite', 'remote'] as const;
export type DailyLogWorkMode = typeof DAILY_LOG_WORK_MODES[number];

const WORK_MODE_LABELS: Record<string, string> = {
  onsite: 'حضوری',
  remote: 'دورکاری',
  leave: 'مرخصی',
  mission: 'مأموریت',
  hybrid: 'ترکیبی',
};

export function workModeLabel(mode: string | null | undefined): string {
  return WORK_MODE_LABELS[String(mode ?? '')] ?? 'نامشخص';
}

/** Whether a log's hours are work hours (a legacy leave log is not) */
export function countsAsWorkHours(mode: string | null | undefined): boolean {
  return mode !== 'leave';
}
