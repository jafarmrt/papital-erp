import { requisitionActionLabel } from './requisitionFields';

/**
 * OBS-R2-38 (TD-992): دکمه‌های اقدام پنجره جزئیات درخواست خرید از اقدام‌هایی ساخته می‌شوند که سرور برای گام جاری
 * گردش کار و همین کاربر مجاز می‌داند (`availableTransitions` پاسخ `GET /workflow/instance/purchase_requisition/:id`)،
 * نه از وضعیت درخواست. پیش‌تر هر درخواستِ «در انتظار» دکمه «تأیید» را نشان می‌داد، حتی به آغازکننده‌ای که سرور تأییدش
 * را رد می‌کند، و گام سفارشی گردش کار دکمه‌ای می‌گرفت که در آن گام اقدامی ندارد.
 */

/** اقدام دریافت را تحویل سفارش اجرا می‌کند، نه دکمه اقدام (همان کلیدهای RECEIVE_ACTION_KEYS سرور) */
export const REQUISITION_RECEIVE_ACTION_KEYS: ReadonlySet<string> = new Set(['receive_items', 'mark_received', 'receive']);

export interface RequisitionTransitionRef {
  actionKey: string;
  title?: string | null;
}

export interface RequisitionActionButton {
  actionKey: string;
  label: string;
  tone: 'approve' | 'reject';
}

const REJECT_ACTION_PATTERN = /reject|cancel/;

function buttonOf(actionKey: string, title?: string | null): RequisitionActionButton {
  return {
    actionKey,
    label: requisitionActionLabel(actionKey, title),
    tone: REJECT_ACTION_PATTERN.test(actionKey) ? 'reject' : 'approve',
  };
}

/** یک دکمه برای هر اقدام مجاز گام جاری، بی اقدام دریافت و بی تکرار کلید */
export function requisitionActionButtons(transitions: readonly RequisitionTransitionRef[] | undefined): RequisitionActionButton[] {
  const seen = new Set<string>();
  const buttons: RequisitionActionButton[] = [];
  for (const t of Array.isArray(transitions) ? transitions : []) {
    const key = String(t?.actionKey || '');
    if (!key || seen.has(key) || REQUISITION_RECEIVE_ACTION_KEYS.has(key)) continue;
    seen.add(key);
    buttons.push(buttonOf(key, t.title));
  }
  return buttons;
}

/**
 * درخواست قدیمی بی نمونه گردش کار: سرور با نخستین اقدام، گردش کار را از گام آغاز می‌سازد، پس فقط درخواستِ «در انتظار»
 * با مجوز تأیید، اقدام‌های گام آغاز گردش کار پیش‌فرض را می‌گیرد.
 */
export function requisitionActionsWithoutInstance(status: string, canApprove: boolean): RequisitionActionButton[] {
  if (status !== 'pending' || !canApprove) return [];
  return [buttonOf('approve_request'), buttonOf('reject_request')];
}

/** وضعیت ناشناخته «other» است؛ وضعیت‌های قدیمی approved، completed و cancelled را سرور هنوز می‌خواند (TD-326) */
export type RequisitionStage = 'approval' | 'ordered' | 'received' | 'rejected' | 'consolidated' | 'other';

const STAGE_OF_STATUS: Readonly<Record<string, RequisitionStage>> = {
  pending: 'approval', under_review: 'approval', manager_approval: 'approval',
  ordered: 'ordered', approved: 'ordered',
  received: 'received', completed: 'received',
  rejected: 'rejected', cancelled: 'rejected',
  consolidated: 'consolidated',
};

export function requisitionStage(status: unknown): RequisitionStage {
  return STAGE_OF_STATUS[String(status ?? '')] ?? 'other';
}

/** نام سند پیوسته به ردیف: شماره عطف سفارش خرید، وگرنه «سند» با شماره فارسی؛ هرگز «سند #شناسه» */
export function linkedDocumentLabel(docId: number, orders: readonly { id: number; refNumber?: string | null }[], formatNumber: (n: number) => string): string {
  const ref = orders.find(o => Number(o.id) === Number(docId))?.refNumber?.trim();
  return ref ? `سفارش ${ref}` : `سند ${formatNumber(docId)}`;
}

// v10.1.8: after approval the window's order button is «مشاهده / ثبت فاکتور تامین‌کننده» (the desk row's «تفکیک و صدور فاکتور»);
// «تفکیک تأمین‌کننده و صدور سفارش خرید» shows only before approval, while bulk delivery shows only after it
export const BULK_DELIVERY_NO_ORDERS = 'هنوز سفارش خریدی برای این درخواست صادر نشده است؛ ابتدا با «مشاهده / ثبت فاکتور تامین‌کننده» در همین پنجره، یا «تفکیک و صدور فاکتور» در ردیف میز تدارکات، سفارش خرید صادر کنید.';
export const BULK_DELIVERY_ALL_DELIVERED = 'همه سفارش‌های خرید این درخواست پیش‌تر تحویل انبار شده‌اند.';

/** سفارش‌هایی که تحویل گروهی باید تحویل دهد؛ بی سفارش باز، پیام به جای پنجره خالی */
export function bulkDeliveryPlan<T extends { id: number; status?: string }>(orders: readonly T[]): { orders: T[] } | { error: string } {
  const open = orders.filter(o => o.status !== 'final');
  if (open.length > 0) return { orders: open };
  return { error: orders.length === 0 ? BULK_DELIVERY_NO_ORDERS : BULK_DELIVERY_ALL_DELIVERED };
}

/** پاسخ `GET /procurement/requisitions/:id/workflow-actions` */
export interface RequisitionWorkflowActions {
  /** درخواست نمونه گردش کار دارد؛ بی آن، requisitionActionsWithoutInstance */
  hasInstance: boolean;
  actions: RequisitionTransitionRef[];
}
