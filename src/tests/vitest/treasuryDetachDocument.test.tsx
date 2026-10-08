import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => ({}) }));

import { TreasuryTransactionsTable } from '../../components/accounting/treasury/TreasuryTransactionsTable';

afterEach(cleanup);
const noop = () => undefined;
const bank = { id: 1, code: 'BANK-01', title: 'بانک ملت مرکزی', type: 'bank', bankName: 'ملت', currency: 'IRR', currentBalance: 0, accountId: 50 };
const row = (fields: Record<string, unknown>) => ({
  date: '2026-10-07', method: 'bank_transfer', amount: 3000000, currency: 'IRR', bankAccountId: 1, partyType: 'customer', partyName: 'مشتری',
  type: 'receipt', status: 'completed', reversalOfId: null, voucherId: 7, attachments: [], ...fields,
});

// v9.0.272 (TD-779, decision t4 «الف» of package 8): an invoice with a live receipt is not voided, so the treasury table offers
// to move a live receipt that is linked to a document on account; voided, reversal, payroll and unlinked rows get no button.
describe('treasury rows linked to a document can be moved on account (TD-779)', () => {
  it('shows the button only on live linked rows and passes the row to the handler', () => {
    const rows = [
      row({ id: 1, transactionNumber: 'REC-000001', documentId: 40 }),
      row({ id: 2, transactionNumber: 'REC-000002', documentId: null }),
      row({ id: 3, transactionNumber: 'REC-000003', documentId: 41, status: 'voided' }),
      row({ id: 4, transactionNumber: 'PAY-000004', type: 'payment', documentId: 41, reversalOfId: 3 }),
      row({ id: 5, transactionNumber: 'PAY-000005', type: 'payment', documentId: 42, payrollId: 9 }),
    ];
    const onDetach = vi.fn();
    render(
      <TreasuryTransactionsTable transactions={rows as never} totalFilteredCount={5} bankAccounts={[bank] as never} runningBalanceMap={new Map()}
        appCurrency="IRR" searchQuery="" setSearchQuery={noop} selectedTypeFilter="all" setSelectedTypeFilter={noop} selectedMethodFilter="all"
        setSelectedMethodFilter={noop} txAccountFilter="all" setTxAccountFilter={noop} dateFromFilter="" setDateFromFilter={noop} dateToFilter=""
        setDateToFilter={noop} txPage={1} setTxPage={noop} pageSize={20} copiedId={null} onCopy={noop} onExportExcel={noop}
        onViewAttachments={noop} onVoidTransaction={noop} onDetachDocument={onDetach} />,
    );
    const buttons = screen.getAllByTitle('جدا کردن از سند (علی‌الحساب)');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onDetach.mock.calls[0][0].transactionNumber).toBe('REC-000001');
  });
});
