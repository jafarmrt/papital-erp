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
