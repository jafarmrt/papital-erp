/**
 * v10.1.8 (TD-1263, D-06 part B, decision ت۵ «چهار»): ready-made workflow templates, shared by the server and the workflow
 * page. «ساخت از الگو» makes an inactive definition from one of them (`POST /workflow/definitions/from-template`); the
 * user reviews it in the designer and turns it on. Every action is guarded by a permission key, never a role code
 * (TD-542). The purchase requisition and journal voucher templates are the default workflows the boot seeds: their steps
 * and actions are read from here by the seed and by the seed upgrade guards, so the two never drift apart.
 */

export interface WorkflowTemplateStep {
  stateKey: string;
  title: string;
  stateType: 'initial' | 'intermediate' | 'normal' | 'terminal';
  color: string;
  stepOrder: number;
  slaHours: number;
  positionX: number;
  positionY: number;
}

export interface WorkflowTemplateAction {
  from: string;
  to: string;
  actionKey: string;
  title: string;
  requiredRole: string;
  requiredPermission: string;
  /** «آغازکننده تأیید نکند» (TD-392) */
  isInitiatorExcluded?: boolean;
  /** «فقط آغازکننده اجرا کند» (TD-1220) */
  isInitiatorOnly?: boolean;
}

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  /** Base code of the definition; a taken code gets a number (`_2`, `_3` …) */
  code: string;
  title: string;
  entityType: string;
  description: string;
  states: ReadonlyArray<WorkflowTemplateStep>;
  transitions: ReadonlyArray<WorkflowTemplateAction>;
}

export const WORKFLOW_TEMPLATE_IDS = ['item', 'bank_account', 'purchase_requisition', 'journal_voucher'] as const;
export type WorkflowTemplateId = typeof WORKFLOW_TEMPLATE_IDS[number];

/** Approve then done, or reject: the shape of the item and bank account templates */
function approvalSteps(recordTitle: string): WorkflowTemplateStep[] {
  return [
    { stateKey: 'draft', title: recordTitle, stateType: 'initial', color: 'gray', stepOrder: 1, slaHours: 24, positionX: 100, positionY: 160 },
    { stateKey: 'approved', title: 'تأییدشده', stateType: 'terminal', color: 'emerald', stepOrder: 2, slaHours: 24, positionX: 500, positionY: 160 },
    { stateKey: 'rejected', title: 'ردشده', stateType: 'terminal', color: 'rose', stepOrder: 3, slaHours: 24, positionX: 500, positionY: 340 },
  ];
}

export const ITEM_WORKFLOW_TEMPLATE: WorkflowTemplate = {
  id: 'item',
  code: 'ITEM_APPROVAL_WORKFLOW',
  title: 'تأیید کالای تازه و سند افتتاحیه آن',
  entityType: 'item',
  description: 'کالای تازه پس از تأیید وارد دفاتر می‌شود: سند افتتاحیه موجودی اولیه آن با تأیید صادر می‌شود، نه هنگام ثبت کالا.',
  states: approvalSteps('ثبت کالا'),
  transitions: [
    { from: 'draft', to: 'approved', actionKey: 'approve_item', title: 'تأیید کالا و سند افتتاحیه', requiredRole: '', requiredPermission: 'products.create' },
    { from: 'draft', to: 'rejected', actionKey: 'reject_item', title: 'رد', requiredRole: '', requiredPermission: 'products.create' },
  ],
};

export const BANK_ACCOUNT_WORKFLOW_TEMPLATE: WorkflowTemplate = {
  id: 'bank_account',
  code: 'BANK_ACCOUNT_APPROVAL_WORKFLOW',
  title: 'تأیید حساب بانکی تازه و مانده افتتاحیه آن',
  entityType: 'bank_account',
  description: 'حساب بانکی یا صندوق تازه پس از تأیید وارد دفاتر می‌شود: سند مانده افتتاحیه آن با تأیید صادر می‌شود، نه هنگام ثبت حساب.',
  states: approvalSteps('ثبت حساب'),
  transitions: [
    { from: 'draft', to: 'approved', actionKey: 'approve_bank_account', title: 'تأیید حساب و مانده افتتاحیه', requiredRole: '', requiredPermission: 'accounting.treasury' },
    { from: 'draft', to: 'rejected', actionKey: 'reject_bank_account', title: 'رد', requiredRole: '', requiredPermission: 'accounting.treasury' },
  ],
};

/**
 * The default purchase requisition workflow (v10.0.37, OBS-R2-36): approve, reject and cancel `procurement.approve`, the
 * requisition's creator never approves it, receive `warehouse.in`, reopen `procurement.create`.
 */
export const PURCHASE_REQUISITION_WORKFLOW_TEMPLATE: WorkflowTemplate = {
  id: 'purchase_requisition',
  code: 'PURCHASE_REQUISITION_WORKFLOW',
  title: 'گردش کار تدارکات و خرید کارگاه (بررسی و تایید -> در حال خرید -> تحویل انبار)',
  entityType: 'purchase_requisition',
  description: 'فرآیند ساده‌سازی شده خرید و تدارکات کارگاه شامل ۳ گام عملیاتی: ۱. در انتظار بررسی و تایید، ۲. تایید شده (در حال خرید)، ۳. خرید و تحویل انبار شده',
  states: [
    { stateKey: 'pending', title: 'در انتظار بررسی و تایید', stateType: 'initial', color: 'amber', stepOrder: 1, slaHours: 24, positionX: 100, positionY: 160 },
    { stateKey: 'ordered', title: 'تایید شده (در حال خرید)', stateType: 'normal', color: 'sky', stepOrder: 2, slaHours: 48, positionX: 450, positionY: 160 },
    { stateKey: 'received', title: 'خرید و تحویل انبار شده (تکمیل)', stateType: 'terminal', color: 'emerald', stepOrder: 3, slaHours: 24, positionX: 800, positionY: 160 },
    { stateKey: 'rejected', title: 'رد شده / لغو', stateType: 'terminal', color: 'rose', stepOrder: 4, slaHours: 24, positionX: 450, positionY: 340 },
  ],
  transitions: [
    { from: 'pending', to: 'ordered', actionKey: 'approve_request', title: 'تایید و صدور دستور خرید', requiredRole: '', requiredPermission: 'procurement.approve', isInitiatorExcluded: true },
    { from: 'ordered', to: 'received', actionKey: 'receive_items', title: 'تحویل و ورود به انبار', requiredRole: '', requiredPermission: 'warehouse.in' },
    { from: 'pending', to: 'rejected', actionKey: 'reject_request', title: 'رد درخواست خرید', requiredRole: '', requiredPermission: 'procurement.approve' },
    { from: 'ordered', to: 'rejected', actionKey: 'cancel_order', title: 'لغو یا رد سفارش', requiredRole: '', requiredPermission: 'procurement.approve' },
    { from: 'rejected', to: 'pending', actionKey: 'reopen', title: 'بازگشایی و بررسی مجدد', requiredRole: '', requiredPermission: 'procurement.create' },
  ],
};

/**
 * The default journal voucher workflow (v10.0.27, TD-965): approve, finalize and back to draft
 * `accounting.vouchers_approve`; rejecting a draft `accounting.vouchers`; reopening a rejected voucher free.
 */
export const JOURNAL_VOUCHER_WORKFLOW_TEMPLATE: WorkflowTemplate = {
  id: 'journal_voucher',
  code: 'JOURNAL_VOUCHER_WORKFLOW',
  title: 'گردش کار تایید اسناد حسابداری کارگاه (پیش‌نویس -> تایید و ثبت دفاتر -> قطعی‌سازی)',
  entityType: 'journal_voucher',
  description: 'فرآیند سبک و متناسب کارگاه جهت تایید اسناد حسابداری: ثبت پیش‌نویس توسط کاربران/سامانه -> بررسی و تایید واحد حسابداری -> قطعی‌سازی دفاتر رسمی',
  states: [
    { stateKey: 'draft', title: 'پیش‌نویس سند', stateType: 'initial', color: 'slate', stepOrder: 1, slaHours: 24, positionX: 100, positionY: 160 },
    { stateKey: 'approved', title: 'تایید و ثبت دفاتر رسمی', stateType: 'intermediate', color: 'blue', stepOrder: 2, slaHours: 48, positionX: 450, positionY: 160 },
    { stateKey: 'permanent', title: 'قطعی و قفل دفاتر', stateType: 'terminal', color: 'emerald', stepOrder: 3, slaHours: 72, positionX: 800, positionY: 160 },
    { stateKey: 'rejected', title: 'رد شده / نیازمند بازبینی', stateType: 'intermediate', color: 'rose', stepOrder: 4, slaHours: 24, positionX: 450, positionY: 340 },
  ],
  transitions: [
    { from: 'draft', to: 'approved', actionKey: 'approve_voucher', title: 'تایید حسابداری و ثبت در دفاتر', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
    { from: 'approved', to: 'permanent', actionKey: 'finalize_voucher', title: 'قطعی‌سازی و قفل سند', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
    { from: 'draft', to: 'rejected', actionKey: 'reject_voucher', title: 'رد پیش‌نویس جهت اصلاح', requiredRole: '', requiredPermission: 'accounting.vouchers' },
    { from: 'approved', to: 'draft', actionKey: 'revert_to_draft', title: 'بازگشت به پیش‌نویس', requiredRole: '', requiredPermission: 'accounting.vouchers_approve' },
    { from: 'rejected', to: 'draft', actionKey: 'reopen_voucher', title: 'بازگشایی و اصلاح سند', requiredRole: '', requiredPermission: '' },
  ],
};

export const WORKFLOW_TEMPLATES: ReadonlyArray<WorkflowTemplate> = [
  ITEM_WORKFLOW_TEMPLATE,
  BANK_ACCOUNT_WORKFLOW_TEMPLATE,
  PURCHASE_REQUISITION_WORKFLOW_TEMPLATE,
  JOURNAL_VOUCHER_WORKFLOW_TEMPLATE,
];

export function workflowTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(t => t.id === id);
}

/** Notice after «ساخت از الگو»: the new definition is inactive until the user turns it on */
export const TEMPLATE_DEFINITION_SAVED_INACTIVE = 'گردش کار از الگو غیرفعال ساخته شد؛ آن را در طراح ببینید و اگر درست است، از فهرست فعالش کنید.';
