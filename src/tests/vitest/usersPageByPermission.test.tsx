import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from '../../pages/UsersPage';
import { UserFormModal } from '../../components/users/UserFormModal';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { getMenuGroups } from '../../components/layout/menuConfig';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog';
import type { PermissionCategory, Role, User } from '../../types';

// v9.0.113 (TD-525، یافته B02-10، تصمیم ت۳ الف): صفحه و منوی کاربران و نقش‌ها با «مدیریت کاربران» / «مدیریت نقش‌ها» باز
// است، نه فقط با کد مدیر سیستم، و فرم‌ها فقط آنچه کاربر جاری می‌تواند بدهد پیشنهاد می‌کنند (همان قاعده سرور، TD-520)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const weak: Role = { id: 11, name: 'کارمند فروش', code: 'branch_sales', description: '', permissions: ['customers.view'], isSystem: 0 };
const strong: Role = { id: 12, name: 'مدیر مالی شعبه', code: 'branch_cfo', description: '', permissions: ['accounting.view', 'accounting.vouchers'], isSystem: 0 };
const own: Role = { id: 13, name: 'مدیر کاربران شعبه', code: 'branch_admin', description: '', permissions: ['users.manage', 'roles.manage', 'customers.view'], isSystem: 0 };
const me: User = { id: 7, username: 'branch_admin_user', full_name: 'مدیر کاربران', role: own.code };
const listedUsers = [
  { id: 7, username: me.username, full_name: me.full_name, role: own.code },
  { id: 8, username: 'sales_user', full_name: 'کاربر فروش', role: weak.code },
  { id: 9, username: 'cfo_user', full_name: 'کاربر مالی', role: strong.code },
  { id: 10, username: 'root_user', full_name: 'مدیر سیستم', role: 'admin' },
];

function respond(url: string): unknown {
  if (url === '/users') return listedUsers;
  if (url === '/roles') return [weak, strong, own];
  if (url === '/permissions') return PERMISSION_CATALOG;
  return [];
}

function renderPage(permissions: string[]) {
  fetchJson.mockImplementation((url: string) => Promise.resolve(respond(url)));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <UsersPage currentUser={me} userPermissions={{ permissions, isAdmin: false }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('users and roles page by permission (TD-525)', () => {
  it('shows the menu link to a holder of users.manage or roles.manage, not only to the system admin', () => {
    for (const permissions of [['users.manage'], ['roles.manage']]) {
      const items = getMenuGroups(me, { permissions, isAdmin: false }).flatMap(g => g.items);
      expect(items.find(i => i.path === '/users')?.visible).toBe(true);
    }
    const none = getMenuGroups(me, { permissions: ['customers.view'], isAdmin: false }).flatMap(g => g.items);
    expect(none.find(i => i.path === '/users')?.visible).toBe(false);
  });

  it('opens the page for a non-admin user manager and offers editing only for accounts within its permissions', async () => {
    renderPage(own.permissions);
    expect(await screen.findByText('کاربر فروش')).toBeTruthy();
    expect(screen.queryByText('دسترسی محدود')).toBeNull();
    expect(screen.getByRole('button', { name: /ثبت کاربر جدید/ })).toBeTruthy();
    const editable = screen.getAllByTitle('ویرایش اطلاعات کاربر').map(b => b.closest('tr')?.textContent ?? '');
    expect(editable).toHaveLength(2);
    expect(editable.some(row => row.includes('کاربر فروش'))).toBe(true);
    expect(editable.some(row => row.includes('مدیر کاربران'))).toBe(true);
  });

  it('hides user actions from a holder of roles.manage alone', async () => {
    renderPage(['roles.manage', 'customers.view']);
    fireEvent.click(await screen.findByRole('button', { name: /لیست کاربران/ }));
    expect(await screen.findByText('کاربر فروش')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ثبت کاربر جدید/ })).toBeNull();
    expect(screen.queryAllByTitle('ویرایش اطلاعات کاربر')).toHaveLength(0);
  });

  it('offers only roles within the manager\'s permissions and locks the role of its own account', () => {
    const grantor = own.permissions;
    const { unmount } = render(
      <UserFormModal isOpen onClose={() => undefined} editingUser={null} rolesList={[weak, strong, own]} onSuccess={() => undefined} grantor={grantor} currentUserId={me.id} />,
    );
    const options = within(screen.getByRole('combobox')).getAllByRole('option').map(o => o.textContent ?? '');
    expect(options).toContain(weak.name);
    expect(options).not.toContain(strong.name);
    expect(options.some(o => o.includes('مدیر سیستم'))).toBe(false);
    unmount();

    render(
      <UserFormModal isOpen onClose={() => undefined} editingUser={me} rolesList={[weak, strong, own]} onSuccess={() => undefined} grantor={grantor} currentUserId={me.id} />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });

  it('does not let a role manager tick a permission it does not hold', () => {
    render(
      <RoleFormModal isOpen onClose={() => undefined} editingRole={null} permCatalog={PERMISSION_CATALOG as unknown as PermissionCategory[]} onSuccess={() => undefined} grantor={own.permissions} />,
    );
    const locked = screen.getByText('(accounting.vouchers)').closest('label') as HTMLLabelElement;
    const box = within(locked).getByRole('checkbox') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(locked);
    expect(box.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'انتخاب همه' }));
    expect(box.checked).toBe(false);
    const held = within(screen.getByText('(customers.view)').closest('label') as HTMLLabelElement).getByRole('checkbox') as HTMLInputElement;
    expect(held.checked).toBe(true);
  });
});
