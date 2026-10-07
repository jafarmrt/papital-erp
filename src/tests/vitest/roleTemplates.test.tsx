import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from '../../pages/UsersPage';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { PERMISSION_CATALOG, withRequiredPermissions } from '../../lib/permissions/permissionCatalog';
import { ROLE_TEMPLATES, roleDraftFromTemplate, uniqueRoleCode } from '../../lib/permissions/roleTemplates';
import type { PermissionCategory, Role, User } from '../../types';

// v9.0.134 (TD-526، یافته B02-11، تصمیم ت۶ بازنگری‌شده الف): نصب تازه جز «مدیر سیستم» نقشی ندارد؛ مدیر با «ساخت نقش از الگو»
// یکی از فهرست واحد الگوها را برمی‌گزیند و فرم نقش تازه با نام و تیک‌های همان الگو باز می‌شود. قالب‌های جداگانه فرم نقش رفتند.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const treasurer = ROLE_TEMPLATES.find(t => t.code === 'treasurer')!;
const existing: Role = { id: 21, name: 'خزانه‌دار قدیمی', code: 'treasurer', description: '', permissions: ['accounting.view'], isSystem: 0 };
const admin: User = { id: 1, username: 'root', full_name: 'مدیر سیستم', role: 'admin' };

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('role templates (TD-526)', () => {
  it('suggests a free code when the template code is taken', () => {
    expect(uniqueRoleCode('treasurer', [])).toBe('treasurer');
    expect(uniqueRoleCode('treasurer', ['Treasurer', 'treasurer_2'])).toBe('treasurer_3');
  });

  it('drafts the template\'s permissions with their requirements, limited to what the current user may grant', () => {
    const full = roleDraftFromTemplate(treasurer, ['treasurer'], 'all');
    expect(full).toMatchObject({ name: treasurer.name, code: 'treasurer_2', description: treasurer.description });
    expect([...full.permissions].sort()).toEqual([...withRequiredPermissions(treasurer.permissions)].sort());

    const limited = roleDraftFromTemplate(treasurer, [], ['roles.manage', 'accounting.view', 'accounting.treasury', 'documents.view', 'workflow.approve']);
    expect([...limited.permissions].sort()).toEqual(['accounting.treasury', 'accounting.view', 'documents.view']);
  });

  it('has no separate presets in the role form any more', () => {
    render(
      <RoleFormModal isOpen onClose={() => undefined} editingRole={null} permCatalog={PERMISSION_CATALOG as unknown as PermissionCategory[]} onSuccess={() => undefined} />,
    );
    expect(screen.queryByText(/قالب‌های آماده نقش/)).toBeNull();
  });

  it('opens the role form from a template and saves exactly the template\'s permissions', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ success: true });
      if (url === '/roles') return Promise.resolve([existing]);
      if (url === '/permissions') return Promise.resolve(PERMISSION_CATALOG);
      return Promise.resolve([]);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <UsersPage currentUser={admin} userPermissions={{ permissions: [], isAdmin: true }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /ماتریس نقش‌ها و مجوزها/ }));
    expect(await screen.findByText(existing.name)).toBeTruthy();

    const open = screen.getByRole('button', { name: /ساخت نقش از الگو/ });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    for (const t of ROLE_TEMPLATES) expect(screen.getByText(t.name)).toBeTruthy();
    fireEvent.click(screen.getByText(treasurer.name).closest('button')!);

    expect((screen.getByPlaceholderText(/کمک انباردار/) as HTMLInputElement).value).toBe(treasurer.name);
    expect((screen.getByPlaceholderText('e.g. warehouse_assistant') as HTMLInputElement).value).toBe('treasurer_2');
    fireEvent.submit(screen.getByPlaceholderText(/کمک انباردار/).closest('form')!);

    await waitFor(() => expect(fetchJson.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = fetchJson.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/roles');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ name: treasurer.name, code: 'treasurer_2', isSystem: 0 });
    expect([...body.permissions].sort()).toEqual([...withRequiredPermissions(treasurer.permissions)].sort());
  });
});
