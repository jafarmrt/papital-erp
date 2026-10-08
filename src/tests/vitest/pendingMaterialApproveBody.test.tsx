import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { approvePendingMaterialBody } from '../../routes/pendingMaterials.schemas';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'keeper' }, userPermissions: { permissions: ['pending_materials.view', 'pending_materials.approve'], isAdmin: false } }),
  useHasPermission: () => true,
}));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });
vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));

import PendingMaterialsPage from '../../pages/PendingMaterialsPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

/** The input under a form label (the material form's labels are not linked to their inputs) */
const fieldOf = (label: string): HTMLInputElement => {
  const input = screen.getByText(label).parentElement?.querySelector('input');
  if (!input) throw new Error(`no input under «${label}»`);
  return input;
};

const request = { id: 7, code: 'PM-7', name: 'سنگ نمونه', unit: 'عدد', category: 'سنگ', status: 'pending', weightedAverageCost: 1000, reorderPoint: 0, projectTitle: 'پروژه', requestedBy: 'کاربر' };

// v9.0.377 (TD-824، یافته B07-08): «تأیید و افزودن به انبار» بها و نقطه سفارشی را می‌فرستد که بررسی‌کننده وارد کرده است، با همان
// کلیدهایی که طرح سرور می‌خواند. پیش‌تر بدنه `weighted_average_cost` و `reorder_point` داشت و سرور آن‌ها را دور می‌ریخت.
describe('pending material approval body (TD-824)', () => {
  it('sends the edited cost and reorder point in the keys the route schema accepts', async () => {
    const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
    fetchJson.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { puts.push({ url, body: JSON.parse(String(init.body)) }); return Promise.resolve({ message: 'ok' }); }
      if (url.startsWith('/pending-materials')) return Promise.resolve([request]);
      if (url.startsWith('/categories')) return Promise.resolve([{ id: 1, name: 'سنگ' }]);
      return Promise.resolve({});
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><PendingMaterialsPage user={{ id: 1, username: 'keeper' } as never} /></MemoryRouter></QueryClientProvider>);

    fireEvent.click(await screen.findByText('تأیید'));
    fireEvent.change(fieldOf('قیمت / هزینه واحد تخمینی'), { target: { value: '75000' } });
    fireEvent.change(fieldOf('نقطه سفارش اولیه'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('تأیید و افزودن به انبار'));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0].url).toBe('/pending-materials/7/approve');
    expect(puts[0].body).toMatchObject({ weightedAverageCost: 75000, reorderPoint: 12 });
    expect(approvePendingMaterialBody.safeParse(puts[0].body).success).toBe(true);
  });
});
