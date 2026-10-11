import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowDesignerCanvas } from '../../components/workflow/WorkflowDesignerCanvas';

// v10.0.197 (TD-978): the workflow designer reads the role list from `GET /api/roles`, the route that exists,
// never from `/users/roles` (which `/users/:id` answers), so its role picker is filled even on a fresh page.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('WorkflowDesignerCanvas role list (TD-978)', () => {
  it('asks GET /roles on a fresh cache and never /users/roles', async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url === '/roles') return [{ id: 1, code: 'admin', name: 'مدیر سامانه' }, { id: 2, code: 'accountant', name: 'حسابدار' }];
      if (url.startsWith('/workflow/')) return { definition: { id: 7, title: 'تأیید فاکتور', entityType: 'document' }, states: [], transitions: [] };
      throw new Error(`no route for ${url}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WorkflowDesignerCanvas definitionId={7} onBack={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/roles'));
    expect(fetchJson.mock.calls.map(c => c[0])).not.toContain('/users/roles');
  });
});
