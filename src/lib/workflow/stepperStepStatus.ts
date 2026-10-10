/**
 * v10.0.86 (TD-1221، یافته آزمون نگاه تازه، نقش‌ها الف): وضعیت هر گام در نوار گام‌های «چرخه تأییدات و گردش کار».
 * پیش‌تر در فرایند ردشده هر گامی که ترتیبش پیش از گام «رد شده» بود «عبورکرده» نشان داده می‌شد، حتی بررسی مالی و تأیید
 * نهایی که سند هرگز به آن‌ها نرسیده بود. حالا در فرایند ردشده فقط گامی که تاریخچه از آن گذشته «تکمیل‌شده» است و بقیه
 * «نرسیده»؛ فرایند در جریان و پایان‌یافته مانند پیش.
 */
export type StepperStepStatus = 'completed' | 'current' | 'pending' | 'rejected' | 'skipped' | 'unreached';

interface StepRef { id: number; stepOrder: number }
interface HistoryRef { fromStateId?: number | null; toStateId?: number | null }

export function stepperStepStatus(
  step: StepRef,
  instanceStatus: string,
  currentState: StepRef | null | undefined,
  history: ReadonlyArray<HistoryRef>,
): StepperStepStatus {
  const isCurrent = currentState?.id === step.id;
  const visited = history.some(h => h.toStateId === step.id || h.fromStateId === step.id);
  if (instanceStatus === 'REJECTED') {
    if (isCurrent) return 'rejected';
    return visited ? 'completed' : 'unreached';
  }
  if (isCurrent && instanceStatus === 'IN_PROGRESS') return 'current';
  const before = step.stepOrder < (currentState?.stepOrder || 0);
  if (instanceStatus === 'COMPLETED' || before) {
    return !visited && before ? 'skipped' : 'completed';
  }
  return 'pending';
}

/** فرایندی که اقدام دارد: در جریان، یا ردشده که با «بازگشایی» ادامه می‌یابد (TD-379) */
export function workflowTakesActions(instanceStatus: string): boolean {
  return instanceStatus === 'IN_PROGRESS' || instanceStatus === 'REJECTED';
}
