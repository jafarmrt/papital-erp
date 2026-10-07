/**
 * مجوزهای خواندن هر بخش — یک منبع برای گارد مسیرهای خواندن و برای دریافت فایل پیوست رکوردها
 * (GET /api/attachments/:id؛ هر کس رکورد را می‌بیند پیوست آن را هم می‌بیند). هر فهرست «یکی کافی است» است:
 * مجوز مشاهده همان بخش به‌علاوه مجوز فرم‌هایی که از آن فهرست انتخاب می‌گیرند.
 * v7.0.56 (audit P2-9): سندهای حسابداری، خزانه، چک و پروژه.
 * v7.0.59 (TD-223، تصمیم مالک محصول، فقط مجوزهای موجود): بقیه مسیرهای خواندن.
 */
export const READ_PERMISSIONS = {
  journalVouchers: ['accounting.vouchers', 'accounting.reports', 'accounting.view'],
  treasuryTransactions: ['accounting.treasury', 'accounting.reports', 'accounting.view'],
  cheques: ['accounting.cheques', 'accounting.treasury', 'accounting.reports', 'accounting.view'],
  projects: [
    'projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create',
    'warehouse.in', 'warehouse.out', 'warehouse.view'
  ],
  /** فهرست کامل طرف حساب‌ها (با یادداشت و نسخه رکورد) فقط با مجوز مشاهده همان بخش (v9.0.120، TD-887، ت۱۰ الف) */
  customers: ['customers.view'],
  /**
   * فهرست انتخاب طرف حساب (`GET /customers/options`): فاکتور و حواله (documents.create)، رسید انبار (warehouse.in،
   * documents.view)، ارتباط با مشتری، پروژه، خرید، نقطه سفارش (products.view، warehouse.view) و فرم‌های حسابداری.
   */
  customerOptions: [
    'customers.view', 'documents.view', 'documents.create', 'warehouse.in', 'warehouse.view', 'products.view', 'crm.view',
    'projects.view', 'procurement.view', 'accounting.view', 'accounting.reports', 'accounting.vouchers', 'accounting.treasury',
    'accounting.cheques',
  ],
  customersExport: ['customers.view'],
  /** کارت حساب و مانده طرف حساب (همان مجوزهای کارت حساب گزارش‌های مالی؛ v9.0.4، TD-416) */
  partyAccountCard: ['accounting.reports', 'accounting.view', 'customers.view', 'customers.manage'],
  documents: [
    'documents.view', 'documents.create', 'documents.edit', 'warehouse.view', 'warehouse.in', 'warehouse.out',
    'audit.view', 'crm.view', 'workflow.view'
  ],
  /**
   * فهرست کامل کالاها (با میانگین بها، نقطه سفارش، رزروها و نسخه رکورد) فقط با مجوزهای بخش کالا: صفحه کالاها، گالری و
   * قیمت‌گذاری (v9.0.121، TD-888، ت۱۰ الف)
   */
  items: ['products.view', 'products.edit_price'],
  /**
   * فهرست انتخاب کالا (`GET /items/options`، بی نقطه سفارش، رزرو و نسخه؛ میانگین بها فقط با products.view): فاکتور و حواله
   * (documents.create)، ورود و خروج انبار (documents.view، warehouse.in)، انبارگردانی (audit.view)، پروژه و انبار پروژه
   * (projects.view، warehouse.view)، خرید، ارتباط با مشتری و انتقال (products.view)
   */
  itemOptions: [
    'products.view', 'documents.view', 'documents.create', 'warehouse.view', 'warehouse.in', 'audit.view', 'projects.view',
    'crm.view', 'procurement.view',
  ],
  /** صفحه هشدار نقطه سفارش (همان کلیدهای صفحه در `PAGE_ACCESS`) */
  itemReorderAlerts: ['products.view', 'warehouse.view'],
  itemPrices: ['products.view', 'products.edit_price', 'projects.view'],
  personnel: [
    'personnel.view', 'personnel.manage', 'piecework.view', 'projects.view', 'accounting.view', 'crm.view',
    'documents.view', 'documents.create', 'warehouse.in'
  ],
  /**
   * کارکرد، تعرفه‌ها، عناوین و دسته‌های کارمزدی. `personnel.manage` همین‌ها را می‌نویسد (عناوین کاری در زبانه تنظیمات،
   * ثبت کارکرد) و پیش‌تر فهرستی را که ذخیره می‌کرد نمی‌خواند (v9.0.114، TD-668).
   */
  pieceworkReference: ['piecework.view', 'piecework.log', 'piecework.manage_tasks', 'projects.view', 'settings.manage', 'personnel.manage'],
  /** فیش‌های حقوق و کارمزد با مبالغ (فیش خود کاربر از /piecework/payrolls/mine) */
  payrolls: ['piecework.payroll', 'personnel.manage', 'accounting.treasury'],
  transfers: ['products.view'],
  pendingMaterials: ['pending_materials.view', 'products.view'],
  reservedItems: ['products.view', 'reports.view', 'warehouse.view', 'warehouse.in', 'documents.view', 'documents.create'],
  /** فهرست کامل کاربران و نقش‌ها (فهرست ساده نام‌ها /users/list-simple برای همه باز است) */
  userDirectory: ['users.manage', 'roles.manage', 'personnel.manage', 'workflow.manage', 'settings.manage'],
  permissionCatalog: ['roles.manage', 'users.manage'],
  /**
   * فهرست کامل حساب‌های خزانه با شماره حساب، کارت، شبا و مانده‌ها: همان خوانندگان تراکنش‌های خزانه (v9.0.97، TD-505،
   * تصمیم ت۷ الف؛ پیش‌تر کاربران انبار، اسناد، چک و سند حسابداری هم آن را می‌خواندند)
   */
  bankAccounts: ['accounting.treasury', 'accounting.reports', 'accounting.view'],
  /**
   * فهرست انتخاب حساب‌های خزانه (`/accounting/bank-accounts/options`، بی شماره و مانده): فرم تسویه فاکتور، دفتر چک،
   * سند حسابداری و پرداخت حقوق (`personnel.manage`، مجوز ثبت پرداخت فیش)
   */
  bankAccountOptions: [
    'accounting.treasury', 'accounting.cheques', 'accounting.vouchers', 'accounting.reports', 'accounting.view',
    'warehouse.in', 'warehouse.out', 'documents.view', 'documents.create', 'personnel.manage'
  ],
  /** درخواست‌های خرید (بی کد نقش؛ مدل مجوز بسته ۲) */
  purchaseRequisitions: ['procurement.view', 'projects.view'],
} as const satisfies Record<string, readonly string[]>;

/**
 * v9.0.38 (TD-458، تصمیم مالک محصول ت۹ الف): ویجت گردش کار (`GET /workflow/instance/:entityType/:entityId`) داده و
 * تاریخچه موجودیت را برمی‌گرداند، پس افزون بر مجوز گردش کار مجوز خواندن همان موجودیت را می‌خواهد؛ نوع بی دامنه (طرح
 * آزمایشی طراح) مجوز دیگری نمی‌خواهد.
 */
export const WORKFLOW_ENTITY_READ_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  document: READ_PERMISSIONS.documents,
  journal_voucher: READ_PERMISSIONS.journalVouchers,
  voucher: READ_PERMISSIONS.journalVouchers,
  item: READ_PERMISSIONS.items,
  bank_account: READ_PERMISSIONS.bankAccounts,
  purchase_requisition: READ_PERMISSIONS.purchaseRequisitions,
};

/** مجوز خواندن رکوردهای دارای پیوست (نوع رکورد در file_attachments) */
export const RECORD_READ_PERMISSIONS = {
  journal_voucher: READ_PERMISSIONS.journalVouchers,
  treasury_transaction: READ_PERMISSIONS.treasuryTransactions,
  cheque: READ_PERMISSIONS.cheques,
  production_project: READ_PERMISSIONS.projects,
  document: READ_PERMISSIONS.documents,
  piecework_payroll: READ_PERMISSIONS.payrolls,
} as const satisfies Record<string, readonly string[] | null>;

export type AttachmentEntityType = keyof typeof RECORD_READ_PERMISSIONS;

export const ATTACHMENT_ENTITY_TYPES = Object.keys(RECORD_READ_PERMISSIONS) as AttachmentEntityType[];
