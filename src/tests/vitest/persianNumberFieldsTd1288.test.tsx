import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { useState } from 'react';
import { DecimalInput } from '../../components/common/DecimalInput';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';
import { InvoiceServiceChargeField } from '../../components/invoices/create/InvoiceServiceChargeField';
import { decimalDisplayText } from '../../lib/decimalInputText';
import {
  caretAfterSignificant, persianNumberText, significantCharsBefore, stepOverGroupSeparator
} from '../../lib/numberFieldDisplay';

afterEach(cleanup);

const SRC = resolve(__dirname, '../..');

/** Persian text the fields are expected to show, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  million: '۱٬۲۵۰٬۰۰۰',
  twelveFiveHundred: '۱۲٬۵۰۰',
  oneTwenty: '۱۲۰',
  decimal: '۱٬۲۳۴٫۵',
  orderId: '۱۰۴۲۵',
  invalid: '۱۲a',
  serviceCharge: '۲۵۰٬۰۰۰',
} as const;

function productionSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'tests') productionSources(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function NumberHost({ grouped, onValue }: { grouped?: boolean; onValue: (text: string) => void }) {
  const [value, setValue] = useState<number | ''>('');
  return (
    <DecimalInput
      aria-label="field"
      value={value}
      grouped={grouped}
      onValueChange={t => { onValue(t); setValue(t === '' ? '' : Number(t)); }}
    />
  );
}

describe('TD-1288 number and amount fields show Persian digits and Persian thousands separators while typing', () => {
  it('builds the shown text from the Latin text: Persian digits and the Persian decimal and thousands separators', () => {
    expect(persianNumberText('1250000', true)).toBe(SHOWN.million);
    expect(persianNumberText('1234.5', true)).toBe(SHOWN.decimal);
    expect(persianNumberText('10425', false)).toBe(SHOWN.orderId);
    expect(persianNumberText('-', true)).toBe('-');
    expect(decimalDisplayText('1,250,000', true)).toBe(SHOWN.million);
    expect(decimalDisplayText('12a', true)).toBe(SHOWN.invalid);
  });

  it('a number field typed with a Latin keyboard shows Persian grouped digits and still sends the Latin value', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1250000' } });
    expect(input.value).toBe(SHOWN.million);
    expect(onValue).toHaveBeenLastCalledWith('1250000');
  });

  it('typing one more digit or removing one regroups the number instead of reporting a broken group', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1250' } });
    fireEvent.change(input, { target: { value: `${input.value}0` } });
    expect(input.value).toBe(SHOWN.twelveFiveHundred);
    expect(onValue).toHaveBeenLastCalledWith('12500');
    fireEvent.change(input, { target: { value: '1250' } });
    // «۱٬۲۵۰» with the «۵» removed
    fireEvent.change(input, { target: { value: input.value.replace('۵', '') } });
    expect(input.value).toBe(SHOWN.oneTwenty);
    expect(onValue).toHaveBeenLastCalledWith('120');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an identifier field (grouped={false}) shows Persian digits without separators', () => {
    const onValue = vi.fn();
    render(<NumberHost grouped={false} onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10425' } });
    expect(input.value).toBe(SHOWN.orderId);
    expect(onValue).toHaveBeenLastCalledWith('10425');
  });

  it('keeps the caret after the same digit when separators are added', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '125000' } });
    // a «0» typed after the first digit: «1» + «0» + «25000», caret after the typed digit
    fireEvent.change(input, { target: { value: '1025000', selectionStart: 2, selectionEnd: 2 } });
    expect(input.value).toBe('۱٬۰۲۵٬۰۰۰');
    expect(input.selectionStart).toBe(3);
    expect(significantCharsBefore('۱٬۰۲۵', 3)).toBe(2);
    expect(caretAfterSignificant('۱٬۰۲۵٬۰۰۰', 2)).toBe(3);
  });

  it('Backspace right after a separator moves the caret over it so the digit before it is removed', () => {
    const input = document.createElement('input');
    input.value = '۱٬۲۵۰';
    document.body.appendChild(input);
    input.setSelectionRange(2, 2);
    stepOverGroupSeparator(input, 'Backspace');
    expect(input.selectionStart).toBe(1);
    input.setSelectionRange(1, 1);
    stepOverGroupSeparator(input, 'Delete');
    expect(input.selectionStart).toBe(2);
    input.remove();
  });

  it('the shared amount field shows Persian grouped digits for a Latin-typed amount', () => {
    const onChange = vi.fn();
    function Host() {
      const [amount, setAmount] = useState(0);
      return <FinancialAmountInput value={amount} onChange={v => { onChange(v); setAmount(v); }} showWordsBadge={false} />;
    }
    render(<Host />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1250000' } });
    expect(onChange).toHaveBeenLastCalledWith(1250000);
    expect(input.value).toBe(SHOWN.million);
  });

  it('the invoice service charge uses the shared number field', () => {
    let value = '';
    function Host() {
      const [text, setText] = useState('');
      return <InvoiceServiceChargeField value={text} onChange={v => { value = v; setText(v); }} error={null} currency="IRR" />;
    }
    render(<Host />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    fireEvent.change(input, { target: { value: '250000' } });
    expect(value).toBe('250000');
    expect(input.value).toBe(SHOWN.serviceCharge);
  });

  it('the invoice page takes its date, currencies and number fields from the shared fields', () => {
    const page = readFileSync(join(SRC, 'pages/CreateInvoicePage.tsx'), 'utf8');
    expect(page).toContain('<JalaliDateInput');
    expect(page).toContain('TREASURY_CURRENCIES.map(');
    expect(page).not.toMatch(/<option value="(IRR|USD|EUR|AED|GBP)">/);
    expect(page).not.toMatch(/<input[^>]*inputMode/);
  });

  it('no screen uses the date picker library directly; dates go through JalaliDateInput', () => {
    const offending = productionSources(SRC)
      .filter(file => !file.endsWith(join('components', 'common', 'JalaliDateInput.tsx')))
      .filter(file => /from ['"]react-multi-date-picker['"]/.test(readFileSync(file, 'utf8')))
      .map(file => relative(SRC, file));
    expect(offending).toEqual([]);
  });
});
