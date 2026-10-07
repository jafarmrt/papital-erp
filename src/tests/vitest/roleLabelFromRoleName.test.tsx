import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { User } from '../../types';

// v9.0.144 (TD-894، یافته O14 بسته ۲): نوار بالا و نمایه نام ذخیره‌شده نقش را نشان می‌دهند، نه برچسبی که از روی کد نقش
// ساخته شده («سرپرست انبار» برای `manager`، «کاربر تماشاگر» یا کد خام برای بقیه).
vi.mock('../../api', () => ({ fetchJson: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../components/GlobalHeaderSearch', () => ({ default: () => null }));
vi.mock('../../components/NotificationBell', () => ({ default: () => null }));

import { TopBar } from '../../components/layout/TopBar';
import UserProfileModal from '../../components/UserProfileModal';

const userWithRole = (role: string): User => ({ id: 1, username: 'u', full_name: 'کاربر آزمون', role });
const noop = () => undefined;

afterEach(cleanup);

describe('the role label is the role\'s stored name, not a label built from its code (TD-894)', () => {
  it('the top bar shows the stored role name and no fixed label for the manager code', () => {
    const { unmount } = render(
      <TopBar user={userWithRole('manager')} userPermissions={{ permissions: [], isAdmin: false, roleName: 'مدیر عمومی' }}
        onToggleSidebar={noop} isSidebarCollapsed={false} onOpenProfile={noop} />,
    );
    expect(screen.getByText('مدیر عمومی')).toBeTruthy();
    unmount();

    render(
      <TopBar user={userWithRole('manager')} userPermissions={{ permissions: [], isAdmin: false }}
        onToggleSidebar={noop} isSidebarCollapsed={false} onOpenProfile={noop} />,
    );
    expect(screen.queryByText('سرپرست انبار')).toBeNull();
    expect(screen.queryByText('کاربر تماشاگر')).toBeNull();
  });

  it('the profile shows the stored role name for the manager code and for any other role, never the raw code', () => {
    const { unmount } = render(
      <UserProfileModal user={userWithRole('manager')} isOpen onClose={noop} onUserUpdate={noop} roleName="مدیر عمومی" />,
    );
    expect(screen.getByText('مدیر عمومی')).toBeTruthy();
    expect(screen.queryByText('سرپرست انبار')).toBeNull();
    unmount();

    render(<UserProfileModal user={userWithRole('sales_agent')} isOpen onClose={noop} onUserUpdate={noop} roleName="کارشناس فروش" />);
    expect(screen.getByText('کارشناس فروش')).toBeTruthy();
    expect(screen.queryByText('sales_agent')).toBeNull();
  });
});
