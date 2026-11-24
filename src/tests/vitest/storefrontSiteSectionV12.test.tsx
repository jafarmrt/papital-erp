import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { User } from '../../types';

/**
 * v12 phase 9a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decisions 1 and 15): the ERP's own «فروشگاه سایت»
 * section in the sidebar, its page «کالاها و تنظیمات سایت» with the open section in the address, the «مدیر سایت» role
 * template, the WooCommerce shop's new name (site review 3.2b) and the toman equivalent of the province rates (3.2f).
 */
const displayUnit = vi.hoisted(() => ({ current: 'TOMAN' }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => displayUnit.current, useRialDisplay: () => rialDisplayOf(displayUnit.current) };
});
const fetchJson = vi.fn(() => new Promise(() => undefined));
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});

const { getMenuGroups } = await import('../../components/layout/menuConfig');
const { ROLE_TEMPLATES } = await import('../../lib/permissions/roleTemplates');
const { missingRequiredPermissions, PERMISSION_CATALOG } = await import('../../lib/permissions/permissionCatalog');
const { auditEntityTitle } = await import('../../lib/audit/auditEntityTitles');
const { PURGEABLE_AUDIT_ENTITY_LABELS } = await import('../../lib/audit/auditRetention');
const { messengerLinkPath } = await import('../../lib/notifications/notificationCategories');
const { SETTINGS_GROUPS } = await import('../../components/settings/settingsNavigationConfig');
const { RialDisplayProvider } = await import('../../contexts/RialDisplayContext');
const { ShippingMethodEditor } = await import('../../components/storefront/ShippingMethodEditor');
const StorefrontSettingsPage = (await import('../../pages/StorefrontSettingsPage')).default;
const { AppRoutes } = await import('../../components/AppRoutes');
const { BuyerGroupEditor } = await import('../../components/storefront/BuyerGroupEditor');
const { AuditPrintModal } = await import('../../components/audit/AuditPrintModal');
const { canOpenPage } = await import('../../lib/permissions/pageAccess');

const user = (): User => ({ id: 3, username: 'u3', full_name: 'کاربر', role: 'branch_role' });

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  permissions.current = [];
  displayUnit.current = 'TOMAN';
  window.history.replaceState({}, '', '/');
});

const visibleLinks = (keys: string[]) => Object.fromEntries(
  getMenuGroups(user(), { permissions: keys, isAdmin: false }).map(g => [g.id, g.items.filter(i => i.visible).map(i => i.path)]),
);

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const withProviders = (node: ReactNode, at: string) => (
  <QueryClientProvider client={client()}>
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="*" element={<>{node}<Where /></>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);

describe('the ERP site shop section (v12 phase 9a)', () => {
  it('groups the site orders, buyers and settings in one sidebar group, each by its own key', () => {
    const groups = getMenuGroups(user(), { permissions: [], isAdmin: true });
    const site = groups.find(g => g.id === 'site');
    expect(site?.title).toBe('فروشگاه سایت');
    expect(site?.items.map(i => i.path)).toEqual(['/site-orders', '/site-buyers', '/site-settings', '/site-menus', '/site-pages', '/site-news', '/site-collections', '/site-forms', '/site-messages']);
    expect(groups.find(g => g.id === 'crm')?.items.map(i => i.path)).not.toContain('/site-orders');

    expect(visibleLinks(['storefront.view']).site).toEqual(['/site-settings']);
    expect(visibleLinks(['site_orders.view']).site).toEqual(['/site-orders']);
    expect(visibleLinks(['site_buyers.view', 'storefront.view']).site).toEqual(['/site-buyers', '/site-settings']);
  });

  it('opens the section named in the address and keeps the choice there', async () => {
    permissions.current = ['storefront.view'];
    render(withProviders(<StorefrontSettingsPage />, '/site-settings?section=sms'));
    expect(screen.getByRole('heading', { name: 'کالاها و تنظیمات سایت' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'پیامک' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/شما فقط می‌توانید ببینید/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'ایمیل' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/site-settings?section=email'));
    expect(screen.getByRole('tab', { name: 'ایمیل' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens the site products for an unknown section', () => {
    render(withProviders(<StorefrontSettingsPage />, '/site-settings?section=nope'));
    expect(screen.getByRole('tab', { name: 'کالاهای سایت' }).getAttribute('aria-selected')).toBe('true');
  });

  it('takes the old settings tab address to the new page, even for a colleague who opens no settings tab', async () => {
    render(withProviders(<AppRoutes user={user()} userPermissions={{ permissions: ['storefront.view'], isAdmin: false }} permissionsLoaded />, '/settings?tab=storefront'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/site-settings'));
  });

  it('no longer lists the site in the settings page, which storefront.view alone does not open', () => {
    expect(SETTINGS_GROUPS.flatMap(g => g.tabs).map(t => t.id)).not.toContain('storefront');
    expect(canOpenPage('/settings', { permissions: ['storefront.view', 'storefront.manage'] })).toBe(false);
  });

  it('gives the messenger copy of a site SMS bell the page itself', () => {
    expect(messengerLinkPath('site_sms', '/site-settings?section=sms')).toBe('/site-settings');
  });
});

describe('the site manager role template (decision 15, proposal 2)', () => {
  const template = ROLE_TEMPLATES.find(t => t.code === 'site_manager');

  it('holds every site key and media.view, closed under requires', () => {
    expect(template).toBeDefined();
    expect(template?.name).toBe('مدیر سایت');
    expect([...(template?.permissions ?? [])].sort()).toEqual([
      'media.view', 'site_buyers.manage', 'site_buyers.view', 'site_content.manage', 'site_content.view', 'site_messages.manage', 'site_messages.view', 'site_orders.manage', 'site_orders.view',
      'storefront.manage', 'storefront.view',
    ]);
    expect(missingRequiredPermissions(template?.permissions ?? [])).toEqual([]);
  });

  it('opens the site shop sidebar section and no settings or business page (decision 1)', () => {
    const shown = visibleLinks([...(template?.permissions ?? [])]);
    expect(shown.site).toEqual(['/site-orders', '/site-buyers', '/site-settings', '/site-menus', '/site-pages', '/site-news', '/site-collections', '/site-forms', '/site-messages']);
    expect(shown.system ?? []).not.toContain('/settings');
    expect([...(shown.crm ?? []), ...(shown.accounting ?? []), ...(shown.production ?? [])]).toEqual([]);
  });

  it('has no treasury, accounting, document or stock key, so confirming a payment needs them added by hand', () => {
    expect(template).toBeDefined();
    const outside = (template?.permissions ?? []).filter(k => /^(accounting|documents|warehouse|products|inventory|payroll)\./.test(k));
    expect(outside).toEqual([]);
  });
});

describe('the WooCommerce shop is named the old site (site review 3.2b)', () => {
  it('names the permission group and the settings tab so', () => {
    expect(PERMISSION_CATALOG.some(g => g.category === 'ووکامرس (سایت قدیم)')).toBe(true);
    expect(SETTINGS_GROUPS.flatMap(g => g.tabs).find(t => t.id === 'woocommerce')?.label).toBe('ووکامرس (سایت قدیم)');
  });

  it('shows the stored audit name under its new title and keeps every other name', () => {
    expect(auditEntityTitle('فروشگاه اینترنتی')).toBe('ووکامرس (سایت قدیم)');
    expect(auditEntityTitle('انبار')).toBe('انبار');
    expect(auditEntityTitle(null)).toBe('');
    expect(PURGEABLE_AUDIT_ENTITY_LABELS['فروشگاه اینترنتی']).toBe('همگام‌سازی با ووکامرس سایت قدیم');
  });

  it('prints a WooCommerce audit row and its filter under the new title', () => {
    const log = { id: 1, username: 'u1', action: 'WC_STOCK_PUSH', entity: 'فروشگاه اینترنتی', entityId: '', description: '', createdAt: '2026-11-20T10:00:00Z' };
    render(<AuditPrintModal logs={[log]} total={1} onClose={() => undefined} filterSummary={{ entityFilter: 'فروشگاه اینترنتی' }} />);
    expect(screen.getAllByText(/ووکامرس \(سایت قدیم\)/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/فروشگاه اینترنتی/)).toBeNull();
  });
});

describe('toman equivalent of the province rates (site review 3.2f)', () => {
  const method = {
    id: 1, version: 1, code: 'post', title: 'پست', description: '', pricing: 'table' as const, flatRate: '0', isActive: true,
    isFreeShippingEligible: false, sortOrder: 0, rates: [{ province: '', maxWeightGrams: null, rate: '250000' }],
  };

  it('shows it under each rate while the display unit is toman', () => {
    render(<QueryClientProvider client={client()}><RialDisplayProvider><ShippingMethodEditor method={method} onClose={() => undefined} /></RialDisplayProvider></QueryClientProvider>);
    expect(screen.getByText('معادل:').textContent).toContain('۲۵٬۰۰۰ تومان');
  });

  it('shows nothing while the display unit is rial', () => {
    displayUnit.current = 'IRR';
    render(<QueryClientProvider client={client()}><RialDisplayProvider><ShippingMethodEditor method={method} onClose={() => undefined} /></RialDisplayProvider></QueryClientProvider>);
    expect(screen.queryByText('معادل:')).toBeNull();
  });
});

describe('a buyer group price list needs products.edit_price (9a review)', () => {
  const editor = () => render(<QueryClientProvider client={client()}><RialDisplayProvider><BuyerGroupEditor group={null} priceLists={['عمده']} collections={[]} onClose={() => undefined} /></RialDisplayProvider></QueryClientProvider>);

  it('is read-only with the site keys alone, as the server refuses the change', () => {
    permissions.current = ['storefront.view', 'storefront.manage'];
    editor();
    expect((screen.getByLabelText('لیست قیمت ERP') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('تعیین لیست قیمت گروه مجوز ویرایش قیمت کالا را هم می‌خواهد.')).toBeTruthy();
  });

  it('is open with products.edit_price', () => {
    permissions.current = ['storefront.view', 'storefront.manage', 'products.edit_price'];
    editor();
    expect((screen.getByLabelText('لیست قیمت ERP') as HTMLSelectElement).disabled).toBe(false);
  });
});
