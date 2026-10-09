import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { AppLayout } from '../../components/layout/AppLayout';
import { isMobileNavItemActive, MOBILE_MENU_LABEL, visibleMobileNavItems } from '../../components/layout/mobileNavItems';
import type { User } from '../../types';

// v10.0.17 (D-11): on a phone (narrower than 768 px) a bottom bar replaces the side menu. Each of its buttons follows the
// page access table, the collapsed menu takes no width, and the open menu covers the page and closes on navigation.

const fetchJson = vi.fn((..._args: unknown[]) => Promise.resolve({}));
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const user: User = { id: 7, username: 'worker', full_name: 'کارکن', role: 'custom_role' };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Shell({ permissions, startCollapsed = true }: { permissions: string[]; startCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  return (
    <AppLayout user={user} userPermissions={{ permissions, isAdmin: false }} onLogout={() => undefined} onUserUpdate={() => undefined}
      isProfileModalOpen={false} setIsProfileModalOpen={() => undefined} isSidebarCollapsed={collapsed} toggleSidebar={() => setCollapsed(c => !c)}>
      <GoTo />
    </AppLayout>
  );
}

function GoTo() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/audit')}>go-audit</button>;
}

function renderShell(permissions: string[], startCollapsed = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Shell permissions={permissions} startCollapsed={startCollapsed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('phone bottom bar (D-11)', () => {
  it('offers only the pages the role may open', () => {
    expect(visibleMobileNavItems({ permissions: ['audit.view'], isAdmin: false }).map(i => i.path)).toEqual(['/', '/audit']);
    expect(visibleMobileNavItems({ permissions: [], isAdmin: true }).map(i => i.path)).toEqual(['/', '/approval-inbox', '/audit', '/piecework']);
  });

  it('marks the dashboard active only on its own address', () => {
    expect(isMobileNavItemActive('/', '/audit')).toBe(false);
    expect(isMobileNavItemActive('/', '/')).toBe(true);
    expect(isMobileNavItemActive('/audit', '/audit')).toBe(true);
    expect(isMobileNavItemActive('/audit', '/auditx')).toBe(false);
  });

  it('renders the bar with the permitted links and a menu button', () => {
    renderShell(['piecework.view']);
    const bar = screen.getByRole('navigation', { name: 'نوار پایین' });
    expect(bar.className).toContain('md:hidden');
    const links = Array.from(bar.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(links).toEqual(['/', '/piecework']);
    expect(screen.getByText(MOBILE_MENU_LABEL)).toBeTruthy();
  });

  it('hides the collapsed side menu on a phone and opens it over the page', () => {
    const { container } = renderShell(['piecework.view']);
    const aside = () => container.querySelector('aside') as HTMLElement;
    expect(aside().className).toContain('hidden md:flex');
    expect(screen.queryByTestId('phone-menu-backdrop')).toBeNull();
    fireEvent.click(screen.getByText(MOBILE_MENU_LABEL));
    expect(aside().className).toContain('fixed');
    expect(aside().className).not.toMatch(/(^|\s)hidden(\s|$)/);
    fireEvent.click(screen.getByTestId('phone-menu-backdrop'));
    expect(aside().className).toContain('hidden md:flex');
  });

  it('closes the open menu when a phone moves to another page', () => {
    vi.stubGlobal('innerWidth', 390);
    const { container } = renderShell(['audit.view'], false);
    expect((container.querySelector('aside') as HTMLElement).className).not.toMatch(/(^|\s)hidden(\s|$)/);
    act(() => { fireEvent.click(screen.getByText('go-audit')); });
    expect((container.querySelector('aside') as HTMLElement).className).toContain('hidden md:flex');
    vi.unstubAllGlobals();
  });
});
