import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../../components/layout/AppLayout';
import type { User } from '../../types';

// TD-1154: Ctrl+K focuses the global search of the top bar. Before, the side menu also listened to Ctrl+K and focused
// its own menu search 100 ms later, so the global search lost the focus it had just taken.

vi.mock('../../api', () => ({ fetchJson: () => Promise.resolve({}) }));

const user: User = { id: 7, username: 'worker', full_name: 'کارکن', role: 'custom_role' };

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Ctrl+K shortcut (TD-1154)', () => {
  it('leaves the focus in the global search, with the side menu open', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/']}>
          <AppLayout user={user} userPermissions={{ permissions: ['products.view'], isAdmin: false }} onLogout={() => undefined}
            onUserUpdate={() => undefined} isProfileModalOpen={false} setIsProfileModalOpen={() => undefined}
            isSidebarCollapsed={false} toggleSidebar={() => undefined}>
            <div />
          </AppLayout>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await act(() => new Promise(resolve => setTimeout(resolve, 200)));
    const focused = document.activeElement as HTMLInputElement | null;
    expect(focused?.getAttribute('placeholder') ?? '').toContain('جستجوی سراسری');
  });
});
