import { isSystemAdminRole } from './permissionCatalog';

/**
 * v9.0.114 (TD-668، یافته B16-04، تصمیم ت۲ الف بسته ۱۶): جدول یکتای دسترسی صفحه‌ها و زبانه‌های تنظیمات. منو، مسیر صفحه
 * (`ProtectedRoute`)، میانبرهای پیشخوان، زبانه‌های تنظیمات و زبانه‌های صفحه حسابداری فقط از این جدول می‌خوانند، و
 * آزمون `sec_page_access_matches_api_td_668` هر کلید هر صفحه را با گارد API اصلی همان صفحه می‌سنجد: کلیدی که صفحه را باز
 * می‌کند باید از گارد همه APIهای اصلی آن بگذرد (صفحه‌ای که باز شود و داده‌اش ۴۰۳ بدهد دیگر ساخته نمی‌شود).
 * صفحه تازه ردیفی در این جدول با API اصلی‌اش می‌گیرد.
 */

/** چه کسی باز می‌کند: یکی از کلیدها، فقط مدیر سیستم، یا هر کاربر واردشده */
export type PageGate = { readonly anyOf: readonly string[] } | 'system_admin' | 'login';

export interface PageAccessRule {
  readonly gate: PageGate;
  /** API اصلی صفحه به شکل «METHOD /api/path» همان‌طور که در روتر Express آمده؛ صفحه بی API (ایستا) فهرست خالی دارد */
  readonly api: readonly string[];
}

export interface ViewerAccess {
  permissions?: readonly string[] | null;
  isAdmin?: boolean | null;
  role?: string | null;
}

const anyOf = (...keys: string[]): { readonly anyOf: readonly string[] } => ({ anyOf: keys });

/** زبانه‌های صفحه تنظیمات؛ هر زبانه با API ذخیره (و خواندن) خودش */
export const SETTINGS_TAB_ACCESS = {
  general: { gate: anyOf('settings.manage'), api: ['GET /api/settings', 'POST /api/settings'] },
  pricing: { gate: anyOf('settings.manage'), api: ['GET /api/settings', 'POST /api/settings'] },
  accounting: { gate: anyOf('accounting.coa'), api: ['GET /api/accounting/mappings', 'POST /api/accounting/mappings', 'GET /api/accounting/accounts'] },
  chart_of_accounts: { gate: anyOf('accounting.coa'), api: ['GET /api/accounting/accounts/tree', 'POST /api/accounting/accounts'] },
  categories: { gate: anyOf('products.create', 'products.edit'), api: ['GET /api/categories', 'POST /api/categories'] },
  warehouses: { gate: anyOf('warehouse.manage'), api: ['GET /api/warehouses', 'POST /api/warehouses'] },
  inventory_integrity: { gate: anyOf('inventory.reconcile'), api: ['GET /api/inventory/negative-stock-policy', 'PUT /api/inventory/negative-stock-policy'] },
  inventory_control: { gate: anyOf('settings.manage'), api: ['GET /api/settings', 'POST /api/settings'] },
  projects: { gate: anyOf('settings.manage'), api: ['GET /api/settings', 'POST /api/settings', 'GET /api/piecework/tasks'] },
  task_titles: { gate: anyOf('personnel.manage'), api: ['GET /api/piecework/tasks', 'POST /api/piecework/tasks'] },
  woocommerce: { gate: anyOf('woocommerce.view'), api: ['GET /api/woocommerce/synced-orders', 'GET /api/woocommerce/order-logs'] },
  health: { gate: 'system_admin', api: ['GET /api/system/health'] },
  system_config: { gate: 'system_admin', api: [] },
  system: { gate: 'system_admin', api: [] },
} as const satisfies Record<string, PageAccessRule>;

export type SettingsTabId = keyof typeof SETTINGS_TAB_ACCESS;

/** صفحه تنظیمات برای کسی باز است که دست‌کم یک زبانه‌اش را باز می‌کند */
const SETTINGS_PAGE_KEYS = [...new Set(Object.values(SETTINGS_TAB_ACCESS).flatMap(r => (typeof r.gate === 'object' ? r.gate.anyOf : [])))];

const ACCOUNTING_TABS = {
  '/accounting/dashboard': { gate: anyOf('accounting.view'), api: ['GET /api/accounting/summary'] },
  '/accounting/explorer': { gate: anyOf('accounting.reports'), api: ['GET /api/accounting/accounts/tree'] },
  '/accounting/vouchers': { gate: anyOf('accounting.vouchers'), api: ['GET /api/accounting/vouchers'] },
  '/accounting/treasury': { gate: anyOf('accounting.treasury'), api: ['GET /api/accounting/treasury', 'GET /api/accounting/bank-accounts'] },
  '/accounting/cheques': { gate: anyOf('accounting.cheques'), api: ['GET /api/accounting/cheques'] },
  '/accounting/reports': { gate: anyOf('accounting.reports'), api: ['GET /api/accounting/reports/trial-balance'] },
  '/accounting/fiscal-closing': { gate: anyOf('accounting.vouchers'), api: ['GET /api/accounting/fiscal-closing/preview'] },
} as const satisfies Record<string, PageAccessRule>;

const ACCOUNTING_KEYS = [...new Set(Object.values(ACCOUNTING_TABS).flatMap(r => r.gate.anyOf))];

const DOCUMENT_ENTRY = ['GET /api/customers/options', 'GET /api/items/options', 'GET /api/documents/next-ref', 'POST /api/documents'];

export const PAGE_ACCESS = {
  '/': { gate: 'login', api: [] },
  '/my-payslips': { gate: 'login', api: [] },
  '/approval-inbox': { gate: anyOf('workflow.view', 'workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'), api: ['GET /api/workflow/tasks/my-tasks', 'GET /api/workflow/tasks/stats'] },
  '/inventory-status': { gate: anyOf('reports.view', 'warehouse.view'), api: ['GET /api/stats', 'GET /api/dashboard-bi-stats'] },
  '/products': { gate: anyOf('products.view'), api: ['GET /api/items'] },
  '/gallery': { gate: anyOf('products.view'), api: ['GET /api/items'] },
  '/receipts': { gate: anyOf('warehouse.in', 'documents.view', 'documents.create'), api: ['GET /api/documents/next-ref', 'GET /api/customers/options', 'GET /api/items/options', 'GET /api/projects/options'] },
  '/pending-materials': { gate: anyOf('pending_materials.view', 'products.view'), api: ['GET /api/pending-materials'] },
  '/transfers': { gate: anyOf('products.view'), api: ['GET /api/transfers', 'GET /api/items/options'] },
  '/reorder-alerts': { gate: anyOf('products.view', 'warehouse.view'), api: ['GET /api/items/reorder-alerts'] },
  '/pricing': { gate: anyOf('products.edit_price', 'products.view'), api: ['GET /api/items', 'GET /api/items/prices/all'] },
  '/audit': { gate: anyOf('audit.view'), api: ['GET /api/documents/audit-items', 'GET /api/documents', 'GET /api/documents/:id', 'GET /api/documents/next-ref', 'GET /api/items/options'] },
  '/crm': { gate: anyOf('crm.view'), api: ['GET /api/crm/leads', 'GET /api/items/options', 'GET /api/customers/:id/documents'] },
  '/customers': { gate: anyOf('customers.view'), api: ['GET /api/customers', 'GET /api/customers/:id/documents'] },
  '/invoices/create': { gate: anyOf('documents.create'), api: DOCUMENT_ENTRY },
  '/remittances': { gate: anyOf('documents.create'), api: DOCUMENT_ENTRY },
  '/projects': { gate: anyOf('projects.view'), api: ['GET /api/projects', 'GET /api/items/options'] },
  '/project-inventory': { gate: anyOf('projects.view', 'warehouse.view'), api: ['GET /api/projects/options', 'GET /api/projects/:id', 'GET /api/items/options'] },
  '/procurement': { gate: anyOf('procurement.view', 'projects.view'), api: ['GET /api/procurement/requisitions', 'GET /api/procurement/orders', 'GET /api/items/options'] },
  '/personnel': { gate: anyOf('personnel.view'), api: ['GET /api/personnel'] },
  '/daily-logs': { gate: anyOf('daily_logs.view'), api: ['GET /api/daily-logs', 'GET /api/projects/options'] },
  '/piecework': { gate: anyOf('piecework.view'), api: ['GET /api/piecework/logs', 'GET /api/projects/options'] },
  '/reserved-items': { gate: anyOf('products.view', 'reports.view', 'warehouse.view', 'documents.view'), api: ['GET /api/inventory/reserved-items'] },
  '/transactions': { gate: anyOf('warehouse.view', 'accounting.view'), api: ['GET /api/transactions'] },
  '/accounting': { gate: { anyOf: ACCOUNTING_KEYS }, api: [] },
  ...ACCOUNTING_TABS,
  '/invoices': { gate: anyOf('documents.view'), api: ['GET /api/documents'] },
  '/domain-events': { gate: anyOf('events.view'), api: ['GET /api/events/action-rules'] },
  '/workflow-designer': { gate: anyOf('workflow.manage', 'workflow.admin'), api: ['GET /api/workflow/definitions'] },
  '/users': { gate: anyOf('users.manage', 'roles.manage'), api: ['GET /api/users', 'GET /api/roles', 'GET /api/permissions'] },
  '/settings': { gate: { anyOf: SETTINGS_PAGE_KEYS }, api: ['GET /api/settings'] },
  '/activity-logs': { gate: anyOf('audit_logs.view'), api: ['GET /api/activity-logs', 'GET /api/activity-logs/filters'] },
  // صفحه ایستا: یادداشت‌های نسخه از خود بسته مرورگر خوانده می‌شود
  '/changelog': { gate: anyOf('settings.manage'), api: [] },
} as const satisfies Record<string, PageAccessRule>;

export type PagePath = keyof typeof PAGE_ACCESS;

export function isSystemAdminViewer(viewer: ViewerAccess | null | undefined): boolean {
  return Boolean(viewer?.isAdmin) || isSystemAdminRole(viewer?.role);
}

export function passesGate(gate: PageGate, viewer: ViewerAccess | null | undefined): boolean {
  if (isSystemAdminViewer(viewer)) return true;
  if (gate === 'login') return true;
  if (gate === 'system_admin') return false;
  const held = Array.isArray(viewer?.permissions) ? viewer.permissions : [];
  return gate.anyOf.some(key => held.includes(key));
}

/** قاعده دسترسی صفحه از مسیر (بی رشته پرس‌وجو)؛ مسیر ناشناخته `undefined` */
export function pageAccessRule(path: string): PageAccessRule | undefined {
  const bare = path.split(/[?#]/)[0];
  return (PAGE_ACCESS as Record<string, PageAccessRule>)[bare];
}

/** صفحه برای این کاربر باز است؛ مسیری که در جدول نیست برای هیچ کس جز مدیر سیستم باز نیست */
export function canOpenPage(path: string, viewer: ViewerAccess | null | undefined): boolean {
  const rule = pageAccessRule(path);
  if (!rule) return isSystemAdminViewer(viewer);
  return passesGate(rule.gate, viewer);
}

export function canOpenSettingsTab(tabId: string, viewer: ViewerAccess | null | undefined): boolean {
  const rule = (SETTINGS_TAB_ACCESS as Record<string, PageAccessRule>)[tabId];
  if (!rule) return isSystemAdminViewer(viewer);
  return passesGate(rule.gate, viewer);
}

/** زبانه‌ای که فقط مدیر سیستم باز می‌کند (برچسب «مدیر سیستم» در فهرست زبانه‌ها) */
export function isSystemAdminSettingsTab(tabId: string): boolean {
  return (SETTINGS_TAB_ACCESS as Record<string, PageAccessRule>)[tabId]?.gate === 'system_admin';
}
