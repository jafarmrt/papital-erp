import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: async () => ({}) }));

import { TreasuryTransactionsTable } from '../../components/accounting/treasury/TreasuryTransactionsTable';

afterEach(cleanup);
const noop = () => undefined;
const bank = { id: 1, code: 'BANK-01', title: 'بانک ملت مرکزی', type: 'bank', bankName: 'ملت', currency: 'IRR', currentBalance: 0, accountId: 50 };
const row = (fields: Record<string, unknown>) => ({
  date: '2026-10-06', method: 'bank_transfer', amount: 5000000, currency: 'IRR', bankAccountId: 1, partyType: 'other', partyName: 'واریز',
  attachments: [], ...fields,
});

// v9.0.55 (TD-499, decision t1 «الف»): a reversal row (the void of another transaction) has no void button; the server refuses it too.
describe('treasury reversal rows cannot be voided (TD-499)', () => {
  it('only the live original row offers the void button', () => {
    const rows = [
      row({ id: 1, transactionNumber: 'REC-000001', type: 'receipt', status: 'voided', reversalOfId: null, voucherId: 8 }),
      row({ id: 2, transactionNumber: 'PAY-000002', type: 'payment', status: 'completed', reversalOfId: 1, voucherId: null }),
      row({ id: 3, transactionNumber: 'REC-000003', type: 'receipt', status: 'completed', reversalOfId: null, voucherId: 9 }),
    ];
    const onVoid = vi.fn();
    render(
      <TreasuryTransactionsTable transactions={rows as never} totalFilteredCount={3} bankAccounts={[bank] as never} runningBalanceMap={new Map()}
        appCurrency="IRR" searchQuery="" setSearchQuery={noop} selectedTypeFilter="all" setSelectedTypeFilter={noop} selectedMethodFilter="all"
        setSelectedMethodFilter={noop} txAccountFilter="all" setTxAccountFilter={noop} dateFromFilter="" setDateFromFilter={noop} dateToFilter=""
        setDateToFilter={noop} txPage={1} setTxPage={noop} pageSize={20} copiedId={null} onCopy={noop} onExportExcel={noop}
        onViewAttachments={noop} onVoidTransaction={onVoid} />,
    );
    const voidButtons = screen.getAllByTitle('ابطال تراکنش و ثبت سند معکوس');
    expect(voidButtons).toHaveLength(1);
    fireEvent.click(voidButtons[0]);
    expect(onVoid.mock.calls[0][0].transactionNumber).toBe('REC-000003');
  });
});
