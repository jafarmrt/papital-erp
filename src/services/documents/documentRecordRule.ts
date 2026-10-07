import {
  documentRecordPermission,
  type DocumentRecordStatus,
  type DocumentStockDirection,
} from '../../lib/permissions/documentPermissions.js';
import { documentStockDirection, isRecordableDocumentType } from '../../lib/documents/documentDirection.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * v9.0.125 (TD-541 / TD-771): وضعیت و جهت سندی که ثبت یا نهایی می‌شود، با همان قاعده‌ای که `createDocumentWithDetails` و
 * `finalizeDocument` به کار می‌برند، و مجوزی که جدول `documentRecordPermission` برای آن می‌خواهد. مسیرها و گام تأیید
 * گردش کار مجوز را از همین‌جا می‌گیرند تا با رفتار سرویس یکی بماند.
 *
 * v9.0.213 (TD-770، تصمیم ت۲ «الف» بسته ۸): جهت گردش فقط از نوع سند (`documentStockDirection`)، در ثبت و نهایی‌سازی؛
 * `inOut` ناسازگار با نوع ۴۲۲ است (نه نادیده) تا فراخواننده‌ای که جهت دیگری می‌فرستد خطایش را ببیند، و نوعی که جهت ندارد
 * (انتقال بین انبارها یا نوع ناشناخته) از مسیر ثبت سند پذیرفته نمی‌شود.
 */

/** وضعیت سند تازه: وضعیت فرستاده‌شده، وگرنه پیش‌فاکتور برای نوع پیش‌فاکتور و قطعی برای بقیه */
export function createdDocumentStatus(docType: string, status?: string | null): DocumentRecordStatus {
  if (status === 'draft' || status === 'proforma' || status === 'final') return status;
  return docType === 'proforma' ? 'proforma' : 'final';
}

/**
 * سند از این نوع با این `inOut` ثبت‌شدنی است: نوع جهت‌دار یا انبارگردانی، و `inOut` (اگر آمده) همان جهت نوع. انبارگردانی جهت
 * نوعی ندارد و `inOut` آن خوانده نمی‌شود.
 */
export function assertRecordableDocument(docType: string, inOut?: string | null): void {
  if (!isRecordableDocumentType(docType)) {
    throw new ValidationError(
      docType === 'transfer'
        ? 'انتقال بین انبارها فقط از صفحه «انتقال بین انبارها» ثبت می‌شود.'
        : `نوع سند «${docType}» از مسیر ثبت سند پذیرفته نمی‌شود.`,
      { docType },
      'DOCUMENT_TYPE_NOT_RECORDABLE',
    );
  }
  const expected = documentStockDirection(docType);
  if (expected === null || inOut === undefined || inOut === null || inOut === '') return;
  if (inOut !== expected) {
    throw new ValidationError(
      `جهت گردش کالا از نوع سند تعیین می‌شود: این نوع سند کالا را ${expected === 'in' ? 'وارد انبار' : 'از انبار خارج'} می‌کند، ولی جهت «${inOut}» فرستاده شده است.`,
      { docType, inOut, expected },
      'DOCUMENT_DIRECTION_MISMATCH',
    );
  }
}

/**
 * جهت گردش کالای سند، از نوع آن، در ثبت و نهایی‌سازی (فاکتور حاصل از پیش‌فاکتور خروج است). انبارگردانی جهت نوعی ندارد و
 * این تابع برای آن «خروج» برمی‌گرداند؛ ردیف‌های انبارگردانی جهت خود را از اختلاف شمارش می‌گیرند و مجوزش `audit.apply` است.
 */
export function stockDirectionOf(docType: string): DocumentStockDirection {
  return documentStockDirection(docType) ?? 'out';
}

/** مجوز ثبت سند تازه */
export function permissionToCreateDocument(input: { docType: string; status?: string | null }): string {
  return documentRecordPermission(input.docType, createdDocumentStatus(input.docType, input.status), stockDirectionOf(input.docType));
}

/** مجوز نهایی کردن سند ذخیره‌شده (از راه نهایی‌سازی یا گام تأیید گردش کار) */
export function permissionToFinalizeDocument(docType: string): string {
  return documentRecordPermission(docType, 'final', stockDirectionOf(docType));
}
