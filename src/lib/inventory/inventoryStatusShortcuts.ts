import { canOpenPage, type ViewerAccess } from '../permissions/pageAccess';

/**
 * TD-1157: the quick links of «وضعیت انبار». Each one is shown only when its page opens for the viewer (`canOpenPage`,
 * the page access table the menu and the routes read), and each label says what the page is: the links open lists, not
 * create forms. Before, every link was shown to anyone who could see the page and «تعریف کالا» / «صدور فاکتور» promised
 * a form.
 */
export type InventoryStatusShortcutIcon = 'products' | 'raw_materials' | 'invoices' | 'projects' | 'transfers' | 'reorder';

export interface InventoryStatusShortcut {
  path: string;
  label: string;
  icon: InventoryStatusShortcutIcon;
}

export const INVENTORY_STATUS_SHORTCUTS: readonly InventoryStatusShortcut[] = [
  { path: '/products', label: 'فهرست کالاها', icon: 'products' },
  { path: '/products?type=raw_material', label: 'فهرست مواد اولیه', icon: 'raw_materials' },
  { path: '/invoices', label: 'فاکتورها و اسناد', icon: 'invoices' },
  { path: '/projects', label: 'پروژه‌های تولید', icon: 'projects' },
  { path: '/transfers', label: 'کدهای ترنسفر', icon: 'transfers' },
  { path: '/reorder-alerts', label: 'هشدار نقطه سفارش', icon: 'reorder' },
];

export function inventoryStatusShortcutsFor(viewer: ViewerAccess | null | undefined): InventoryStatusShortcut[] {
  return INVENTORY_STATUS_SHORTCUTS.filter(s => canOpenPage(s.path, viewer));
}
