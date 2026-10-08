import {
  documentRecordPermission,
  type DocumentRecordStatus,
  type DocumentStockDirection,
} from '../../lib/permissions/documentPermissions.js';
import { documentStockDirection, isRecordableDocumentType } from '../../lib/documents/documentDirection.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isAutoRefNumber, isServerSeriesDocumentType } from '../../lib/documents/documentRefRules.js';
import { documentTypeTitle } from '../../lib/documents/documentTypeTitles.js';

/**
 * v9.0.125 (TD-541 / TD-771): وضعیت و جهت سندی که ثبت یا نهایی می‌شود، با همان قاعده‌ای که `createDocumentWithDetails` و
 * `finalizeDocument` به کار می‌برند، و مجوزی که جدول `documentRecordPermission` برای آن می‌خواهد. مسیرها و گام تأیید
 * گردش کار مجوز را از همین‌جا می‌گیرند تا با رفتار سرویس یکی بماند.
 *
 * v9.0.238 (TD-770، تصمیم ت۲ «الف» بسته ۸): جهت گردش فقط از نوع سند (`documentStockDirection`)، در ثبت و نهایی‌سازی؛
 * `inOut` ناسازگار با نوع ۴۲۲ است (نه نادیده) تا فراخواننده‌ای که جهت دیگری می‌فرستد خطایش را ببیند، انتقال بین انبارها
 * از مسیر ثبت سند پذیرفته نمی‌شود، و نوع ناشناخته فقط سربرگ بی‌ردیف است (کالایی جابه‌جا نمی‌کند؛ route فقط نوع‌های ثبت‌شدنی
 * را می‌پذیرد و آزمون‌های شماره‌گذاری سری جدا را با سربرگ نوع ساختگی می‌سازند).
 */

/** وضعیت سند تازه: وضعیت فرستاده‌شده، وگرنه پیش‌فاکتور برای نوع پیش‌فاکتور و قطعی برای بقیه */
export function createdDocumentStatus(docType: string, status?: string | null): DocumentRecordStatus {
  if (status === 'draft' || status === 'proforma' || status === 'final') return status;
  return docType === 'proforma' ? 'proforma' : 'final';
}

/**
 * سند از این نوع با این `inOut` ثبت‌شدنی است: نوع جهت‌دار یا انبارگردانی، و `inOut` (اگر آمده) همان جهت نوع. انبارگردانی جهت
 * نوعی ندارد و `inOut` آن خوانده نمی‌شود. انتقال هرگز پذیرفته نمی‌شود؛ نوع ناشناخته فقط وقتی سند ردیف ندارد (`hasLines`
 * false)، چون ردیفش جهت گردش و سند حسابداری ندارد.
 */
export function assertRecordableDocument(docType: string, inOut?: string | null, hasLines = true): void {
  if (docType === 'transfer' || (hasLines && !isRecordableDocumentType(docType))) {
    throw new ValidationError(
      docType === 'transfer'
        ? 'انتقال بین انبارها فقط از صفحه «انتقال بین انبارها» ثبت می‌شود.'
        : `نوع سند «${docType}» جهت گردش کالا ندارد و ردیف کالا نمی‌پذیرد.`,
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
 * v9.0.327 (TD-783، یافته B08-14، تصمیم ت۹ «الف» بسته ۸): شماره فاکتور فروش و برگشت از فروش فقط از سری سرور است؛ شماره
 * دستی برای این دو نوع در ثبت و ویرایش ۴۲۲ `DOCUMENT_REF_SERVER_SERIES` است (`refNumber` باید خالی یا «auto» باشد).
 */
export function assertManualRefAllowed(docType: string, requested: unknown): void {
  if (!isServerSeriesDocumentType(docType) || isAutoRefNumber(requested)) return;
  throw new ValidationError(
    `شماره ${documentTypeTitle(docType)} فقط از سری فاکتورهای سرور داده می‌شود و دستی نوشته یا عوض نمی‌شود؛ شماره را خالی بگذارید.`,
    { docType, refNumber: requested ?? null },
    'DOCUMENT_REF_SERVER_SERIES',
  );
}

/**
 * v9.0.325 (TD-780، یافته B08-11، تصمیم ت۷ «الف» بسته ۸): رسید تولید فقط از «ورود به انبار» پروژه ثبت می‌شود
 * (`ProjectService.addProjectToInventory`، TD-285)، جایی که پروژه، سقف مقدار برنامه با دلیل (TD-327) و بهای تحویل سنجیده
 * می‌شود. `POST /documents` و نهایی‌سازی رسید تولید پیش‌نویس آن را ۴۲۲ می‌دهند؛ پیش‌تر از این مسیر رسید تولید بی پروژه،
 * فراتر از برنامه و روی پروژه لغوشده ثبت می‌شد و کالای در جریان ساخت بی پروژه بستانکار می‌شد.
 */
export function assertNotProjectDelivery(docType: string, refNumber?: string | null): void {
  if (docType !== 'production_receipt') return;
  throw new ValidationError(
    `${refNumber ? `رسید تولید «${refNumber}» قطعی نمی‌شود؛ ` : ''}رسید تولید فقط از «ورود به انبار» همان پروژه ثبت می‌شود تا پروژه، سقف مقدار برنامه و بهای تحویل سنجیده شود.`,
    { docType },
    'PRODUCTION_RECEIPT_PROJECT_ONLY',
  );
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
