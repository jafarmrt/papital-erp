/**
 * v8.0.87 (TD-386): نرخ ردیف فرم ثبت کارکرد. نرخ پیشنهادی همان نرخی است که سرور برمی‌گزیند: نرخ اختصاصی پرسنل برای آن
 * عنوان کار، وگرنه نرخ پایه عنوان (`logWorkEntries`). فرم نرخ را فقط وقتی می‌فرستد که کاربر آن را دستی عوض کرده باشد؛
 * پیش‌تر نرخ پایه همیشه فرستاده می‌شد و برای مدیر پرسنل (که نرخ دستی‌اش پذیرفته است، TD-300) نرخ اختصاصی پرسنل کنار
 * می‌رفت، و نرخ خالی صفر ثبت می‌شد.
 */
export interface RateTask {
  id: number;
  defaultRate?: number | string | null;
}

export interface RatedRow {
  taskId: number | '';
  unitRate: number;
  /** کاربر نرخ را دستی عوض کرده است */
  rateEdited?: boolean;
}

export function suggestedRate(taskId: number | '', tasks: readonly RateTask[], customRates: Readonly<Record<number, number>>): number {
  if (taskId === '') return 0;
  const custom = customRates[Number(taskId)];
  if (custom !== undefined && Number.isFinite(custom)) return custom;
  const task = tasks.find(t => t.id === taskId);
  return task ? Number(task.defaultRate || 0) : 0;
}

/** نرخ ردیف‌هایی که دستی عوض نشده‌اند با نرخ‌های تازه پرسنل دوباره پیشنهاد می‌شود */
export function refreshSuggestedRates<T extends RatedRow>(rows: readonly T[], tasks: readonly RateTask[], customRates: Readonly<Record<number, number>>): T[] {
  return rows.map(r => (r.rateEdited || r.taskId === '' ? r : { ...r, unitRate: suggestedRate(r.taskId, tasks, customRates) }));
}

/** نرخ ارسالی ردیف: فقط نرخ دستی؛ نبودِ نرخ یعنی سرور نرخ اختصاصی یا پایه را برمی‌گزیند */
export function submittedRate(row: RatedRow): number | undefined {
  return row.rateEdited ? Number(row.unitRate) || 0 : undefined;
}
