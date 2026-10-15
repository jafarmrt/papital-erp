import type { SeedGuardUpgrade, SeedStepGuard } from './seedGuardUpgrade.js';
import { JOURNAL_VOUCHER_WORKFLOW_TEMPLATE } from '../../lib/workflow/workflowTemplates.js';

/**
 * v10.0.27 (TD-965، طرح حقوق ت۹): نگهبان گام‌های گردش کار پیش‌فرض سند حسابداری. تأیید، قطعی کردن و برگرداندن سند
 * تأییدشده به پیش‌نویس `accounting.vouchers_approve` می‌خواهند؛ رد پیش‌نویس همان `accounting.vouchers` ثبت و ویرایش است و
 * بازگشایی سند ردشده آزاد. پیش‌تر هر چهار گام فقط `accounting.vouchers` را می‌خواستند (v9.0.128، TD-542).
 */
export const JOURNAL_VOUCHER_WORKFLOW_CODE = 'JOURNAL_VOUCHER_WORKFLOW';

/** v10.1.8 (TD-1263): read from the journal voucher template, so the seed, its upgrade and «ساخت از الگو» share one list */
export const JOURNAL_VOUCHER_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = JOURNAL_VOUCHER_WORKFLOW_TEMPLATE.transitions.map(t => ({ ...t }));

/** seed پیش از v10.0.27 */
const LEGACY_JOURNAL_VOUCHER_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = JOURNAL_VOUCHER_STEP_GUARDS.map(g => ({
  ...g, requiredPermission: g.actionKey === 'reopen_voucher' ? '' : 'accounting.vouchers',
}));

export const JOURNAL_VOUCHER_GUARD_UPGRADE: SeedGuardUpgrade = {
  code: JOURNAL_VOUCHER_WORKFLOW_CODE,
  stateKeys: ['draft', 'approved', 'permanent', 'rejected'],
  legacy: LEGACY_JOURNAL_VOUCHER_STEP_GUARDS,
  next: JOURNAL_VOUCHER_STEP_GUARDS,
  versionDescription: 'تأیید، قطعی کردن و بازگشت به پیش‌نویس با مجوز «تأیید و قطعی کردن سند حسابداری»',
};
