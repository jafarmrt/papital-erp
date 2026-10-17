import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DecimalInput } from '../../components/common/DecimalInput';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';

afterEach(cleanup);

/** Persian text the fields are expected to show, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  million: '۱٬۲۵۰٬۰۰۰',
  twelveFifty: '۱٬۲۵۰',
  twelveFiftyTypedGroup: '۱٬۲۵۰٬',
  billion: '۱٬۲۵۰٬۰۰۰٬۰۰۰',
  pastedGroup: '٬۰۰۰',
} as const;

/** «1٬250٬000» typed one key at a time, «٬» with Shift+2 */
const MILLION_KEYS = ['1', '٬', '2', '5', '0', '٬', '0', '0', '0'];

/** a key typed at the end of the field, as a browser reports it: the shown text plus the key, the caret after it */
function typeAtEnd(input: HTMLInputElement, key: string) {
  const next = input.value + key;
  fireEvent.change(input, { target: { value: next, selectionStart: next.length, selectionEnd: next.length } });
}

function NumberHost({ onValue }: { onValue: (text: string) => void }) {
  const [value, setValue] = useState<number | ''>('');
  return <DecimalInput aria-label="field" value={value} onValueChange={t => { onValue(t); setValue(t === '' ? '' : Number(t)); }} />;
}

describe('TD-1288 a thousands separator the user types between three-digit groups is read like a pasted one', () => {
  it('typing 1, Shift+2, 2, 5, 0, Shift+2, 0, 0, 0 one key at a time gives 1250000, as pasting it does', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    for (const key of MILLION_KEYS) typeAtEnd(input, key);
    expect(input.value).toBe(SHOWN.million);
    expect(onValue).toHaveBeenLastCalledWith('1250000');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });
  it('Backspace removes a separator the user typed; only the field\'s own separators are stepped over', () => {
    render(<NumberHost onValue={vi.fn()} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    input.focus();
    for (const key of ['1', '2', '5', '0', '٬']) typeAtEnd(input, key);
    expect(input.value).toBe(SHOWN.twelveFiftyTypedGroup);
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.selectionStart).toBe(SHOWN.twelveFiftyTypedGroup.length);
    // the separator removed, the number is the field's again and its separator is stepped over
    fireEvent.change(input, { target: { value: SHOWN.twelveFifty, selectionStart: 5, selectionEnd: 5 } });
    expect(input.value).toBe(SHOWN.twelveFifty);
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.selectionStart).toBe(1);
  });
  it('the amount field reads 1, Shift+2, 2, 5, 0, Shift+2, 0, 0, 0 typed one key at a time as 1250000, and a pasted group after the amount', () => {
    const onChange = vi.fn();
    function Host() {
      const [amount, setAmount] = useState(0);
      return <FinancialAmountInput value={amount} onChange={v => { onChange(v); setAmount(v); }} showWordsBadge={false} />;
    }
    render(<Host />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    for (const key of MILLION_KEYS) typeAtEnd(input, key);
    expect(onChange).toHaveBeenLastCalledWith(1250000);
    expect(input.value).toBe(SHOWN.million);
    expect(screen.queryByRole('alert')).toBeNull();
    typeAtEnd(input, SHOWN.pastedGroup);
    expect(onChange).toHaveBeenLastCalledWith(1250000000);
    expect(input.value).toBe(SHOWN.billion);
  });
});
