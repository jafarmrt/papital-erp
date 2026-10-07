import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RolesTab } from '../../components/users/RolesTab';
import { RoleFormModal } from '../../components/users/RoleFormModal';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '../../lib/permissions/permissionCatalog';
import type { PermissionCategory, Role } from '../../types';

// v9.0.135 (TD-885، تصمیم ت۹ الف مدل مجوز): فقط «مدیر سیستم» نقش ثابت است. نقش پیش‌فرض قدیمی (که پیش‌تر «سیستمی» و
// حذف‌نشدنی بود) مثل هر نقش دیگری دکمه حذف دارد. v9.0.136 (TD-886، قاعده ۳): تیک‌های «مدیر سیستم» همه زده و قفل‌اند.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const admin: Role = { id: 1, name: 'مدیر سیستم', code: 'admin', description: '', permissions: [], isSystem: 1 };
const former: Role = { id: 2, name: 'انباردار', code: 'warehouse_keeper', description: '', permissions: ['warehouse.view'], isSystem: 1 };

function card(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('div.bg-white') as HTMLElement;
}

describe('only the system admin role is fixed (TD-885)', () => {
  it('marks only the system admin role as system and offers delete for a former default role', () => {
    render(<RolesTab rolesList={[admin, former]} users={[]} totalCatalogPermsCount={10} onAddRole={() => undefined} onEditRole={() => undefined} onDeleteRole={() => undefined} />);
    expect(within(card(admin.name)).queryByText('سیستمی')).not.toBeNull();
    expect(within(card(admin.name)).queryByTitle('حذف نقش')).toBeNull();
    expect(within(card(former.name)).queryByText('سیستمی')).toBeNull();
    expect(within(card(former.name)).queryByTitle('حذف نقش')).not.toBeNull();
  });
});

describe('the system admin role ticks are shown but fixed (TD-886)', () => {
  it('shows every permission ticked and locked and saves only the name and description', async () => {
    fetchJson.mockResolvedValue({ success: true });
    const catalog = PERMISSION_CATALOG as unknown as PermissionCategory[];
    render(<RoleFormModal isOpen onClose={() => undefined} editingRole={{ ...admin, permissions: [] }} permCatalog={catalog} onSuccess={() => undefined} />);
    expect(screen.getByRole('note').textContent).toContain('همیشه همه مجوزها را دارد');
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(PERMISSION_KEYS.length);
    expect(boxes.every(b => b.checked && b.disabled)).toBe(true);
    fireEvent.click(screen.getByText('(customers.view)').closest('label')!);
    expect((within(screen.getByText('(customers.view)').closest('label')!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'پاکسازی' })).toBeNull();

    fireEvent.submit(boxes[0].closest('form')!);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    const [url, init] = fetchJson.mock.calls[0];
    expect(url).toBe('/roles/1');
    expect(JSON.parse(String(init.body))).toEqual({ name: admin.name, description: admin.description });
  });
});
