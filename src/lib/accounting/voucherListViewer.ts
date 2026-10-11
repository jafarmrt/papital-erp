/**
 * Fresh-eyes work-map B-05 / B-07 / B-12: what the voucher list shows its viewer.
 * - B-07 (TD-1129): the reference line names the module in Persian, never its code.
 * - B-05 (TD-1230): the maker column shows the maker's full name, else the username.
 * - B-12 (TD-1231): the approve button is not offered to the maker of a manual draft (the server rule
 *   `makerApprovalRefusal` in `src/services/accounting/voucherMakerChecker.ts`); the system admin is exempt.
 */
export const VOUCHER_REFERENCE_MODULE_LABELS: Readonly<Record<string, string>> = {
  manual: 'دستی',
  invoice: 'سند فروش، خرید یا انبار',
  inventory: 'انبار',
  cheque: 'چک',
  treasury: 'خزانه',
  treasury_opening: 'افتتاحیه خزانه',
  item_opening: 'افتتاحیه کالا',
  payroll: 'فیش حقوق',
  payroll_payment: 'پرداخت حقوق',
};

export function voucherReferenceModuleLabel(referenceModule: string | null | undefined): string {
  return VOUCHER_REFERENCE_MODULE_LABELS[(referenceModule || 'manual').trim()] ?? 'سایر';
}

export function voucherReferenceText(referenceModule: string | null | undefined, referenceNumber: string): string {
  return `${voucherReferenceModuleLabel(referenceModule)} (${referenceNumber})`;
}

export function voucherMakerName(v: { createdByName?: string | null; createdByUsername?: string | null }, fallback = 'کاربر'): string {
  return (v.createdByName ?? '').trim() || (v.createdByUsername ?? '').trim() || fallback;
}

export interface VoucherViewer {
  id: number;
  isAdmin: boolean;
}

export interface VoucherMakerFacts {
  status: string;
  createdById?: number | null;
  updatedById?: number | null;
  sourceKind?: string | null;
  sourceFiscalYear?: number | null;
}

/** The viewer made or last edited this manual draft, so the server refuses their approval */
export function isViewerVoucherMaker(v: VoucherMakerFacts, viewer: VoucherViewer | null): boolean {
  if (!viewer || viewer.isAdmin || v.status !== 'draft') return false;
  if (v.sourceKind || (v.sourceFiscalYear !== null && v.sourceFiscalYear !== undefined)) return false;
  return viewer.id === v.createdById || viewer.id === (v.updatedById ?? null);
}
