/**
 * مجوزهای خواندن هر بخش — یک منبع برای گارد مسیرهای خواندن و برای دریافت فایل پیوست رکوردها
 * (GET /api/attachments/:id؛ هر کس رکورد را می‌بیند پیوست آن را هم می‌بیند). هر فهرست «یکی کافی است» است:
 * مجوز مشاهده همان بخش به‌علاوه مجوز فرم‌هایی که از آن فهرست انتخاب می‌گیرند.
 * v7.0.56 (audit P2-9): سندهای حسابداری، خزانه، چک و پروژه.
 * v7.0.59 (TD-223، تصمیم مالک محصول، فقط مجوزهای موجود): بقیه مسیرهای خواندن.
 */
/**
 * خوانندگان مبالغ حقوق (فیش، پرداخت و مانده مساعده). v9.0.320 (TD-805): پرداخت‌کننده فیش (`piecework.pay`) فیشی را که
 * پرداخت می‌کند می‌بیند.
 */
const PAYROLL_AMOUNT_READERS = ['piecework.payroll', 'piecework.pay', 'personnel.manage', 'accounting.treasury'] as const;

export const READ_PERMISSIONS = {
  journalVouchers: ['accounting.vouchers', 'accounting.reports', 'accounting.view'],
  treasuryTransactions: ['accounting.treasury', 'accounting.reports', 'accounting.view'],
  cheques: ['accounting.cheques', 'accounting.treasury', 'accounting.reports', 'accounting.view'],
  /**
   * فهرست کامل پروژه‌ها (با محصولات، کنترل موجودی و رزرو، مراحل و پیوست‌ها) فقط با مجوز بخش پروژه (v9.0.139، TD-889،
   * ت۱۰ الف؛ پیش‌تر کلیدهای سند و انبار هم آن را باز می‌کردند)
   */
  projects: ['projects.view'],
  /**
   * پرونده یک پروژه (`GET /projects/:id`) و پیوست‌های آن: بخش پروژه و صفحه «انبار پروژه» (`warehouse.view`، کنترل
   * موجودی پروژه)
   */
  projectRecord: ['projects.view', 'warehouse.view'],
  /**
   * فهرست انتخاب پروژه (`GET /projects/options`، شناسه، کد، عنوان، وضعیت و نام مشتری): سند ورود و خروج انبار
   * (documents.view، documents.create، warehouse.in)، انبار پروژه و تخصیص مواد اولیه (warehouse.view، warehouse.out)،
   * کارکرد کارمزدی (piecework.view، piecework.log)، گزارش روزانه (daily_logs.view، daily_logs.create) و تفصیلی پروژه در
   * سند حسابداری دستی و اصلاحی (accounting.vouchers، v9.0.193، TD-569). v9.0.277 (B16-04): هر کلیدی که صفحه «ورود و خروج
   * انبار» را باز می‌کند (`documents.finalize` هم) فهرست‌های انتخاب آن صفحه را هم می‌خواند.
   */
  projectOptions: [
    'projects.view', 'documents.view', 'documents.create', 'documents.finalize', 'warehouse.view', 'warehouse.in', 'warehouse.out',
    'piecework.view', 'piecework.log', 'daily_logs.view', 'daily_logs.create', 'accounting.vouchers',
  ],
  /** فهرست کامل طرف حساب‌ها (با یادداشت و نسخه رکورد) فقط با مجوز مشاهده همان بخش (v9.0.137، TD-887، ت۱۰ الف) */
  customers: ['customers.view'],
  /**
   * فهرست انتخاب طرف حساب (`GET /customers/options`): فاکتور و حواله (documents.create)، رسید انبار (warehouse.in،
   * documents.view)، ارتباط با مشتری، پروژه، خرید، نقطه سفارش (products.view، warehouse.view) و فرم‌های حسابداری.
   * v9.0.277 (B16-04): کلیدهای صفحه «ورود و خروج انبار» (warehouse.out، documents.finalize) هم.
   */
  customerOptions: [
    'customers.view', 'documents.view', 'documents.create', 'documents.finalize', 'warehouse.in', 'warehouse.out', 'warehouse.view', 'products.view', 'crm.view',
    'projects.view', 'procurement.view', 'accounting.view', 'accounting.reports', 'accounting.vouchers', 'accounting.treasury',
    'accounting.cheques',
  ],
  customersExport: ['customers.view'],
  /** کارت حساب و مانده طرف حساب (همان مجوزهای کارت حساب گزارش‌های مالی؛ v9.0.4، TD-416) */
  partyAccountCard: ['accounting.reports', 'accounting.view', 'customers.view', 'customers.manage'],
  /**
   * فهرست کامل اسناد (با مبالغ و طرف حساب) فقط با مجوز بخش اسناد: فهرست فاکتورها و فرم فاکتور (v9.0.140، TD-890، ت۱۰ الف؛
   * پیش‌تر کلیدهای انبار، انبارگردانی، ارتباط با مشتری و گردش کار هم آن را باز می‌کردند)
   */
  documents: ['documents.view', 'documents.create', 'documents.edit'],
  /**
   * صفحه انبارگردانی: فهرست و پرونده فقط سندهای شمارش و انتقال (`STOCK_COUNT_PAGE_DOCUMENT_TYPES` در
   * `src/services/documents/documentReadScope.ts`)
   */
  stockCountDocuments: ['audit.view'],
  /** پرونده یک سند و پیوست‌هایش: بخش اسناد و کارتابل تأیید (`workflow.view`) */
  documentRecord: ['documents.view', 'documents.create', 'documents.edit', 'workflow.view'],
  /**
   * شماره بعدی سند (`/documents/next-ref`): فرم‌هایی که سند ثبت می‌کنند — فاکتور و حواله، رسید و حواله انبار، انبارگردانی
   * و انتقال بین انبارها (v9.0.277، B16-04: `documents.finalize` که صفحه ورود و خروج انبار را باز می‌کند)
   */
  documentNextRef: [
    'documents.view', 'documents.create', 'documents.edit', 'documents.finalize', 'warehouse.in', 'warehouse.out', 'warehouse.transfer', 'audit.view',
  ],
  /** برگه شمارش انبارگردانی (`/documents/audit-items`، موجودی دفتری هر کالا) */
  stockCountSheet: ['audit.view'],
  /** اسناد فروش یک طرف حساب در پرونده او (`/customers/:id/documents`): صفحه اسناد، طرف حساب‌ها و ارتباط با مشتری */
  partyDocuments: ['documents.view', 'customers.view', 'crm.view'],
  /**
   * فهرست کامل کالاها (با میانگین بها، نقطه سفارش، رزروها و نسخه رکورد) فقط با مجوزهای بخش کالا: صفحه کالاها، گالری و
   * قیمت‌گذاری (v9.0.138، TD-888، ت۱۰ الف)
   */
  items: ['products.view', 'products.edit_price'],
  /**
   * فهرست انتخاب کالا (`GET /items/options`، بی نقطه سفارش، رزرو و نسخه؛ میانگین بها فقط با products.view): فاکتور و حواله
   * (documents.create)، ورود و خروج انبار (documents.view، warehouse.in)، انبارگردانی (audit.view)، پروژه و انبار پروژه
   * (projects.view، warehouse.view)، خرید، ارتباط با مشتری و انتقال (products.view). v9.0.277 (B16-04): کلیدهای صفحه
   * «ورود و خروج انبار» (warehouse.out، documents.finalize) هم.
   */
  itemOptions: [
    'products.view', 'documents.view', 'documents.create', 'documents.finalize', 'warehouse.view', 'warehouse.in', 'warehouse.out',
    'audit.view', 'projects.view', 'crm.view', 'procurement.view',
  ],
  /** صفحه هشدار نقطه سفارش (همان کلیدهای صفحه در `PAGE_ACCESS`) */
  itemReorderAlerts: ['products.view', 'warehouse.view'],
  /**
   * همه قیمت‌های همه کالاها و تاریخچه قیمت فقط با مجوز بخش کالا: صفحه قیمت‌گذاری (v9.0.141، TD-891؛ پیش‌تر مشاهده پروژه هم
   * آن را باز می‌کرد، برای فهرستی که پنجره پروژه می‌خواند و به کار نمی‌برد)
   */
  itemPrices: ['products.view', 'products.edit_price'],
  /** فهرست قیمت فروش یک کالا (`/items/:id/prices`): صفحه قیمت‌گذاری و فرم فاکتور و حواله که قیمت را از آن پیشنهاد می‌کند */
  itemSalePrices: ['products.view', 'products.edit_price', 'documents.create', 'documents.edit'],
  personnel: [
    'personnel.view', 'personnel.manage', 'piecework.view', 'projects.view', 'accounting.view', 'crm.view',
    'documents.view', 'documents.create', 'warehouse.in'
  ],
  /**
   * کارکرد، تعرفه‌ها، عناوین و دسته‌های کارمزدی. `personnel.manage` پیش‌تر همین‌ها را می‌نوشت و فهرستی را که ذخیره می‌کرد
   * نمی‌خواند (v9.0.131، TD-668)؛ از v9.0.320 (TD-805) نوشتن آن‌ها با `piecework.manage_tasks` است و `personnel.manage` فقط می‌خواند.
   */
  pieceworkReference: ['piecework.view', 'piecework.log', 'piecework.manage_tasks', 'projects.view', 'settings.manage', 'personnel.manage'],
  /**
   * کارکرد همه پرسنل با نرخ و مبلغ (`GET /piecework/logs`) فقط برای صفحه کارمزدی و مدیر پرسنل (v9.0.142، TD-892؛ پیش‌تر
   * مشاهده پروژه و مدیریت تنظیمات هم کارکرد همه پرسنل را می‌خواندند). ویرایش و حذف کارکرد از v9.0.320 (TD-805) با `piecework.log` است.
   */
  pieceworkLogs: ['piecework.view', 'piecework.log', 'personnel.manage'],
  /** کارکردهای یک پروژه (`GET /piecework/logs?projectId=`، زبانه زمان‌بندی پروژه) */
  projectPieceworkLogs: ['projects.view'],
  /**
   * نرخ‌های اختصاصی یک پرسنل (`GET /piecework/personnel-rates/:id`): فرم ثبت کارکرد، زبانه نرخ‌ها (نویسنده آن
   * `piecework.manage_tasks`) و خوانندگان مبالغ حقوق؛ مشاهده پروژه و مدیریت تنظیمات فقط عنوان‌ها و دسته‌ها را می‌خوانند
   * (v9.0.321، TD-806، B12P-03، تصمیم ت۳ «الف»)
   */
  pieceworkRates: ['piecework.view', 'piecework.log', 'piecework.manage_tasks', ...PAYROLL_AMOUNT_READERS],
  /** فیش‌های حقوق و کارمزد با مبالغ (فیش خود کاربر از /piecework/payrolls/mine) */
  payrolls: [...PAYROLL_AMOUNT_READERS],
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
   * سند حسابداری و پرداخت حقوق (`piecework.pay`، مجوز ثبت پرداخت فیش؛ تا v9.0.319 `personnel.manage`، TD-805)
   */
  bankAccountOptions: [
    'accounting.treasury', 'accounting.cheques', 'accounting.vouchers', 'accounting.reports', 'accounting.view',
    'warehouse.in', 'warehouse.out', 'documents.view', 'documents.create', 'piecework.pay'
  ],
  /** درخواست‌های خرید (بی کد نقش؛ مدل مجوز بسته ۲) */
  purchaseRequisitions: ['procurement.view', 'projects.view'],
  /**
   * سفارش‌های خرید تدارکات (`GET /procurement/orders`): همان خوانندگان درخواست خرید، چون فهرست فقط سفارش‌هایی را دارد که
   * برای درخواستی صادر شده‌اند (v9.0.347، TD-691، ت۲)؛ پیش‌تر هر رسید انبار با قیمت و تأمین‌کننده در آن بود
   */
  procurementOrders: ['procurement.view', 'projects.view'],
} as const satisfies Record<string, readonly string[]>;

/**
 * v9.0.340 (TD-795): گارد ویجت گردش کار یک موجودیت (`GET /workflow/instance/:entityType/:entityId`)؛ دکمه «چرخه تأییدات و
 * گردش کار» فهرست اسناد با همین کلیدها نمایش داده می‌شود.
 */
export const WORKFLOW_WIDGET_PERMISSIONS = ['workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'] as const;

/**
 * v9.0.38 (TD-458، تصمیم مالک محصول ت۹ الف): ویجت گردش کار (`GET /workflow/instance/:entityType/:entityId`) داده و
 * تاریخچه موجودیت را برمی‌گرداند، پس افزون بر مجوز گردش کار مجوز خواندن همان موجودیت را می‌خواهد؛ نوع بی دامنه (طرح
 * آزمایشی طراح) مجوز دیگری نمی‌خواهد.
 */
export const WORKFLOW_ENTITY_READ_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  document: READ_PERMISSIONS.documentRecord,
  journal_voucher: READ_PERMISSIONS.journalVouchers,
  voucher: READ_PERMISSIONS.journalVouchers,
  item: READ_PERMISSIONS.items,
  bank_account: READ_PERMISSIONS.bankAccounts,
  purchase_requisition: READ_PERMISSIONS.purchaseRequisitions,
  // v9.0.379 (TD-826): the widget of the raw material request queue
  pending_material: READ_PERMISSIONS.pendingMaterials,
};

/** مجوز خواندن رکوردهای دارای پیوست (نوع رکورد در file_attachments) */
export const RECORD_READ_PERMISSIONS = {
  journal_voucher: READ_PERMISSIONS.journalVouchers,
  treasury_transaction: READ_PERMISSIONS.treasuryTransactions,
  cheque: READ_PERMISSIONS.cheques,
  production_project: READ_PERMISSIONS.projectRecord,
  document: READ_PERMISSIONS.documentRecord,
  piecework_payroll: READ_PERMISSIONS.payrolls,
} as const satisfies Record<string, readonly string[] | null>;

export type AttachmentEntityType = keyof typeof RECORD_READ_PERMISSIONS;

export const ATTACHMENT_ENTITY_TYPES = Object.keys(RECORD_READ_PERMISSIONS) as AttachmentEntityType[];
