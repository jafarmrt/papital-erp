import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type FetchOpts = { method?: string };
let allocationsAnswer: () => Promise<unknown> = async () => ({ allocations: [] });
const fetchJson = vi.fn(async (url: string, _opts?: FetchOpts): Promise<unknown> => {
  if (url.startsWith('/inventory/allocations?')) return allocationsAnswer();
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string, opts?: FetchOpts) => fetchJson(url, opts) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => ({ data: [{ id: 3, code: 'WH-A', name: 'انبار نخست' }] }) }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
}));

import { ProjectBomAllocationsTab } from '../../components/inventory/ProjectBomAllocationsTab';
import { InventoryAuditHeader } from '../../components/inventory/InventoryAuditHeader';

afterEach(() => { cleanup(); vi.clearAllMocks(); granted.clear(); allocationsAnswer = async () => ({ allocations: [] }); });

const header = () => render(
  <InventoryAuditHeader activeTab="new_audit" onTabChange={() => undefined} discrepancyItems={0} onOpenRebuild={() => undefined} onOpenTransfer={() => undefined} />,
);

// v9.0.415 (TD-760): a refused allocation read looked like an empty list, and the tab showed for audit.view, which the API refuses
describe('project material allocations tab (TD-760)', () => {
  it('shows the read error with a retry instead of an empty list', async () => {
    // the server's Persian 403 message for the user (test data, not terminal output)
    const refused = Object.assign(new Error('forbidden'), { message: 'شما مجوز مشاهده این بخش را ندارید', status: 403 });
    allocationsAnswer = async () => { throw refused; };
    render(<QueryClientProvider client={new QueryClient()}><ProjectBomAllocationsTab /></QueryClientProvider>);
    expect(await screen.findByText('تخصیص‌های مواد اولیه خوانده نشد: شما مجوز مشاهده این بخش را ندارید')).toBeTruthy();
    expect(screen.queryByText('هیچ تخصیصی با پالایش جاری یافت نشد.')).toBeNull();

    allocationsAnswer = async () => ({ allocations: [] });
    fireEvent.click(screen.getByText('تلاش مجدد'));
    expect(await screen.findByText('هیچ تخصیصی با پالایش جاری یافت نشد.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('offers the tab only to the readers of its API', () => {
    granted.add('audit.view');
    header();
    expect(screen.queryByText('تخصیص مواد به پروژه‌ها')).toBeNull();
    cleanup();
    granted.add('projects.view');
    header();
    expect(screen.getByText('تخصیص مواد به پروژه‌ها')).toBeTruthy();
    cleanup();
    granted.clear();
    granted.add('warehouse.view');
    header();
    expect(screen.getByText('تخصیص مواد به پروژه‌ها')).toBeTruthy();
  });
});
