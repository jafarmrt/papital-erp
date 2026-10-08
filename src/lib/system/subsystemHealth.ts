/**
 * v9.0.358 (TD-593، B01-13): قرارداد وضعیت زیرسامانه‌های صفحه سلامت، مشترک سرور (`systemHealth.service.ts`) و
 * رابط (`SubsystemHealthCards`). هر زیرسامانه جدا سنجیده می‌شود؛ وقتی پرس‌وجوی خودش شکست بخورد وضعیت `unknown`
 * است، شمارنده‌ها null و پیامی فارسی همراه دارد، هرگز صفر و «سالم».
 */

export type SubsystemStatus = 'ok' | 'warning' | 'error' | 'unknown';

export interface OutboxHealth {
  pendingCount: number | null;
  dlqCount: number | null;
  /** v9.0.361 (TD-623): events stuck in processing for more than five minutes */
  stuckCount?: number | null;
  status: SubsystemStatus;
  message?: string;
}
export interface AccountingHealth { totalVouchers: number | null; unbalancedVouchers: number | null; status: SubsystemStatus; message?: string }
export interface WorkflowHealth { activeInstances: number | null; overdueSlaTasks: number | null; status: SubsystemStatus; message?: string }

export interface SubsystemHealth {
  outbox: OutboxHealth;
  accounting: AccountingHealth;
  workflow: WorkflowHealth;
}

/** The label of a status the page could not read */
export const SUBSYSTEM_UNKNOWN_LABEL = 'نامعلوم';

/** Persian messages of a subsystem whose own query failed (the error itself goes only to the server log) */
export const SUBSYSTEM_UNKNOWN_MESSAGES: Readonly<Record<keyof SubsystemHealth, string>> = {
  outbox: 'وضعیت صف رویدادها خوانده نشد؛ لاگ کارساز را ببینید.',
  accounting: 'تراز اسناد حسابداری خوانده نشد؛ لاگ کارساز را ببینید.',
  workflow: 'وضعیت گردش کار خوانده نشد؛ لاگ کارساز را ببینید.',
};

/** A subsystem missing from an older server's answer is unknown too, never healthy */
export function subsystemStatusOf(health: { status?: string } | undefined): SubsystemStatus {
  const status = health?.status;
  return status === 'ok' || status === 'warning' || status === 'error' ? status : 'unknown';
}
