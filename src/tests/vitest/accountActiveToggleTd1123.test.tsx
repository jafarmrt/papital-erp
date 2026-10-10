import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t, toast: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));

import { ChartOfAccountsTab } from '../../components/accounting/ChartOfAccountsTab';

// TD-1123: the delete confirmation sends the user to deactivate an account with voucher rows, but the chart of accounts had
// no deactivate or reactivate control; the server has accepted isActive since v9.0.200.

const DEACTIVATE = 'غیرفعال کردن';
const REACTIVATE = 'فعال کردن دوباره';

afterEach(() => cleanup());

const account = (id: number, code: string, isSystem: number, isActive: number) => ({
  id, code, name: `حساب ${code}`, level: 'subsidiary', parentId: null, accountType: 'expense', nature: 'debit', isSystem, isActive, balance: 0, children: [],
});

function renderTable(onUpdateAccount = vi.fn(async () => undefined)) {
  render(<ChartOfAccountsTab accounts={[account(1, '7001', 1, 1), account(2, '7090', 0, 1), account(3, '7091', 0, 0)] as never}
    treeAccounts={[]} loading={false} onRefresh={() => {}} onCreateAccount={vi.fn()} onUpdateAccount={onUpdateAccount}
    onDeleteAccount={vi.fn()} onSeedStandardAccounts={vi.fn()} />);
  fireEvent.click(screen.getByText('نمای جدولی'));
  const row = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;
  return { row, onUpdateAccount };
}

describe('chart of accounts deactivates and reactivates an account (TD-1123)', () => {
  it('offers deactivate on an ordinary active account, reactivate on an inactive one and nothing on a system account', () => {
    const { row } = renderTable();
    expect(row('7001').querySelector(`button[title="${DEACTIVATE}"]`)).toBeNull();
    expect(row('7090').querySelector(`button[title="${DEACTIVATE}"]`)).not.toBeNull();
    expect(row('7091').querySelector(`button[title="${REACTIVATE}"]`)).not.toBeNull();
    expect(row('7091').textContent).toContain('غیرفعال');
  });

  it('sends only isActive to the account update', async () => {
    const { row, onUpdateAccount } = renderTable();
    fireEvent.click(row('7090').querySelector(`button[title="${DEACTIVATE}"]`) as HTMLElement);
    await waitFor(() => expect(onUpdateAccount).toHaveBeenCalledWith(2, { isActive: false }));
    fireEvent.click(row('7091').querySelector(`button[title="${REACTIVATE}"]`) as HTMLElement);
    await waitFor(() => expect(onUpdateAccount).toHaveBeenCalledWith(3, { isActive: true }));
  });
});
