import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar';
import { RolesTab } from '../../components/users/RolesTab';
import type { Role, User } from '../../types';

// v9.0.115 (TD-884، تصمیم ت۱۱ مدل مجوز): منو فقط از مجوزهای نقش ساخته می‌شود. پنهان کردن پیوند برای هر نقش (تنظیم
// `menu_visibility`) فقط پیوند را برمی‌داشت و دسترسی را نمی‌گرفت، پس حذف شد.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const user: User = { id: 5, username: 'keeper', full_name: 'انباردار', role: 'branch_keeper' };

afterEach(() => {
  cleanup();
  localStorage.clear();
  fetchJson.mockReset();
});

describe('menu built from permissions only (TD-884)', () => {
  it('shows every page the role\'s permissions open, whatever a stored per-role hiding list says', async () => {
    fetchJson.mockImplementation((url: string) =>
      Promise.resolve(url === '/menu-visibility' ? { branch_keeper: ['/products', '/inventory-status'] } : {}));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/gallery']}>
          <Sidebar user={user} userPermissions={{ permissions: ['products.view', 'warehouse.view'], isAdmin: false }}
            onLogout={() => undefined} onOpenProfile={() => undefined} isCollapsed={false} onToggleCollapse={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 20));
    expect(fetchJson.mock.calls.map(([url]) => url)).not.toContain('/menu-visibility');
    const links = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(links).toContain('/products');
    expect(links).toContain('/inventory-status');
  });

  it('offers no per-role menu hiding on the roles tab', () => {
    const role: Role = { id: 1, name: 'انباردار', code: 'branch_keeper', description: '', permissions: ['products.view'], isSystem: 0 };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RolesTab rolesList={[role]} users={[]} totalCatalogPermsCount={1} onAddRole={() => undefined} onEditRole={() => undefined} onDeleteRole={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('کنترل نمایش و فیلتر دید منو برای هر نقش')).toBeNull();
  });
});
