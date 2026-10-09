import type { SeedGuardUpgrade, SeedStepGuard } from './seedGuardUpgrade.js';

/**
 * v10.0.21 (TD-965، طرح حقوق ت۹): نگهبان گام‌های گردش کار پیش‌فرض سند حسابداری. تأیید، قطعی کردن و برگرداندن سند
 * تأییدشده به پیش‌نویس `accounting.vouchers_approve` می‌خواهند؛ رد پیش‌نویس همان `accounting.vouchers` ثبت و ویرایش است و
 * بازگشایی سند ردشده آزاد. پیش‌تر هر چهار گام فقط `accounting.vouchers` را می‌خواستند (v9.0.128، TD-542).
 */
export const JOURNAL_VOUCHER_WORKFLOW_CODE = 'JOURNAL_VOUCHER_WORKFLOW';

export const JOURNAL_VOUCHER_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = [
  { from: 'draft', to: 'approved', actionKey: 'approve_voucher', title: 'تایید حسابداری و ثبت در دفاتر', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
  { from: 'approved', to: 'permanent', actionKey: 'finalize_voucher', title: 'قطعی‌سازی و قفل سند', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
  { from: 'draft', to: 'rejected', actionKey: 'reject_voucher', title: 'رد پیش‌نویس جهت اصلاح', requiredRole: '', requiredPermission: 'accounting.vouchers' },
  { from: 'approved', to: 'draft', actionKey: 'revert_to_draft', title: 'بازگشت به پیش‌نویس', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
  { from: 'rejected', to: 'draft', actionKey: 'reopen_voucher', title: 'بازگشایی و اصلاح سند', requiredRole: '', requiredPermission: '' },
];

/** seed پیش از v10.0.21 */
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
