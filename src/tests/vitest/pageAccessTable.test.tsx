import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getMenuGroups } from '../../components/layout/menuConfig';
import { ALL_SHORTCUTS, accessibleShortcutsFor } from '../../components/dashboard/CustomizableShortcuts';
import { SETTINGS_GROUPS, getVisibleGroups } from '../../components/settings/settingsNavigationConfig';
import { WooCommerceTab } from '../../components/settings/WooCommerceTab';
import SettingsPage from '../../pages/SettingsPage';
import { PERMISSION_KEYS } from '../../lib/permissions/permissionCatalog';
import { PAGE_ACCESS, SETTINGS_TAB_ACCESS, canOpenPage, canOpenSettingsTab } from '../../lib/permissions/pageAccess';
import type { User } from '../../types';

// v9.0.131 (TD-668، یافته B16-04، تصمیم ت۲ الف بسته ۱۶): منو، مسیر صفحه، میانبرهای پیشخوان و زبانه‌های تنظیمات فقط از
// جدول یکتای pageAccess می‌خوانند. هم‌خوانی همان جدول با گارد API در آزمون sec_page_access_matches_api_td_668 است.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const ROOT = path.resolve(__dirname, '../../..');
const user = (role = 'branch_role'): User => ({ id: 3, username: 'u3', full_name: 'کاربر', role });
/** هر کلید کاتالوگ به‌تنهایی، و کاربری بی هیچ کلید */
const SINGLE_KEY_VIEWERS: string[][] = [[], ...PERMISSION_KEYS.map(k => [k])];

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  window.history.replaceState({}, '', '/');
});

describe('one page-access table for menu, routes, shortcuts and settings tabs (TD-668)', () => {
  it('shows each menu link exactly when its page opens, for every single catalog key', () => {
    for (const permissions of SINGLE_KEY_VIEWERS) {
      for (const item of getMenuGroups(user(), { permissions, isAdmin: false }).flatMap(g => g.items)) {
        expect(PAGE_ACCESS, `menu path ${item.path} has no page-access row`).toHaveProperty([item.path]);
        expect(item.visible, `${item.path} for [${permissions.join(',')}]`).toBe(canOpenPage(item.path, { permissions }));
      }
    }
  });

  it('guards every page route with the same table, by its own path', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/components/AppRoutes.tsx'), 'utf8');
    expect(source).not.toMatch(/requiredPerm=/);
    const routes = [...source.matchAll(/<Route path="([^"]+)" element=\{\s*(<ProtectedRoute page="([^"]+)")?/g)];
    const routed = new Set<string>();
    for (const [, routePath, guarded, page] of routes) {
      if (routePath === '/materials' || routePath === '/remittances') continue; // redirects
      const expected = routePath === '/accounting/:tab' ? '/accounting' : routePath;
      expect(PAGE_ACCESS, `route ${routePath} has no page-access row`).toHaveProperty([expected]);
      const rule = PAGE_ACCESS[expected as keyof typeof PAGE_ACCESS];
      if (rule.gate === 'login') {
        expect(guarded, `${routePath} is open to every signed-in user and needs no guard`).toBeUndefined();
      } else {
        expect(page, `route ${routePath} must be guarded with page="${expected}"`).toBe(expected);
      }
      routed.add(expected);
    }
    for (const page of Object.keys(PAGE_ACCESS)) {
      if (page.startsWith('/accounting/')) continue; // /accounting/:tab
      expect(routed.has(page), `page ${page} has no route`).toBe(true);
    }
  });

  it('offers a dashboard shortcut exactly when its page opens', () => {
    for (const permissions of SINGLE_KEY_VIEWERS) {
      const expected = ALL_SHORTCUTS.filter(s => canOpenPage(s.path, { permissions })).map(s => s.id);
      expect(accessibleShortcutsFor({ permissions }).map(s => s.id), `[${permissions.join(',')}]`).toEqual(expected);
    }
    for (const s of ALL_SHORTCUTS) expect(PAGE_ACCESS, `shortcut ${s.path}`).toHaveProperty([s.path.split('?')[0]]);
  });

  it('shows each settings tab exactly when its API accepts the user, and the settings page when any tab opens', () => {
    const tabIds = SETTINGS_GROUPS.flatMap(g => g.tabs.map(t => t.id)).sort();
    expect(tabIds).toEqual(Object.keys(SETTINGS_TAB_ACCESS).sort());
    for (const permissions of SINGLE_KEY_VIEWERS) {
      const shown = getVisibleGroups(SETTINGS_GROUPS, 'branch_role', { permissions, isAdmin: false }).flatMap(g => g.tabs.map(t => t.id)).sort();
      expect(shown, `[${permissions.join(',')}]`).toEqual(tabIds.filter(id => canOpenSettingsTab(id, { permissions })));
      expect(canOpenPage('/settings', { permissions }), `settings page for [${permissions.join(',')}]`).toBe(shown.length > 0);
    }
  });

  it('closes the mismatches of finding B16-04', () => {
    const visible = (permissions: string[]) =>
      new Set(getMenuGroups(user(), { permissions, isAdmin: false }).flatMap(g => g.items).filter(i => i.visible).map(i => i.path));
    // سجل تغییرات با audit_logs.view، نه reports.view
    expect(visible(['reports.view']).has('/activity-logs')).toBe(false);
    expect(visible(['audit_logs.view']).has('/activity-logs')).toBe(true);
    // کارتابل فقط با کلید گردش کار، و طراح فرایند برای workflow.manage نه فقط کد نقش مدیر
    expect(visible(['daily_logs.create']).has('/approval-inbox')).toBe(false);
    expect(visible(['workflow.approve']).has('/approval-inbox')).toBe(true);
    expect(visible(['workflow.manage']).has('/workflow-designer')).toBe(true);
    // تدارکات بی documents.view
    expect(visible(['documents.view']).has('/procurement')).toBe(false);
    // دارنده accounting.coa فقط زبانه‌های حساب‌ها را می‌بیند
    const coaTabs = getVisibleGroups(SETTINGS_GROUPS, 'branch_role', { permissions: ['accounting.coa'], isAdmin: false }).flatMap(g => g.tabs.map(t => t.id));
    expect(coaTabs.sort()).toEqual(['accounting', 'chart_of_accounts']);
    // میانبر دیده‌بان انبار بی reports.view / warehouse.view دیده نمی‌شود
    expect(accessibleShortcutsFor({ permissions: ['accounting.treasury'] }).some(s => s.id === 'inventory_status')).toBe(false);
  });

  it('lets only the system admin edit the WooCommerce connection, and settings.manage the shop warehouse', () => {
    const noop = () => undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WooCommerceTab
          wcStoreUrl="https://shop.example" setWcStoreUrl={noop} wcConsumerKey="" setWcConsumerKey={noop} wcConsumerSecret="" setWcConsumerSecret={noop}
          wcWebhookSecret="" setWcWebhookSecret={noop} wcShopWarehouse="" setWcShopWarehouse={noop} warehouses={[]}
          handleSaveSettings={noop} isSaving={false} handleTestWcConnection={noop} isTestingWc={false}
          manualOrderId="" setManualOrderId={noop} isSyncingManualOrder={false} handleSyncManualOrder={noop}
          syncedWcOrders={[]} wcOrderLogs={[]} loadSyncedWcOrders={noop} handleSyncAllStocks={noop} isSyncingAllStocks={false}
          access={{ connection: false, shopWarehouse: true, sync: false }}
        />
      </QueryClientProvider>,
    );
    expect((screen.getByPlaceholderText('https://yoursite.com') as HTMLInputElement).matches(':disabled')).toBe(true);
    expect(screen.getByText('نشانی سایت و کلیدهای دسترسی را فقط مدیر سامانه تغییر می‌دهد.')).toBeTruthy();
    expect(screen.queryByText('آزمایش اتصال به سایت')).toBeNull();
    expect(screen.queryByText('همگام‌سازی موجودی کل کالاها با سایت')).toBeNull();
    expect(screen.getByText('ذخیره تنظیمات ووکامرس')).toBeTruthy();
  });

  it('never renders a settings tab the user cannot open, even from ?tab=', async () => {
    fetchJson.mockImplementation(() => Promise.resolve([]));
    window.history.replaceState({}, '', '/settings?tab=general');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SettingsPage currentUser={user()} userPermissions={{ permissions: ['accounting.coa'], isAdmin: false }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('کدینگ پیش‌فرض حساب‌ها')).toBeTruthy();
    expect(screen.queryByText('همگام‌سازی کدینگ پیش‌فرض')).toBeNull();
    expect(screen.queryByText('نام فروشگاه / شرکت')).toBeNull();
  });
});
