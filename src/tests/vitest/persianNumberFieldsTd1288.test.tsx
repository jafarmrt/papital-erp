import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { useState } from 'react';
import { DecimalInput } from '../../components/common/DecimalInput';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';
import { InvoiceServiceChargeField } from '../../components/invoices/create/InvoiceServiceChargeField';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import { decimalDisplayText } from '../../lib/decimalInputText';
import { readAmountText } from '../../lib/amountText';
import {
  caretAfterSignificant, persianNumberText, significantCharsBefore, stepOverGroupSeparator, withoutFieldSeparators
} from '../../lib/numberFieldDisplay';
import type { User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (...args: unknown[]) => toastError(...args), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastError.mockReset();
});

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
  twelve: '۱۲',
  typedGroupAfterTwelve: '۱۲٬۵',
  oneTwentyFiveGrouped: '۱٬۲۵',
  twelveFifty: '۱٬۲۵۰',
  twelveFiftyWithTypedGroup: '۱٬۲۵٬۰',
  quarterMillion: '۲۵۰٬۰۰۰',
  leadingZeros: '۰۰۰۱٬۲۵۰',
  twelveFiftyTypedGroup: '۱٬۲۵۰٬',
  copiedAmount: '۱٬۲۵۰٬۰۰۰ ریال',
  serviceChargeLabel: 'هزینه ارسال و خدمات',
  edit: 'ویرایش',
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

/** a key typed at the end of the field, as a browser reports it: the shown text plus the key, the caret after it */
function typeAtEnd(input: HTMLInputElement, key: string) {
  const next = input.value + key;
  fireEvent.change(input, { target: { value: next, selectionStart: next.length, selectionEnd: next.length } });
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

  it('a separator the user types is kept and refused: 12, Shift+2, 5 is an error and sends an empty value, never 125', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    for (const key of ['1', '2', '٬', '5']) typeAtEnd(input, key);
    expect(input.value).toBe(SHOWN.typedGroupAfterTwelve);
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(input.validity.valid).toBe(false);
    // removing the typed separator gives the number back
    fireEvent.change(input, { target: { value: SHOWN.twelve + '5', selectionStart: 3, selectionEnd: 3 } });
    expect(onValue).toHaveBeenLastCalledWith('125');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a pasted or typed separator outside three-digit groups is refused and sends an empty value', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: SHOWN.typedGroupAfterTwelve } });
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: SHOWN.oneTwentyFiveGrouped } });
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: SHOWN.million } });
    expect(onValue).toHaveBeenLastCalledWith('1250000');
  });

  it('a separator typed inside a grouped number is the user\'s and is refused, the field\'s own ones are not', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1250' } });
    expect(input.value).toBe(SHOWN.twelveFifty);
    // «٬» typed between «۵» and «۰»: the caret is after it
    fireEvent.change(input, { target: { value: SHOWN.twelveFiftyWithTypedGroup, selectionStart: 5, selectionEnd: 5 } });
    expect(onValue).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('deleting the first digit before a separator keeps the number valid', () => {
    const onValue = vi.fn();
    render(<NumberHost onValue={onValue} />);
    const input = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1250000' } });
    // «۱» removed with the caret at the start, the field's separators remain in the text
    fireEvent.change(input, { target: { value: SHOWN.million.slice(1), selectionStart: 0, selectionEnd: 0 } });
    expect(onValue).toHaveBeenLastCalledWith('250000');
    expect(input.value).toBe(SHOWN.quarterMillion);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('withoutFieldSeparators drops only the separators of the part the edit kept', () => {
    // a digit added at the end
    expect(withoutFieldSeparators(SHOWN.twelveFifty, SHOWN.twelveFifty + '0', 6)).toBe('۱۲۵۰0');
    // a separator typed after «۱۲»
    expect(withoutFieldSeparators(SHOWN.twelve, SHOWN.twelve + '٬', 3)).toBe('۱۲٬');
    // a separator typed inside a grouped number: every separator then counts as the user's and is checked
    expect(withoutFieldSeparators(SHOWN.twelveFifty, SHOWN.twelveFiftyWithTypedGroup, 5)).toBe(SHOWN.twelveFiftyWithTypedGroup);
    // a separator typed after a grouped number keeps the separators before it, so 1,250, then 000 reads 1250000
    expect(withoutFieldSeparators(SHOWN.twelveFifty, SHOWN.twelveFiftyTypedGroup, 6)).toBe(SHOWN.twelveFiftyTypedGroup);
    // a grouped number pasted over the whole text
    expect(withoutFieldSeparators(SHOWN.twelve, SHOWN.million, SHOWN.million.length)).toBe(SHOWN.million);
    expect(persianNumberText('0001250', true)).toBe(SHOWN.leadingZeros);
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

  it('the amount field keeps a typed separator outside three-digit groups on the field as an error, never as thousands', () => {
    const onChange = vi.fn();
    function Host() {
      const [amount, setAmount] = useState(0);
      return <FinancialAmountInput value={amount} onChange={v => { onChange(v); setAmount(v); }} showWordsBadge={false} />;
    }
    render(<Host />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    for (const key of ['1', '2']) typeAtEnd(input, key);
    expect(onChange).toHaveBeenLastCalledWith(12);
    // v10.2.4 (TD-1291): like the number field, «٬» stays where it was typed with an error and the amount is empty (0)
    typeAtEnd(input, '٬');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(input.value).toBe(`${SHOWN.twelve}٬`);
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(input.validity.valid).toBe(false);
    // «۱۲٬۵» pasted at once was 125 on v10.1.70; it stays on the field as an error
    fireEvent.change(input, { target: { value: SHOWN.typedGroupAfterTwelve } });
    expect(onChange).not.toHaveBeenCalledWith(125);
    expect(input.value).toBe(SHOWN.typedGroupAfterTwelve);
    expect(onChange).toHaveBeenLastCalledWith(0);
    // the amount copied from the app, with its separators and currency, is read in full
    fireEvent.change(input, { target: { value: SHOWN.copiedAmount } });
    expect(onChange).toHaveBeenLastCalledWith(1250000);
    expect(input.validity.valid).toBe(true);
    expect(readAmountText('12,5', { scale: 0, allowNegative: false }).ok).toBe(false);
    expect(readAmountText(SHOWN.typedGroupAfterTwelve, { scale: 0, allowNegative: false }).ok).toBe(false);
    expect(readAmountText('1,250,000', { scale: 0, allowNegative: false })).toEqual({ ok: true, text: '1250000', value: 1250000 });
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

  it('the invoice form refuses a service charge that is not a number instead of saving it as zero', async () => {
    const proforma = {
      id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'buyer', currency: 'IRR', version: 1,
      items: [{ document_id: 5, item_id: 3, quantity: 1, unit_price: 1000, unitPrice: 1000, discount: 0, location: 'WH1', name: 'item', code: 'P-3', unit: 'u' }],
    };
    fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'WH', code: 'WH1', is_active: 1 }]);
      if (url.startsWith('/documents?statuses=proforma,draft')) return Promise.resolve({ data: [proforma], total: 1, page: 1, limit: 20 });
      if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
      if (url === '/documents/5') return Promise.resolve(init?.method === 'PUT' ? { success: true } : proforma);
      return Promise.resolve([]);
    });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    const user: User = { id: 1, username: 'admin', full_name: 'admin', role: 'admin' };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><CreateInvoicePage user={user} /></MemoryRouter>
      </QueryClientProvider>,
    );
    const row = (await screen.findByText('PF-5')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText(SHOWN.edit));
    const field = (await screen.findByLabelText(SHOWN.serviceChargeLabel)) as HTMLInputElement;
    const saves = () => fetchJson.mock.calls.filter(([url, init]) => url === '/documents/5' && init?.method === 'PUT');
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(field.validity.valid).toBe(false);
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(saves()).toHaveLength(0);
    // a valid amount is saved with the proforma
    fireEvent.change(field, { target: { value: '50' } });
    expect(field.validity.valid).toBe(true);
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(JSON.parse(String((saves()[0][1] as { body: string }).body)).serviceChargeAmount).toBe('50');
  });

  it('the invoice page takes its date, currencies and number fields from the shared fields', () => {
    const page = ['pages/CreateInvoicePage.tsx', 'components/invoices/create/InvoiceHeaderFields.tsx', 'components/invoices/create/InvoiceLinePicker.tsx']
      .map(file => readFileSync(join(SRC, file), 'utf8')).join('\n');
    expect(page).toContain('<JalaliDateInput');
    expect(page).toContain('TREASURY_CURRENCIES.map(');
    expect(page).not.toMatch(/<option value="(IRR|USD|EUR|AED|GBP)">/);
    expect(page).not.toMatch(/<input[^>]*inputMode/);
  });

  it('no screen uses the date picker library directly; dates go through JalaliDateInput', () => {
    const offending = productionSources(SRC)
      .filter(file => !file.endsWith(join('components', 'common', 'JalaliDateInput.tsx')))
      .filter(file => /(from\s*|import\(\s*|require\(\s*)['"]react-multi-date-picker(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')))
      .map(file => relative(SRC, file));
    expect(offending).toEqual([]);
  });
});
