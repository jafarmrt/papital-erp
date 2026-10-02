/**
 * v7.0.56 (audit P2-9): مجوزهای خواندن هر نوع رکورد دارای پیوست — یک منبع برای گارد مسیرهای خواندن همان رکورد
 * و برای دریافت فایل پیوست آن (GET /api/attachments/:id)؛ هر کس رکورد را می‌بیند پیوست آن را هم می‌بیند.
 * `null` یعنی مسیر خواندن آن رکورد هنوز فقط احراز هویت دارد (TD-223: نگاشت مسیر به مجوز در انتظار تصمیم مالک محصول).
 */
export const RECORD_READ_PERMISSIONS = {
  journal_voucher: ['accounting.vouchers', 'accounting.reports', 'accounting.view'],
  treasury_transaction: ['accounting.treasury', 'accounting.reports', 'accounting.view'],
  cheque: ['accounting.cheques', 'accounting.treasury', 'accounting.reports', 'accounting.view'],
  production_project: [
    'projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create',
    'warehouse.in', 'warehouse.out', 'warehouse.view'
  ],
  document: null,
  piecework_payroll: null,
} as const satisfies Record<string, readonly string[] | null>;

export type AttachmentEntityType = keyof typeof RECORD_READ_PERMISSIONS;

export const ATTACHMENT_ENTITY_TYPES = Object.keys(RECORD_READ_PERMISSIONS) as AttachmentEntityType[];
