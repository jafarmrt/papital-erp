import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PartyTemporaryRowsPanel } from '../../components/accounting/reports/PartyTemporaryRowsPanel';
import { PartyPurposeFields } from '../../components/accounting/treasury/PartyPurposeFields';
import { PARTY_TEMPORARY_ROWS_TITLE, isTemporaryAccountType, partyTemporaryRowsOf } from '../../lib/accounting/partyTemporaryRows';
import { PERSONNEL_PURPOSES, personnelPurposeLabel } from '../../lib/treasury/partyPurpose';

const DEDUCTIONS_LABEL = 'واریز کسورات حقوق';

describe('v10.0.257 party temporary rows and the deductions purpose (TD-915 / TD-924 / TD-952)', () => {
  it('treats revenue, expense and cost of sales as temporary accounts only', () => {
    expect(['revenue', 'expense', 'cost_of_sales'].every(isTemporaryAccountType)).toBe(true);
    expect(['asset', 'liability', 'equity', '', null].some(isTemporaryAccountType)).toBe(false);
    expect(partyTemporaryRowsOf(null)).toEqual([]);
  });

  it('lists the temporary rows apart with their totals and renders nothing without rows', () => {
    const rows = {
      items: [{ voucherId: 7, voucherNumber: 12, date: '2026-04-01', description: 'donated goods', accountCode: '5204', accountName: 'donated income', currency: 'IRR', debit: 0, credit: 600000 }],
      totalDebit: 0,
      totalCredit: 600000,
    };
    const { container, unmount } = render(<PartyTemporaryRowsPanel rows={rows} formatAmount={v => `amount:${v}`} />);
    expect(screen.getByText(PARTY_TEMPORARY_ROWS_TITLE)).toBeTruthy();
    expect(screen.getAllByText('amount:600000').length).toBe(2);
    expect(container.textContent).toContain('۵۲۰۴');
    unmount();
    const empty = render(<PartyTemporaryRowsPanel rows={{ items: [], totalDebit: 0, totalCredit: 0 }} formatAmount={String} />);
    expect(empty.container.textContent).toBe('');
  });

  it('offers the deductions purpose for a personnel payment and not for a receipt', () => {
    expect(PERSONNEL_PURPOSES).toContain('deductions');
    expect(personnelPurposeLabel('deductions')).toBe(DEDUCTIONS_LABEL);
    const noop = () => undefined;
    const payment = render(<PartyPurposeFields partyType="personnel" purpose="" contraAccountId={null} isReceipt={false} onChange={noop} />);
    expect(payment.container.querySelector('option[value="deductions"]')).not.toBeNull();
    payment.unmount();
    const receipt = render(<PartyPurposeFields partyType="personnel" purpose="" contraAccountId={null} isReceipt onChange={noop} />);
    expect(receipt.container.querySelector('option[value="deductions"]')).toBeNull();
  });
});
