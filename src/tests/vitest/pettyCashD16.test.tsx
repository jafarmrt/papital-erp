import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn(async (_vars: unknown) => ({ id: 1 }));

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({})) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/accounting/usePettyCashQueries', () => ({
  usePettyCashExpenseAccountsQuery: () => ({
    data: [{ id: 76, code: '7002', name: 'هزینه اجاره کارگاه و دفتر', accountType: 'expense' }],
    isLoading: false,
  }),
  usePettyCashExpenseMutation: () => ({ mutateAsync, isPending: false }),
  usePettyCashLinesQuery: () => ({ data: [], isLoading: false, isError: false }),
}));

import {
  pettyCashCurrencyRefusal, pettyCashExpensePayload, pettyCashLinesTotal, pettyCashStatementError,
  PETTY_CASH_RIAL_ONLY_MESSAGE, emptyPettyCashLine,
} from '../../lib/treasury/pettyCash';
import { PettyCashExpenseModal } from '../../components/accounting/treasury/PettyCashExpenseModal';
import { BankAccountCard } from '../../components/accounting/treasury/BankAccountCard';
import { TreasuryTransferModal } from '../../components/accounting/treasury/TreasuryTransferModal';
import type { BankAccount } from '../../types';

afterEach(() => { cleanup(); mutateAsync.mockClear(); });

const AMOUNT_LABEL = 'مبلغ پرداخت‌شده (ریال) *';
const VAT_LABEL = 'مالیات بر ارزش افزوده ردیف ۱';

const fund = { id: 7, code: 'CASH-02', title: 'تنخواه کارگاه', type: 'petty_cash', currency: 'IRR', currentBalance: 1_000_000, accountId: 41 } as unknown as BankAccount;
const bank = { id: 5, code: '1003-01', title: 'بانک آزمون', type: 'bank', currency: 'IRR', currentBalance: 10_000_000, accountId: 40 } as unknown as BankAccount;

// v10.1.32 (D-16، ت۳۰ «متغیر»): قاعده مشترک صورت‌هزینه تنخواه
describe('petty cash statement rule (D-16)', () => {
  it('a petty cash fund is rial only, other account types keep any currency', () => {
    expect(pettyCashCurrencyRefusal('petty_cash', 'USD')).toBe(PETTY_CASH_RIAL_ONLY_MESSAGE);
    expect(pettyCashCurrencyRefusal('petty_cash', 'IRR')).toBe('');
    expect(pettyCashCurrencyRefusal('petty_cash', '')).toBe('');
    expect(pettyCashCurrencyRefusal('bank', 'USD')).toBe('');
  });

  it('each line needs an account and a positive amount; VAT, seller and invoice are optional', () => {
    expect(pettyCashStatementError([])).toContain('دست‌کم یک ردیف');
    expect(pettyCashStatementError([{ accountId: null, amount: '1000' }])).toContain('حساب هزینه');
    expect(pettyCashStatementError([{ accountId: 76, amount: '0' }])).toContain('بزرگ‌تر از صفر');
    expect(pettyCashStatementError([{ accountId: 76, amount: 'abc' }])).toContain('بزرگ‌تر از صفر');
    expect(pettyCashStatementError([{ accountId: 76, amount: '۲۵۰٬۰۰۰' }])).toBe('');
    expect(pettyCashStatementError([{ accountId: 76, amount: '۲۵۰٬۰۰۰', vatAmount: '' }])).toBe('');
    expect(pettyCashStatementError([{ accountId: 76, amount: '۲۵۰٬۰۰۰', vatAmount: '0' }])).toBe('');
  });

  it('an optional VAT is part of the line amount: below it, never negative or text', () => {
    expect(pettyCashStatementError([{ accountId: 76, amount: '250000', vatAmount: '۲۲٬۹۳۶' }])).toBe('');
    expect(pettyCashStatementError([{ accountId: 76, amount: '250000', vatAmount: '250000' }])).toContain('کمتر باشد');
    expect(pettyCashStatementError([{ accountId: 76, amount: '250000', vatAmount: '-1' }])).toContain('صفر یا بیشتر');
    expect(pettyCashStatementError([{ accountId: 76, amount: '250000', vatAmount: 'abc' }])).toContain('صفر یا بیشتر');
  });

  it('the total sums Persian-digit amounts and a statement above the balance is refused', () => {
    const lines = [{ accountId: 76, amount: '۶۰۰٬۰۰۰' }, { accountId: 77, amount: 500000 }];
    expect(pettyCashLinesTotal(lines).toNumber()).toBe(1_100_000);
    expect(pettyCashStatementError(lines, 1_000_000)).toContain('از مانده تنخواه بیشتر');
    expect(pettyCashStatementError(lines, 1_100_000)).toBe('');
  });

  it('the request body leaves out empty texts and an empty VAT', () => {
    const line = { ...emptyPettyCashLine(1), accountId: 76, amount: '250000', sellerName: '  ' };
    const body = pettyCashExpensePayload({ date: '', description: ' ', lines: [line], attachments: [] });
    expect(body).toEqual({
      date: undefined, description: undefined, attachments: undefined,
      lines: [{ accountId: 76, amount: '250000', vatAmount: undefined, description: undefined, sellerName: undefined, invoiceNumber: undefined }],
    });
  });
});

function pickExpenseAccount() {
  const input = screen.getByPlaceholderText('جست‌وجو و انتخاب حساب هزینه...');
  fireEvent.focus(input);
  fireEvent.click(screen.getByText(/هزینه اجاره کارگاه و دفتر/));
}

describe('petty cash statement window (D-16)', () => {
  it('records a statement with one expense line and no VAT or invoice data', async () => {
    const onClose = vi.fn();
    const { container } = render(<PettyCashExpenseModal fund={fund} appCurrency="IRR" onClose={onClose} />);
    pickExpenseAccount();
    fireEvent.change(screen.getByLabelText(AMOUNT_LABEL), { target: { value: '۲۵۰٬۰۰۰' } });
    fireEvent.submit(container.ownerDocument.getElementById('petty-cash-expense-form') as HTMLFormElement);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const { fundId, payload } = mutateAsync.mock.calls[0][0] as { fundId: number; payload: { lines: unknown[] } };
    expect(fundId).toBe(7);
    expect(payload.lines).toEqual([{ accountId: 76, amount: '250000', vatAmount: undefined, description: undefined, sellerName: undefined, invoiceNumber: undefined }]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a line may carry its VAT, sent in Latin digits as part of the amount', async () => {
    render(<PettyCashExpenseModal fund={fund} appCurrency="IRR" onClose={() => undefined} />);
    pickExpenseAccount();
    fireEvent.change(screen.getByLabelText(AMOUNT_LABEL), { target: { value: '۲۵۰٬۰۰۰' } });
    fireEvent.change(screen.getByLabelText(VAT_LABEL), { target: { value: '۲۲٬۹۳۶' } });
    fireEvent.submit(document.getElementById('petty-cash-expense-form') as HTMLFormElement);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const { payload } = mutateAsync.mock.calls[0][0] as { payload: { lines: Array<{ amount: string; vatAmount?: string }> } };
    expect(payload.lines[0]).toMatchObject({ amount: '250000', vatAmount: '22936' });
  });

  it('a statement above the fund balance is shown under the form and not sent', async () => {
    render(<PettyCashExpenseModal fund={fund} appCurrency="IRR" onClose={() => undefined} />);
    pickExpenseAccount();
    fireEvent.change(screen.getByLabelText(AMOUNT_LABEL), { target: { value: '1500000' } });
    fireEvent.submit(document.getElementById('petty-cash-expense-form') as HTMLFormElement);
    expect((await screen.findByRole('alert')).textContent).toContain('از مانده تنخواه بیشتر');
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe('petty cash actions on the treasury card (D-16)', () => {
  const cardProps = { appCurrency: 'IRR', copiedId: null, onCopy: () => undefined, onEdit: () => undefined, onDelete: () => undefined, onReconcile: () => undefined };

  it('a petty cash card offers charge, statement and return; a bank card does not', () => {
    const onPettyCash = vi.fn();
    const { unmount } = render(<BankAccountCard bank={fund} {...cardProps} onPettyCash={onPettyCash} />);
    fireEvent.click(screen.getByText('شارژ تنخواه'));
    fireEvent.click(screen.getByText('صورت‌هزینه'));
    fireEvent.click(screen.getByText('برگشت وجه'));
    expect(onPettyCash.mock.calls.map(call => call[1])).toEqual(['charge', 'expense', 'return']);
    unmount();
    render(<BankAccountCard bank={bank} {...cardProps} onPettyCash={onPettyCash} />);
    expect(screen.queryByText('شارژ تنخواه')).toBeNull();
  });

  it('charging opens the transfer form with the fund as its destination', () => {
    const { container } = render(
      <TreasuryTransferModal isOpen onClose={() => undefined} bankAccounts={[bank, fund]} appCurrency="IRR"
        onSave={async () => undefined} preset={{ toBankAccountId: fund.id }} />
    );
    const selects = container.querySelectorAll('select');
    expect((selects[0] as HTMLSelectElement).value).toBe('');
    expect((selects[1] as HTMLSelectElement).value).toBe(String(fund.id));
  });
});
