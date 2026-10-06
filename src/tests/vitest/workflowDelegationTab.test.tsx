import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { WorkflowDelegationTab } from '../../components/workflow/WorkflowDelegationTab';

// Workflow delegation tab (package 14, PR د)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const definitions = [
  { id: 1, code: 'DOC_APPROVAL_WORKFLOW', title: 'تأیید فاکتور' },
  { id: 2, code: 'JOURNAL_VOUCHER_WORKFLOW', title: 'تأیید سند حسابداری' },
];

function routeDelegations(delegations: unknown[] = []) {
  fetchJson.mockImplementation((url: string) => {
    if (url === '/workflow/delegations') return Promise.resolve({ success: true, data: delegations });
    if (url === '/workflow/definitions') return Promise.resolve(definitions);
    if (url === '/users') return Promise.resolve([{ id: 2, username: 'deputy', full_name: 'جانشین' }]);
    return Promise.resolve({});
  });
}

describe('TD-467 delegation scope options are ALL and the defined workflows only', () => {
  it('offers no scope that matches no workflow', async () => {
    routeDelegations();
    wrap(<WorkflowDelegationTab />);
    fireEvent.click(await screen.findByText('ایجاد تفویض اختیار جدید'));
    await screen.findByText(/تأیید سند حسابداری/);
    const scopeSelect = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'ALL'))!;
    expect(Array.from(scopeSelect.options).map((o) => o.value)).toEqual(['ALL', 'DOC_APPROVAL_WORKFLOW', 'JOURNAL_VOUCHER_WORKFLOW']);
  });
});
