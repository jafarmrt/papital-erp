import type { SeedGuardUpgrade, SeedStepGuard } from './seedGuardUpgrade.js';

/**
 * v10.0.28 (OBS-R2-36 از TD-992، طرح حقوق و تفکیک وظایف ت۱۱ «الف»): نگهبان گام‌های گردش کار پیش‌فرض درخواست خرید.
 * «تأیید و صدور دستور خرید» `procurement.approve` می‌خواهد و آغازکننده درخواست آن را تأیید نمی‌کند (TD-392؛ مدیر سیستم
 * مستثناست)؛ «تحویل و ورود به انبار» `warehouse.in` (همان کلیدی که اقدام دامنه از TD-904 می‌خواهد)؛ رد و لغو
 * `procurement.approve`؛ بازگشایی `procurement.create`. پیش‌تر هیچ اقدامی نقش یا مجوز نداشت و هر کاربر گردش کار درخواست
 * خودش را تأیید می‌کرد.
 */
export const PURCHASE_REQUISITION_WORKFLOW_CODE = 'PURCHASE_REQUISITION_WORKFLOW';

export const PURCHASE_REQUISITION_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = [
  { from: 'pending', to: 'ordered', actionKey: 'approve_request', title: 'تایید و صدور دستور خرید', requiredRole: '', requiredPermission: 'procurement.approve', isInitiatorExcluded: true },
  { from: 'ordered', to: 'received', actionKey: 'receive_items', title: 'تحویل و ورود به انبار', requiredRole: '', requiredPermission: 'warehouse.in' },
  { from: 'pending', to: 'rejected', actionKey: 'reject_request', title: 'رد درخواست خرید', requiredRole: '', requiredPermission: 'procurement.approve' },
  { from: 'ordered', to: 'rejected', actionKey: 'cancel_order', title: 'لغو یا رد سفارش', requiredRole: '', requiredPermission: 'procurement.approve' },
  { from: 'rejected', to: 'pending', actionKey: 'reopen', title: 'بازگشایی و بررسی مجدد', requiredRole: '', requiredPermission: 'procurement.create' },
];

/** seed پیش از v10.0.28: هیچ اقدامی نقش و مجوز نداشت */
const LEGACY_PURCHASE_REQUISITION_STEP_GUARDS: ReadonlyArray<SeedStepGuard> = PURCHASE_REQUISITION_STEP_GUARDS.map(g => ({
  ...g, requiredPermission: '', isInitiatorExcluded: false,
}));

export const PURCHASE_REQUISITION_GUARD_UPGRADE: SeedGuardUpgrade = {
  code: PURCHASE_REQUISITION_WORKFLOW_CODE,
  stateKeys: ['pending', 'ordered', 'received', 'rejected'],
  legacy: LEGACY_PURCHASE_REQUISITION_STEP_GUARDS,
  next: PURCHASE_REQUISITION_STEP_GUARDS,
  versionDescription: 'تأیید، رد و لغو با «تایید کارتابلی درخواست‌های خرید» و بی آغازکننده؛ تحویل با «ورود کالا به انبار»؛ بازگشایی با «ثبت درخواست خرید جدید»',
};
