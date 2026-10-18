import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';
import { refuseInvalidDecimalInputs } from '../../components/common/DecimalInput';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({})) }));
vi.mock('../../hooks/accounting/useTreasuryQueries', () => ({ useContraAccountsQuery: () => ({ data: [], isLoading: false }) }));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import { VoucherItemsTable, type VoucherItemDraft } from '../../components/accounting/VoucherItemsTable';
import type { BankAccount } from '../../types';

afterEach(cleanup);

/** Persian text the field is expected to show, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  twelve: '۱۲',
  twelveTypedGroup: '۱۲٬',
  twelveTypedGroupFive: '۱۲٬۵',
  twelveFiveHundred: '۱۲٬۵۰۰',
  million: '۱٬۲۵۰٬۰۰۰',
  millionTypedGroupInMiddle: '۱٬۲٬۵۰٬۰۰۰',
  fiveThousand: '۵٬۰۰۰',
  twelveAndHalf: '۱۲٫۵',
  amountLabel: /مبلغ تراکنش/,
  reset: 'reset',
} as const;

/** the frame the field places its caret in */
async function nextFrame() {
  await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); });
}

/** a key typed where the caret is, as a browser reports it, then the frame in which the field places its caret */
async function typeAtCaret(input: HTMLInputElement, key: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + key + input.value.slice(end);
  const caret = start + key.length;
  fireEvent.change(input, { target: { value: next, selectionStart: caret, selectionEnd: caret } });
  await nextFrame();
}

/** Backspace as a browser reports it once the key's default action ran */
async function backspaceAtCaret(input: HTMLInputElement) {
  fireEvent.keyDown(input, { key: 'Backspace' });
  const caret = input.selectionStart ?? input.value.length;
  if (caret === 0) return;
  fireEvent.change(input, { target: { value: input.value.slice(0, caret - 1) + input.value.slice(caret), selectionStart: caret - 1, selectionEnd: caret - 1 } });
  await nextFrame();
}

async function typeKeys(input: HTMLInputElement, keys: string[]) {
  for (const key of keys) await typeAtCaret(input, key);
}

function AmountHost({ onValue, currency = 'IRR', initial = 0, onSubmit }: {
  onValue: (n: number) => void; currency?: string; initial?: number; onSubmit?: () => void;
}) {
  const [amount, setAmount] = useState(initial);
  return (
    <form data-decimal-scope="" onSubmit={e => { e.preventDefault(); onSubmit?.(); }}>
      <FinancialAmountInput value={amount} currency={currency} showWordsBadge={false} onChange={v => { onValue(v); setAmount(v); }} />
      <button type="button" onClick={() => setAmount(5000)}>{SHOWN.reset}</button>
      <button type="submit">submit</button>
    </form>
  );
}

function field(): HTMLInputElement {
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.focus();
  return input;
}

describe('TD-1291 the amount field keeps a misplaced thousands separator on the field as an error, like the number field', () => {
  it('1, 2, Shift+2, 5 typed key by key stays «12٬5» with an error and never becomes 125', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} />);
    const input = field();
    await typeKeys(input, ['1', '2']);
    expect(onValue).toHaveBeenLastCalledWith(12);
    await typeAtCaret(input, '٬');
    expect(input.value).toBe(SHOWN.twelveTypedGroup);
    expect(input.selectionStart).toBe(SHOWN.twelveTypedGroup.length);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onValue).toHaveBeenLastCalledWith(0);
    await typeAtCaret(input, '5');
    expect(input.value).toBe(SHOWN.twelveTypedGroupFive);
    expect(input.selectionStart).toBe(SHOWN.twelveTypedGroupFive.length);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onValue).not.toHaveBeenCalledWith(125);
    expect(onValue).toHaveBeenLastCalledWith(0);
    expect(input.validity.valid).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Backspace removes the user\'s separator and the amount comes back without an error', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', '5']);
    await backspaceAtCaret(input);
    expect(input.value).toBe(SHOWN.twelveTypedGroup);
    expect(screen.getByRole('alert')).toBeTruthy();
    await backspaceAtCaret(input);
    expect(input.value).toBe(SHOWN.twelve);
    expect(onValue).toHaveBeenLastCalledWith(12);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });

  it('a separator the user types between three-digit groups is still read: 1, 2, Shift+2, 5, 0, 0 is 12500', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', '5', '0', '0']);
    expect(input.value).toBe(SHOWN.twelveFiveHundred);
    expect(onValue).toHaveBeenLastCalledWith(12500);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });

  it('a separator typed in the middle of a grouped amount stays where it was typed, the caret after it', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} initial={1250000} />);
    const input = field();
    expect(input.value).toBe(SHOWN.million);
    input.setSelectionRange(3, 3);
    await typeAtCaret(input, '٬');
    expect(input.value).toBe(SHOWN.millionTypedGroupInMiddle);
    expect(input.selectionStart).toBe(4);
    expect(onValue).toHaveBeenLastCalledWith(0);
    // Backspace removes that separator, not the field's own one before it
    await backspaceAtCaret(input);
    expect(input.value).toBe(SHOWN.million);
    expect(input.selectionStart).toBe(3);
    expect(onValue).toHaveBeenLastCalledWith(1250000);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a letter typed after the misplaced separator is refused and the text with its error stays', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', 'x']);
    expect(input.value).toBe(SHOWN.twelveTypedGroup);
    expect(input.validity.valid).toBe(false);
    expect(onValue).toHaveBeenLastCalledWith(0);
  });

  it('a foreign-currency amount with «٬» meant as a decimal point stays an error until «٫» is typed', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} currency="USD" />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', '5']);
    expect(input.value).toBe(SHOWN.twelveTypedGroupFive);
    expect(onValue).not.toHaveBeenCalledWith(125);
    await backspaceAtCaret(input);
    await backspaceAtCaret(input);
    await typeKeys(input, ['٫', '5']);
    expect(input.value).toBe(SHOWN.twelveAndHalf);
    expect(onValue).toHaveBeenLastCalledWith(12.5);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaving the field keeps the misplaced separator and the form is not sent', async () => {
    const onSubmit = vi.fn();
    render(<AmountHost onValue={vi.fn()} onSubmit={onSubmit} />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', '5']);
    fireEvent.blur(input);
    expect(input.value).toBe(SHOWN.twelveTypedGroupFive);
    expect(input.closest('form')?.checkValidity()).toBe(false);
    fireEvent.click(screen.getByText('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    // a button that does not send the form refuses it too, like the number field
    expect(refuseInvalidDecimalInputs(input)).toBe(true);
  });

  it('a value set from outside (form reset, row auto-balance) replaces the misplaced text', async () => {
    const onValue = vi.fn();
    render(<AmountHost onValue={onValue} />);
    const input = field();
    await typeKeys(input, ['1', '2', '٬', '5']);
    fireEvent.click(screen.getByText(SHOWN.reset));
    expect(input.value).toBe(SHOWN.fiveThousand);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });

  it('the treasury receipt form keeps «12٬5» on its amount field as an error and its form is not valid', async () => {
    const bank = { id: 5, code: '1003-01', title: 'bank', type: 'bank', currency: 'IRR', currentBalance: 0, accountId: 40 } as unknown as BankAccount;
    const onSave = vi.fn(async () => undefined);
    render(
      <TreasuryTransactionModal isOpen onClose={() => undefined} type="receipt" bankAccounts={[bank]} customers={[]}
        personnelList={[]} appCurrency="IRR" onSave={onSave} />
    );
    const input = screen.getByLabelText(SHOWN.amountLabel) as HTMLInputElement;
    input.focus();
    await typeKeys(input, ['1', '2', '٬', '5']);
    expect(input.value).toBe(SHOWN.twelveTypedGroupFive);
    expect(input.validity.valid).toBe(false);
    expect(input.closest('form')?.checkValidity()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a voucher row\'s debit keeps «12٬5» as an error and the column total never shows 125', async () => {
    const row: VoucherItemDraft = { accountId: '', detailedType: 'none' as VoucherItemDraft['detailedType'], detailedId: null, detailedName: '', debit: 0, credit: 0, description: '' };
    let latest: VoucherItemDraft[] = [];
    function VoucherHost() {
      const [items, setItems] = useState<VoucherItemDraft[]>([row]);
      latest = items;
      const refs = useRef([{ debitRef: { current: null }, creditRef: { current: null } }]);
      return (
        <form>
          <VoucherItemsTable items={items} selectableAccounts={[]} customers={[]} personnelList={[]} header={{ currency: 'IRR' }}
            updateItem={(i, patch) => setItems(prev => prev.map((it, n) => (n === i ? { ...it, ...patch } : it)))}
            addRow={() => undefined} removeRow={() => undefined} handleAutoBalanceRow={() => undefined}
            handleSwapDebitCredit={() => undefined} rowRefs={refs} />
        </form>
      );
    }
    render(<QueryClientProvider client={new QueryClient()}><VoucherHost /></QueryClientProvider>);
    const [debit] = screen.getAllByRole('textbox').filter(el => el.getAttribute('data-decimal-input') !== null) as HTMLInputElement[];
    debit.focus();
    await typeKeys(debit, ['1', '2', '٬', '5']);
    expect(debit.value).toBe(SHOWN.twelveTypedGroupFive);
    expect(debit.validity.valid).toBe(false);
    expect(latest[0].debit).toBe(0);
    expect(document.body.textContent).not.toContain('۱۲۵');
  });
});
