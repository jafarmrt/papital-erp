/**
 * Standardized Query Key Factory for React Query.
 * Ensures hierarchical, type-safe, and consistent query keys across all domains.
 */

export const QUERY_KEYS = {
  // Customers
  customers: {
    all: ['customers'] as const,
    list: (params?: Record<string, unknown> | object) => ['customers', 'list', params ?? {}] as const,
    detail: (id: number) => ['customers', 'detail', id] as const,
  },

  // Inventory Items & Catalog
  items: {
    all: ['items'] as const,
    list: (params?: Record<string, unknown> | object) => ['items', 'list', params ?? {}] as const,
    detail: (id: number) => ['items', 'detail', id] as const,
    // صفحه نقطه سفارش (GET /items/reorder-alerts): زیر items تا ذخیره کالا و هر تغییر موجودی (preset inventoryChange) تازه‌اش کند
    reorderAlerts: () => ['items', 'reorder-alerts'] as const,
  },

  // Transfers
  transfers: {
    all: ['transfers'] as const,
    list: () => ['transfers', 'list'] as const,
    detail: (code: string) => ['transfers', 'detail', code] as const,
  },

  // Pending Raw Materials
  pendingMaterials: {
    all: ['pending-materials'] as const,
    list: () => ['pending-materials', 'list'] as const,
  },

  // Notifications
  notifications: {
    all: ['notifications'] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
    list: () => ['notifications', 'list'] as const,
  },

  // Settings
  settings: {
    all: ['settings'] as const,
    list: () => ['settings', 'list'] as const,
  },

  // Dashboard & BI Statistics
  dashboard: {
    all: ['stats'] as const,
    general: () => ['stats', 'general'] as const,
    bi: () => ['stats', 'bi'] as const,
  },

  // Categories
  categories: {
    all: ['categories'] as const,
    list: (type?: string) => ['categories', 'list', type ?? 'all'] as const,
  },

  // Warehouses
  warehouses: {
    all: ['warehouses'] as const,
    list: () => ['warehouses', 'list'] as const,
  },

  // تدارکات: درخواست‌های خرید و سفارش‌ها (صفحه نقطه سفارش درخواست خرید ثبت می‌کند)
  procurement: {
    all: ['procurement'] as const,
  },

  // Projects & Production
  projects: {
    all: ['projects'] as const,
    list: () => ['projects', 'list'] as const,
    detail: (id: number) => ['projects', 'detail', id] as const,
  },

  // Accounting
  accounting: {
    all: ['accounting'] as const,
    summary: () => ['accounting', 'summary'] as const,
    // پیشوند فهرست و درخت حساب‌ها
    accounts: () => ['accounting', 'accounts'] as const,
    accountsList: () => ['accounting', 'accounts', 'list'] as const,
    accountsTree: () => ['accounting', 'accounts', 'tree'] as const,
    // vouchers() / cheques() بدون فیلتر ({}) پیشوند همه فهرست‌های فیلترشده هم هست
    vouchers: (filters?: Record<string, unknown> | object) => ['accounting', 'vouchers', filters ?? {}] as const,
    voucherDetail: (id: number) => ['accounting', 'voucher-detail', id] as const,
    cheques: (filters?: Record<string, unknown> | object) => ['accounting', 'cheques', filters ?? {}] as const,
    // پیشوند حساب‌های بانکی و تراکنش‌های خزانه
    treasury: () => ['accounting', 'treasury'] as const,
    bankAccounts: () => ['accounting', 'treasury', 'bank-accounts'] as const,
    /** v9.0.97 (TD-505): زیر کلید فهرست کامل، پس هر باطل‌سازی آن این را هم تازه می‌کند */
    bankAccountOptions: () => ['accounting', 'treasury', 'bank-accounts', 'options'] as const,
    treasuryTransactions: () => ['accounting', 'treasury', 'transactions'] as const,
    // v9.0.82 (TD-507): سرفصل‌های مجاز طرف مقابل «متفرقه» و «سایر» (زیر پیشوند خزانه، چون سرفصل بانک‌ها کنار می‌رود)
    contraAccounts: () => ['accounting', 'treasury', 'contra-accounts'] as const,
    // گزارش‌های مالی (تراز آزمایشی، دفتر کل، صورت‌ها، جریان نقد، ...): پارامترها بخشی از کلیدند
    reports: () => ['accounting', 'reports'] as const,
    report: (kind: string, params?: Record<string, unknown> | object) => ['accounting', 'reports', kind, params ?? {}] as const,
    fiscalClosingPreview: (params: Record<string, unknown> | object) => ['accounting', 'fiscal-closing', params] as const,
  },

  // CRM
  crm: {
    all: ['crm'] as const,
    stats: () => ['crm', 'stats'] as const,
    leads: (filters?: Record<string, unknown> | object) => ['crm', 'leads', filters ?? {}] as const,
    activities: (filters?: Record<string, unknown> | object) => ['crm', 'activities', filters ?? {}] as const,
  },

  // Personnel & Payroll
  personnel: {
    all: ['personnel'] as const,
    list: () => ['personnel', 'list'] as const,
    // فهرست انتخاب پرسنل با پارامترهای درخواست (مثلاً GET /personnel?limit=1000 صفحه حسابداری)
    lookup: (params: Record<string, unknown> | object) => ['personnel', 'list', params] as const,
  },

  // Piecework & Work Logs
  piecework: {
    all: ['piecework'] as const,
    tasks: () => ['piecework', 'tasks'] as const,
    logs: (filters?: Record<string, unknown> | object) => ['piecework', 'logs', filters ?? {}] as const,
    payrolls: () => ['piecework', 'payrolls'] as const,
  },

  // Daily Logs
  dailyLogs: {
    all: ['daily-logs'] as const,
    list: (filters?: Record<string, unknown> | object) => ['daily-logs', 'list', filters ?? {}] as const,
    stats: () => ['daily-logs', 'stats'] as const,
  },

  // Workflow Engine
  workflow: {
    all: ['workflow'] as const,
    inbox: (params?: Record<string, unknown> | object) => ['workflow', 'inbox', params ?? {}] as const,
    instance: (entityType: string, entityId: string | number) => ['workflow', 'instance', entityType, String(entityId)] as const,
    // TD-469: فهرست، جزئیات و نسخه‌های تعریف زیر یک پیشوند، تا ذخیره طرح یا مختصات همه را تازه کند
    definitions: () => ['workflow', 'definitions'] as const,
    definition: (id: number | undefined) => ['workflow', 'definitions', 'detail', id ?? 0] as const,
    definitionVersions: (id: number | undefined) => ['workflow', 'definitions', 'versions', id ?? 0] as const,
  },

  // V9 Phase 5.1 — Documents & Invoices
  documents: {
    all: ['documents'] as const,
    list: (filters?: Record<string, unknown> | object) => ['documents', 'list', filters ?? {}] as const,
    detail: (id: number) => ['documents', 'detail', id] as const,
    // صفحه صدور فاکتور: شماره بعدی سند و پیش‌فاکتورهای باز (زیر documents تا ابطال دامنه اسناد آن‌ها را هم تازه کند)
    nextRef: (type: string) => ['documents', 'next-ref', type] as const,
    openProformas: () => ['documents', 'open-proformas'] as const,
  },

  // رزرو موجودی (پیش‌فاکتورها و پروژه‌ها) — فرم رسید/حواله انبار
  inventory: {
    all: ['inventory'] as const,
    reservedItems: () => ['inventory', 'reserved-items'] as const,
    // صفحه انبارگردانی: گزارش سلامت سه‌طرفه و اقلام شمارش یک انبار (زیر inventory تا هر تغییر موجودی تازه‌شان کند)
    integrityAudit: () => ['inventory', 'integrity-audit'] as const,
    auditItems: (location: string) => ['inventory', 'audit-items', location] as const,
  },

  // V9 Phase 5.1 — Activity / Audit Logs
  activityLogs: {
    all: ['activity-logs'] as const,
    list: (filters?: Record<string, unknown> | object) => ['activity-logs', 'list', filters ?? {}] as const,
    filters: () => ['activity-logs', 'filter-options'] as const,
  },

  // V9 Phase 5.1 — Users, Roles & Permissions Catalog
  users: {
    all: ['users'] as const,
    list: () => ['users', 'list'] as const,
    detail: (id: number) => ['users', 'detail', id] as const,
  },
  roles: {
    all: ['roles'] as const,
    list: () => ['roles', 'list'] as const,
  },
  permissions: {
    all: ['permissions'] as const,
    catalog: () => ['permissions', 'catalog'] as const,
  },

  // V9 Phase 5.1 — Warehouse Transactions (Kardex)
  transactions: {
    all: ['transactions'] as const,
    list: (filters?: Record<string, unknown> | object) => ['transactions', 'list', filters ?? {}] as const,
    // کاردکس تفصیلی یک کالا (مودال کاردکس صفحه کاردکس و انبارگردانی): زیر transactions تا هر ابطال کاردکس تازه‌اش کند
    itemKardex: (itemId: number) => ['transactions', 'item-kardex', itemId] as const,
  },

  // V9 Phase 5.1 — Item Pricing
  prices: {
    all: ['prices'] as const,
    byItem: (itemId?: number | null) => ['prices', 'by-item', itemId ?? 'none'] as const,
  },

  // Domain Events & Outbox
  events: {
    all: ['events'] as const,
    list: (filter?: string) => ['events', 'list', filter ?? 'ALL'] as const,
    outbox: (status?: string) => ['events', 'outbox', status ?? 'ALL'] as const,
    outboxStats: () => ['events', 'outbox-stats'] as const,
    actionRules: () => ['events', 'action-rules'] as const,
    actionLogs: (limit?: number) => ['events', 'action-logs', limit ?? 50] as const,
    actionStats: () => ['events', 'action-stats'] as const,
  },
} as const;

export type QueryDomain = keyof typeof QUERY_KEYS;

// Aliases for blueprint compatibility
export const queryKeys = QUERY_KEYS;
export const settingsKeys = QUERY_KEYS.settings;
export const customerKeys = QUERY_KEYS.customers;
export const itemKeys = QUERY_KEYS.items;
export const personnelKeys = QUERY_KEYS.personnel;
