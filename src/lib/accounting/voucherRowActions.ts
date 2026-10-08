import { toPersianDigits } from '../../utils/persianNumber';
import { isReversalReference, voucherSourceLabel } from './voucherSource';

/**
 * v9.0.298 (TD-568، B03-26): منوی ردیف سند حسابداری فقط کاری را پیشنهاد می‌دهد که سرور می‌پذیرد. پیش‌تر سند تأییدشده
 * «ویرایش مستقیم» داشت (سرور فقط پیش‌نویس را ویرایش می‌کند)، سند دائم «سند اصلاحی» داشت (سرور اصلاح سند دائم را رد
 * می‌کند)، سند بستن سال معکوس و اصلاح داشت و سند برگشت دوباره برگشت می‌خورد؛ همه ۴۰۹ یا ۴۲۲ می‌گرفتند.
 *
 * قاعده‌ها همان سرورند (`voucher.service.ts`): ویرایش و حذف فقط پیش‌نویس؛ بازگشت به پیش‌نویس فقط تأییدشده؛ برگشت
 * تأییدشده و دائم؛ اصلاح فقط تأییدشده؛ سند برگشت نه برگشت می‌خورد نه اصلاح می‌شود؛ سند منشأدار (TD-552) و سند بستن
 * سال (TD-559) هیچ‌یک از این کارها را ندارند. گردش کار همیشه هست.
 */
export type VoucherRowAction = 'edit' | 'delete' | 'revert_to_draft' | 'reverse' | 'correct' | 'workflow';

export interface VoucherRowFacts {
  status: string;
  sourceKind?: string | null;
  sourceFiscalYear?: number | null;
  referenceNumber?: string | null;
}

export function voucherRowActions(v: VoucherRowFacts): VoucherRowAction[] {
  const locked = Boolean(voucherSourceLabel(v.sourceKind)) || (v.sourceFiscalYear !== null && v.sourceFiscalYear !== undefined);
  const reversal = isReversalReference(v.referenceNumber);
  const actions: VoucherRowAction[] = [];
  if (!locked) {
    if (v.status === 'draft') actions.push('edit', 'delete');
    if (v.status === 'approved') actions.push('revert_to_draft');
    if (!reversal && (v.status === 'approved' || v.status === 'permanent')) actions.push('reverse');
    if (!reversal && v.status === 'approved') actions.push('correct');
  }
  actions.push('workflow');
  return actions;
}

/** چرا منوی سند قفل‌شده کار تغییر ندارد؛ برای سند آزاد null */
export function voucherLockNote(v: VoucherRowFacts): string | null {
  const label = voucherSourceLabel(v.sourceKind);
  if (label) return `این سند را ${label} صادر کرده است؛ برای تغییر آن، ${label} را ابطال کنید.`;
  if (v.sourceFiscalYear !== null && v.sourceFiscalYear !== undefined) {
    const year = toPersianDigits(String(v.sourceFiscalYear));
    return `این سند را بستن سال مالی ${year} صادر کرده است و فقط با بازگشایی سال ${year} تغییر می‌کند.`;
  }
  return null;
}

export type VoucherConfirmKind = 'finalize' | 'approve' | 'revert_to_draft' | 'delete';

/** متن پنجره تأیید کارهای ردیف سند؛ هیچ متنی راهی را که سرور ندارد وعده نمی‌دهد */
export function voucherConfirmTexts(kind: VoucherConfirmKind, v: VoucherRowFacts & { voucherNumber: number | string }) {
  const number = toPersianDigits(String(v.voucherNumber));
  const label = voucherSourceLabel(v.sourceKind);
  switch (kind) {
    case 'finalize':
      return {
        title: 'قطعی‌سازی سند حسابداری',
        message: label
          ? `سند شماره ${number} دائم شود؟ سند دائم ویرایش، حذف و اصلاح نمی‌شود و اثر آن فقط با ابطال ${label} برمی‌گردد.`
          : `سند شماره ${number} دائم شود؟ سند دائم ویرایش، حذف و اصلاح نمی‌شود و فقط با «صدور سند برگشتی (ابطال سند)» بی‌اثر می‌شود.`,
        confirmText: 'بله، قطعی شود',
      };
    case 'approve':
      return {
        title: 'تأیید حسابداری سند',
        message: `سند شماره ${number} تأیید شود؟ با تأیید، سند در دفاتر و گزارش‌های مالی می‌آید.`,
        confirmText: 'بله، تأیید شود',
      };
    case 'revert_to_draft':
      return {
        title: 'بازگشت سند به پیش‌نویس',
        message: `سند شماره ${number} به پیش‌نویس برگردد؟ سند تا تأیید دوباره از دفاتر و گزارش‌ها بیرون می‌رود و ویرایش‌پذیر می‌شود.`,
        confirmText: 'بله، به پیش‌نویس برگردد',
      };
    default:
      return {
        title: 'حذف سند حسابداری',
        message: `سند پیش‌نویس شماره ${number} حذف شود؟`,
        confirmText: 'بله، حذف شود',
      };
  }
}
