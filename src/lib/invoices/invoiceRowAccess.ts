import { WORKFLOW_WIDGET_PERMISSIONS } from '../recordReadPermissions';

/**
 * v9.0.291 (TD-795، یافته B08-26): هر دکمه ردیف فهرست اسناد با مجوز همان API‌ای نمایش داده می‌شود که صدا می‌زند؛ پیش‌تر
 * «تسویه سریع»، ویرایش توضیحات، «چرخه تأییدات» و «ابطال / حذف سند» برای هر خواننده فهرست بود و سرور ۴۰۳ می‌داد.
 * فقط برای نمایش است؛ سرور همان مجوز را خودش می‌سنجد. هر فهرست «یکی کافی است» است.
 */
export const INVOICE_ROW_ACTION_PERMISSIONS = {
  /** `POST /accounting/treasury` (فرم تسویه، در ردیف و در پنجره جزئیات) */
  settle: ['accounting.treasury'],
  /** `PUT /documents/:id/notes` */
  editNotes: ['documents.edit'],
  /** `DELETE /documents/:id` */
  void: ['documents.delete'],
  /** `GET /workflow/instance/document/:id` */
  workflow: WORKFLOW_WIDGET_PERMISSIONS,
} as const satisfies Record<string, readonly string[]>;

export type InvoiceRowAction = keyof typeof INVOICE_ROW_ACTION_PERMISSIONS;
export type InvoiceRowAccess = Record<InvoiceRowAction, boolean>;
