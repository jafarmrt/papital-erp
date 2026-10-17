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
  negativeTwelveFifty: '-۱٬۲۵۰',
  twelveMillionNineFifty: '۱۲٬۹۵۰٬۰۰۰',
  typedGroupInMiddle: '۱۲٬۹٬۵۰٬۰۰۰',
  twelveFiftyWithLetter: '۱۲۵۰a',
  twelveFiftyUngrouped: '۱۲۵۰',
} as const;

/** «1٬250٬000» typed one key at a time: «٬» with Shift+2, a Latin comma, and Arabic digits */
const MILLION_KEYS = ['1', '٬', '2', '5', '0', '٬', '0', '0', '0'];
const MILLION_SEQUENCES = [
  { name: 'Persian keyboard Shift+2', keys: MILLION_KEYS },
  { name: 'Latin comma', keys: ['1', ',', '2', '5', '0', ',', '0', '0', '0'] },
  { name: 'Arabic digits', keys: ['١', '٬', '٢', '٥', '٠', '٬', '٠', '٠', '٠'] },
];

/**
 * a key typed where the caret is, as a browser reports it: the selection replaced by the key and the caret after it.
 * The field's own caret placement decides where the next key goes, so a caret left before the user's separator shows.
 */
function typeAtCaret(input: HTMLInputElement, key: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + key + input.value.slice(end);
  const caret = start + key.length;
  fireEvent.change(input, { target: { value: next, selectionStart: caret, selectionEnd: caret } });
}

/** Backspace as a browser reports it once the key's default action ran: the character before the caret removed */
function backspaceAtCaret(input: HTMLInputElement) {
  fireEvent.keyDown(input, { key: 'Backspace' });
  const caret = input.selectionStart ?? input.value.length;
  if (caret === 0) return;
  fireEvent.change(input, { target: { value: input.value.slice(0, caret - 1) + input.value.slice(caret), selectionStart: caret - 1, selectionEnd: caret - 1 } });
}

function focusedField(): HTMLInputElement {
  const input = screen.getByLabelText('field') as HTMLInputElement;
  input.focus();
  return input;
}

function NumberHost({ onValue }: { onValue: (text: string) => void }) {
  const [value, setValue] = useState<number | ''>('');
  return <DecimalInput aria-label="field" value={value} onValueChange={t => { onValue(t); setValue(t === '' ? '' : Number(t)); }} />;
}

describe('TD-1288 a thousands separator the user types between three-digit groups is read like a pasted one', () => {
  it.each(MILLION_SEQUENCES)('typing 1,250,000 one key at a time at the caret gives 1250000, as pasting it does ($name)', ({ keys }) => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = focusedField();
    for (const key of keys) {
      typeAtCaret(input, key);
      // the caret stays after the key just typed, the user's own separator included
      expect(input.selectionStart).toBe(input.value.length);
    }
    expect(input.value).toBe(SHOWN.million);
    expect(onValue).toHaveBeenLastCalledWith('1250000');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });
  it('typing -1,250 with Shift+2 one key at a time at the caret gives -1250', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = focusedField();
    for (const key of ['-', '1', '٬', '2', '5', '0']) typeAtCaret(input, key);
    expect(input.value).toBe(SHOWN.negativeTwelveFifty);
    expect(onValue).toHaveBeenLastCalledWith('-1250');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('typing in the middle of a grouped number keeps the caret after the key, a typed separator included', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = focusedField();
    for (const key of MILLION_KEYS) typeAtCaret(input, key);
    input.setSelectionRange(3, 3);
    typeAtCaret(input, '9');
    expect(input.value).toBe(SHOWN.twelveMillionNineFifty);
    expect(onValue).toHaveBeenLastCalledWith('12950000');
    expect(input.selectionStart).toBe(4);
    // a separator typed there is the user's: shown where it was typed, an error, the caret after it
    typeAtCaret(input, '٬');
    expect(input.value).toBe(SHOWN.typedGroupInMiddle);
    expect(input.selectionStart).toBe(5);
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(input.validity.valid).toBe(false);
    backspaceAtCaret(input);
    expect(input.value).toBe(SHOWN.twelveMillionNineFifty);
    expect(input.selectionStart).toBe(4);
    expect(onValue).toHaveBeenLastCalledWith('12950000');
  });
  it('a letter typed after a grouped number keeps the caret after the letter once the field\'s separators are gone', () => {
    render(<NumberHost onValue={vi.fn()} />);
    const input = focusedField();
    for (const key of ['1', '2', '5', '0']) typeAtCaret(input, key);
    expect(input.value).toBe(SHOWN.twelveFifty);
    typeAtCaret(input, 'a');
    expect(input.value).toBe(SHOWN.twelveFiftyWithLetter);
    expect(input.selectionStart).toBe(SHOWN.twelveFiftyWithLetter.length);
    backspaceAtCaret(input);
    expect(input.value).toBe(SHOWN.twelveFifty);
    expect(input.selectionStart).toBe(SHOWN.twelveFifty.length);
  });
  it('deleting the field\'s own separator, which leaves the number as it was, keeps the separator and the caret', () => {
    render(<NumberHost onValue={vi.fn()} />);
    const input = focusedField();
    for (const key of ['1', '2', '5', '0']) typeAtCaret(input, key);
    fireEvent.change(input, { target: { value: SHOWN.twelveFiftyUngrouped, selectionStart: 1, selectionEnd: 1 } });
    expect(input.value).toBe(SHOWN.twelveFifty);
    expect(input.selectionStart).toBe(1);
  });
  it('Backspace removes a separator the user typed; only the field\'s own separators are stepped over', () => {
    render(<NumberHost onValue={vi.fn()} />);
    const input = focusedField();
    for (const key of ['1', '2', '5', '0', '٬']) typeAtCaret(input, key);
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
    for (const key of MILLION_KEYS) typeAtCaret(input, key);
    expect(onChange).toHaveBeenLastCalledWith(1250000);
    expect(input.value).toBe(SHOWN.million);
    expect(screen.queryByRole('alert')).toBeNull();
    input.setSelectionRange(input.value.length, input.value.length);
    typeAtCaret(input, SHOWN.pastedGroup);
    expect(onChange).toHaveBeenLastCalledWith(1250000000);
    expect(input.value).toBe(SHOWN.billion);
  });
});
