import { REQUISITION_ACTION_LABELS } from '../procurement/requisitionFields';

/**
 * v10.0.150 (TD-1177, finding roles-b #4 of the fresh-eyes guide test): the inbox task window names the task's own
 * action (a task's title is its transition's title). The keeper's «تحویل و ورود به انبار» task was offered the
 * manager's «تایید درخواست جهت خرید اقلام» / «تایید نهایی و صدور مجوز خرید», whatever the step.
 */
const GENERIC_TASK_TITLE = 'بررسی و تایید مرحله فرآیند';

function ownActionTitle(title: string | undefined): string {
  const t = String(title ?? '').trim();
  return t && t !== GENERIC_TASK_TITLE ? t : '';
}

/** The approve choice of the task window */
export function taskApproveLabel(title: string | undefined, isRequisition: boolean): string {
  return ownActionTitle(title) || (isRequisition ? 'تایید درخواست جهت خرید اقلام' : 'تایید و موافقت با درخواست');
}

/** The submit button when approving */
export function taskApproveSubmitLabel(title: string | undefined, isRequisition: boolean): string {
  const own = ownActionTitle(title);
  if (own) return `ثبت «${own}»`;
  return isRequisition ? 'تایید نهایی و صدور مجوز خرید' : 'تایید و ثبت نهایی وظیفه';
}

/** A requisition's receive task: rows without a warehouse item are marked received without a stock document (TD-690) */
export function isRequisitionReceiveTask(title: string | undefined, isRequisition: boolean): boolean {
  return isRequisition && ownActionTitle(title) === REQUISITION_ACTION_LABELS.receive_items;
}

export const FREE_TEXT_RECEIVE_HINT = 'ردیف‌های بدون کالای انبار (شرح آزاد) با این اقدام «دریافت‌شده» ثبت می‌شوند و سند انبار نمی‌گیرند؛ کالای انبار فقط با تحویل سفارش خرید وارد انبار می‌شود.';
