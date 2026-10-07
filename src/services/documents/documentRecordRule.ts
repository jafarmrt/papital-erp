import {
  documentRecordPermission,
  type DocumentRecordStatus,
  type DocumentStockDirection,
} from '../../lib/permissions/documentPermissions.js';

/**
 * v9.0.125 (TD-541 / TD-771): وضعیت و جهت سندی که ثبت یا نهایی می‌شود، با همان قاعده‌ای که `createDocumentWithDetails` و
 * `finalizeDocument` به کار می‌برند، و مجوزی که جدول `documentRecordPermission` برای آن می‌خواهد. مسیرها و گام تأیید
 * گردش کار مجوز را از همین‌جا می‌گیرند تا با رفتار سرویس یکی بماند.
 */

/** وضعیت سند تازه: وضعیت فرستاده‌شده، وگرنه پیش‌فاکتور برای نوع پیش‌فاکتور و قطعی برای بقیه */
export function createdDocumentStatus(docType: string, status?: string | null): DocumentRecordStatus {
  if (status === 'draft' || status === 'proforma' || status === 'final') return status;
  return docType === 'proforma' ? 'proforma' : 'final';
}

/** جهت گردش کالای سند تازه (برگشت از فروش ورود است؛ بقیه جهت فرستاده‌شده، وگرنه رسید و خرید ورود و بقیه خروج) */
export function createdStockDirection(docType: string, inOut?: string | null): DocumentStockDirection {
  if (docType === 'return') return 'in';
  if (inOut === 'in' || inOut === 'out') return inOut;
  return docType === 'purchase' || docType === 'receipt' ? 'in' : 'out';
}

/** جهت گردش کالای سند هنگام نهایی‌سازی، از نوع سند */
export function finalizedStockDirection(docType: string): DocumentStockDirection {
  return docType === 'receipt' || docType === 'purchase' || docType === 'production_receipt' || docType === 'return' ? 'in' : 'out';
}

/** مجوز ثبت سند تازه */
export function permissionToCreateDocument(input: { docType: string; status?: string | null; inOut?: string | null }): string {
  return documentRecordPermission(input.docType, createdDocumentStatus(input.docType, input.status), createdStockDirection(input.docType, input.inOut));
}

/** مجوز نهایی کردن سند ذخیره‌شده (از راه نهایی‌سازی یا گام تأیید گردش کار) */
export function permissionToFinalizeDocument(docType: string): string {
  return documentRecordPermission(docType, 'final', finalizedStockDirection(docType));
}
