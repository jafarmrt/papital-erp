/**
 * Standardized Query Key Factory for React Query.
 * Ensures hierarchical, type-safe, and consistent query keys across all domains.
 */

export const QUERY_KEYS = {
  // Customers
  customers: {
    all: ['customers'] as const,
    list: (params?: Record<string, any>) => ['customers', 'list', params ?? {}] as const,
    detail: (id: number) => ['customers', 'detail', id] as const,
  },

  // Inventory Items & Catalog
  items: {
    all: ['items'] as const,
    list: (params?: Record<string, any>) => ['items', 'list', params ?? {}] as const,
    detail: (id: number) => ['items', 'detail', id] as const,
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
    accounts: () => ['accounting', 'accounts'] as const,
    vouchers: (filters?: any) => ['accounting', 'vouchers', filters ?? {}] as const,
    cheques: (filters?: any) => ['accounting', 'cheques', filters ?? {}] as const,
    treasury: () => ['accounting', 'treasury'] as const,
  },

  // CRM
  crm: {
    all: ['crm'] as const,
    stats: () => ['crm', 'stats'] as const,
    leads: (filters?: any) => ['crm', 'leads', filters ?? {}] as const,
    activities: (filters?: any) => ['crm', 'activities', filters ?? {}] as const,
  },

  // Personnel & Payroll
  personnel: {
    all: ['personnel'] as const,
    list: () => ['personnel', 'list'] as const,
  },

  // Piecework & Work Logs
  piecework: {
    all: ['piecework'] as const,
    tasks: () => ['piecework', 'tasks'] as const,
    logs: (filters?: any) => ['piecework', 'logs', filters ?? {}] as const,
    payrolls: () => ['piecework', 'payrolls'] as const,
  },

  // Daily Logs
  dailyLogs: {
    all: ['daily-logs'] as const,
    list: (filters?: any) => ['daily-logs', 'list', filters ?? {}] as const,
    stats: () => ['daily-logs', 'stats'] as const,
  },

  // Workflow Engine
  workflow: {
    all: ['workflow'] as const,
    inbox: (params?: any) => ['workflow', 'inbox', params ?? {}] as const,
    instance: (entityType: string, entityId: string | number) => ['workflow', 'instance', entityType, String(entityId)] as const,
  },

  // V9 Phase 5.1 — Documents & Invoices
  documents: {
    all: ['documents'] as const,
    list: (filters?: any) => ['documents', 'list', filters ?? {}] as const,
    detail: (id: number) => ['documents', 'detail', id] as const,
  },

  // V9 Phase 5.1 — Activity / Audit Logs
  activityLogs: {
    all: ['activity-logs'] as const,
    list: (filters?: any) => ['activity-logs', 'list', filters ?? {}] as const,
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
    list: (filters?: any) => ['transactions', 'list', filters ?? {}] as const,
  },

  // V9 Phase 5.1 — Item Pricing
  prices: {
    all: ['prices'] as const,
    byItem: (itemId?: number | null) => ['prices', 'by-item', itemId ?? 'none'] as const,
  },
} as const;

export type QueryDomain = keyof typeof QUERY_KEYS;

// Aliases for blueprint compatibility
export const queryKeys = QUERY_KEYS;
export const settingsKeys = QUERY_KEYS.settings;
export const customerKeys = QUERY_KEYS.customers;
export const itemKeys = QUERY_KEYS.items;
export const personnelKeys = QUERY_KEYS.personnel;
