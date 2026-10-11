import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const fetchJson = vi.fn();
const held = new Set<string>();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'viewer' }, userPermissions: { permissions: [...held], isAdmin: false } }),
  useHasPermission: (key: string) => held.has(key),
}));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));

import PendingMaterialsPage from '../../pages/PendingMaterialsPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); held.clear(); });

const row = (id: number, status: string) => ({
  id, code: `PM-${id}`, name: `ماده ${id}`, unit: 'عدد', category: 'سنگ', status, weightedAverageCost: 1000, reorderPoint: 0, projectTitle: 'پروژه', requestedBy: 'کاربر',
});

const renderPage = (rows: unknown[]) => {
  fetchJson.mockImplementation((url: string) => {
    if (url.startsWith('/pending-materials')) return Promise.resolve({ data: rows, total: rows.length, page: 1, limit: 50, statusCounts: { pending: rows.length, approved: 0, rejected: 0 } });
    if (url.startsWith('/categories')) return Promise.resolve([{ id: 1, name: 'سنگ' }]);
    return Promise.resolve({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PendingMaterialsPage user={{ id: 1, username: 'viewer' } as never} /></MemoryRouter></QueryClientProvider>);
};

// v9.0.397 (TD-825، یافته B07-09): هر دکمه با مجوز مسیری که صدا می‌زند نشان داده می‌شود و درخواست بررسی‌شده فقط دیده می‌شود.
// پیش‌تر «تأیید»، «رد» و «حذف» برای هر بیننده و «حذف» برای درخواست تأییدشده هم نشان داده می‌شد.
describe('pending material page buttons (TD-825)', () => {
  it('shows a viewer without review keys only the view button', async () => {
    held.add('pending_materials.view');
    renderPage([row(1, 'pending')]);
    expect(await screen.findByText('مشاهده')).toBeTruthy();
    expect(screen.queryByText('تأیید')).toBeNull();
    expect(screen.queryByText('رد')).toBeNull();
    expect(screen.queryByTitle('حذف')).toBeNull();
  });

  it('offers review and delete only on a pending request', async () => {
    held.add('pending_materials.view').add('pending_materials.approve').add('pending_materials.delete');
    renderPage([row(1, 'pending'), row(2, 'approved')]);
    expect(await screen.findByText('تأیید')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^همه \(/ }));
    expect(screen.getAllByTitle('حذف')).toHaveLength(1);
    expect(screen.getAllByText('مشاهده')).toHaveLength(1);
  });
});
