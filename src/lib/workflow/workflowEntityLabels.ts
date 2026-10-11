/**
 * Persian name of a workflow entity type (package 14, B14-28 / TD-470): the inbox and the deadline report never show
 * the raw English type, an unknown one is named «پرونده».
 */
const ENTITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  document: 'فاکتور / سند انبار',
  invoice: 'فاکتور',
  project: 'پروژه تولید',
  production_project: 'پروژه تولید',
  item: 'کالا',
  raw_material: 'کالا',
  pending_material: 'ماده اولیه معلق',
  bank_account: 'حساب بانکی',
  purchase_requisition: 'درخواست خرید',
  journal_voucher: 'سند حسابداری',
  voucher: 'سند حسابداری',
};

export const UNKNOWN_ENTITY_TYPE_LABEL = 'پرونده';

export function workflowEntityTypeLabel(type: string | null | undefined): string {
  return (type && ENTITY_TYPE_LABELS[type]) || UNKNOWN_ENTITY_TYPE_LABEL;
}

/**
 * Entity tabs of the approval inbox (TD-1151): the entity types the server starts a workflow for, each with its
 * Persian name. Before, the tabs were document, «project» (no workflow starts on a project) and pending material, so a
 * purchase requisition, voucher, item or bank account task was only under «همه».
 */
export const INBOX_ENTITY_TABS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'all', label: 'همه موجودیت‌ها' },
  { id: 'document', label: 'اسناد و فاکتورها' },
  { id: 'purchase_requisition', label: 'درخواست خرید' },
  { id: 'journal_voucher', label: 'اسناد حسابداری' },
  { id: 'pending_material', label: 'مواد اولیه معلق' },
  { id: 'item', label: 'کالا' },
  { id: 'bank_account', label: 'حساب بانکی' },
];
