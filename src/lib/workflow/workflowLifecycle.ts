/**
 * v10.1.5 (TD-1229, D-06 part A): rules of turning a workflow definition on and off, shared by the server and the
 * workflow page, so the confirmation shows the same consequence the server applies.
 */

/** Record types that never stay without an active workflow: a purchase requisition is ordered and received only from its workflow steps (TD-689). */
export const WORKFLOW_REQUIRED_ENTITY_TYPES: readonly string[] = ['purchase_requisition'];

/** Notice after creating a workflow for a record type that already has an active one (decision ت۲۷) */
export const NEW_WORKFLOW_SAVED_INACTIVE = 'این گردش کار غیرفعال ذخیره شد: گردش کار فعلی این نوع پرونده فعال می‌ماند؛ برای جایگزینی، این را فعال کنید.';

export const RUNNING_INSTANCES_CONTINUE = 'پرونده‌هایی که الان در این گردش کار هستند با همان نسخه تا پایان ادامه می‌دهند.';

const DEACTIVATION_EFFECTS: Readonly<Record<string, string>> = {
  document: 'پیش‌فاکتور و پیش‌نویس فروش تازه دیگر تأیید نمی‌خواهند.',
  item: 'سند افتتاحیه کالای تازه بی‌درنگ صادر می‌شود.',
  bank_account: 'سند افتتاحیه حساب بانکی تازه بی‌درنگ صادر می‌شود.',
  journal_voucher: 'سند حسابداری تازه دیگر وارد گردش کار تأیید نمی‌شود.',
  pending_material: 'درخواست ماده اولیه تازه وارد گردش کار نمی‌شود و فقط از صفحه «مواد اولیه در انتظار تأیید» تأیید می‌شود.',
};

/** What changes for users when the active workflow of this record type is turned off (Persian, one sentence). */
export function workflowDeactivationEffect(entityType: string): string {
  return DEACTIVATION_EFFECTS[entityType] ?? 'پرونده تازه این نوع دیگر وارد گردش کار نمی‌شود.';
}

/** Refusal of turning off the last active workflow of a required record type, or null when it may be turned off. */
export function workflowDeactivationRefusal(entityType: string): string | null {
  return WORKFLOW_REQUIRED_ENTITY_TYPES.includes(entityType)
    ? 'درخواست خرید بی گردش کار نه سفارش می‌شود نه دریافت؛ گردش کار درخواست خرید را فقط با فعال کردن گردش کار دیگری برای درخواست خرید می‌توان کنار گذاشت.'
    : null;
}

/**
 * Refusal of changing a definition's record type, or null: only an inactive definition that no record ever entered
 * takes another type, so a type change never leaves two active workflows or a running record under a foreign type.
 */
export function workflowEntityTypeChangeRefusal(definition: { isActive?: number | null; startedCount?: number | null }): string | null {
  if (Number(definition.startedCount ?? 0) > 0) return 'نوع پرونده این گردش کار عوض نمی‌شود، چون پرونده‌هایی با آن آغاز شده‌اند؛ برای نوع دیگر گردش کار تازه بسازید.';
  if (Number(definition.isActive ?? 0) === 1) return 'نوع پرونده گردش کار فعال عوض نمی‌شود؛ نخست آن را غیرفعال کنید.';
  return null;
}
