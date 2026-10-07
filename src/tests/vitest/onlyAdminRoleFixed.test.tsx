import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RolesTab } from '../../components/users/RolesTab';
import type { Role } from '../../types';

// v9.0.118 (TD-885، تصمیم ت۹ الف مدل مجوز): فقط «مدیر سیستم» نقش ثابت است. نقش پیش‌فرض قدیمی (که پیش‌تر «سیستمی» و
// حذف‌نشدنی بود) مثل هر نقش دیگری دکمه حذف دارد.
afterEach(cleanup);

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
