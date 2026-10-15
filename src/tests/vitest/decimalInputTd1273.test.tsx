import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { useState } from 'react';
import { DecimalInput, refuseInvalidDecimalInputs } from '../../components/common/DecimalInput';
import { PayrollDeductionsField } from '../../components/piecework/PayrollDeductionsField';
import { DocItemsTable } from '../../components/documents/DocItemsTable';
import { readDecimalInputText } from '../../lib/decimalInputText';
import type { Item } from '../../types';

afterEach(cleanup);

const SRC = resolve(__dirname, '../..');
const NUMBER_INPUT = /type=["'{]+number["'}]+/g;
/**
 * The only `type="number"` inputs left: the workflow designer canvas (step order and SLA hours), which the D-06 part D
 * lane is changing. The count only goes down; lower it here when a file drops one.
 */
const NUMBER_INPUT_BASELINE: Record<string, number> = {
  'components/workflow/WorkflowDesignerCanvas.tsx': 3,
};

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

describe('TD-1273 numeric fields read Persian digits and the Persian decimal separator', () => {
  it('the reader turns Persian digits, the Persian decimal mark and thousands separators into Latin text and never reads garbage as zero', () => {
    expect(readDecimalInputText('۱۲۵')).toEqual({ kind: 'value', text: '125' });
    expect(readDecimalInputText('12٫5')).toEqual({ kind: 'value', text: '12.5' });
    expect(readDecimalInputText('۱٬۲۵۰٬۰۰۰')).toEqual({ kind: 'value', text: '1250000' });
    expect(readDecimalInputText('')).toEqual({ kind: 'value', text: '' });
    expect(readDecimalInputText('.')).toEqual({ kind: 'partial' });
    expect(readDecimalInputText('12a').kind).toBe('invalid');
    expect(readDecimalInputText('-5', { min: 0 }).kind).toBe('invalid');
    expect(readDecimalInputText('-5')).toEqual({ kind: 'value', text: '-5' });
    expect(readDecimalInputText('0', { min: 1 })).toMatchObject({ kind: 'value', text: '0', rangeError: expect.any(String) });
    expect(readDecimalInputText('1.5', { step: '1' })).toMatchObject({ kind: 'value', rangeError: expect.any(String) });
    expect(readDecimalInputText('1.25', { step: '0.01' })).toEqual({ kind: 'value', text: '1.25' });
  });

  it('the shared field opens the decimal keypad, reports Persian-digit 125 as 125 and 12.5 written with the Persian decimal mark as 12.5, and keeps the typed text', () => {
    const onValueChange = vi.fn();
    function Host() {
      const [v, setV] = useState<number | ''>('');
      return <DecimalInput aria-label="مقدار" value={v} onValueChange={t => { onValueChange(t); setV(t === '' ? '' : Number(t)); }} />;
    }
    render(<Host />);
    const input = screen.getByLabelText('مقدار') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('dir')).toBe('ltr');
    fireEvent.change(input, { target: { value: '۱۲۵' } });
    expect(onValueChange).toHaveBeenLastCalledWith('125');
    expect(input.value).toBe('۱۲۵');
    fireEvent.change(input, { target: { value: '12٫5' } });
    expect(onValueChange).toHaveBeenLastCalledWith('12.5');
    fireEvent.change(input, { target: { value: '12.' } });
    expect(input.value).toBe('12.');
  });

  it('invalid text shows its error under the field, blocks the form and sends an empty value, never the last valid prefix', () => {
    const onValueChange = vi.fn();
    render(<DecimalInput aria-label="مبلغ" value={40} min="0" onValueChange={onValueChange} />);
    const input = screen.getByLabelText('مبلغ') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '۴۰x' } });
    expect(onValueChange).toHaveBeenLastCalledWith('');
    expect(input.value).toBe('۴۰x');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input.validity.valid).toBe(false);
    fireEvent.change(input, { target: { value: '۴۰' } });
    expect(onValueChange).toHaveBeenLastCalledWith('40');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.validity.valid).toBe(true);
  });

  it('reads a slash between digits as the decimal mark (12/5 is 12.5)', () => {
    expect(readDecimalInputText('12/5')).toEqual({ kind: 'value', text: '12.5' });
    expect(readDecimalInputText('۱۲/۵')).toEqual({ kind: 'value', text: '12.5' });
    expect(readDecimalInputText('12/')).toEqual({ kind: 'value', text: '12.' });
    expect(readDecimalInputText('1/2/3').kind).toBe('invalid');
    expect(readDecimalInputText('/5').kind).toBe('invalid');
  });

  it('accepts thousands separators only between three-digit groups, so 12,5 is an error and not 125', () => {
    expect(readDecimalInputText('12,5').kind).toBe('invalid');
    expect(readDecimalInputText('1,23').kind).toBe('invalid');
    expect(readDecimalInputText('۱۲٬۵').kind).toBe('invalid');
    expect(readDecimalInputText('1,234')).toEqual({ kind: 'value', text: '1234' });
    expect(readDecimalInputText('۱٬۲۳۴٫۵')).toEqual({ kind: 'value', text: '1234.5' });
    expect(readDecimalInputText('1،234،567')).toEqual({ kind: 'value', text: '1234567' });
  });

  it('partial text such as a lone minus or dot sends an empty value and blocks a native submit without a visible error', () => {
    const onValueChange = vi.fn();
    render(<DecimalInput aria-label="نرخ" value={5} onValueChange={onValueChange} />);
    const input = screen.getByLabelText('نرخ') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-' } });
    expect(onValueChange).toHaveBeenLastCalledWith('');
    expect(input.validity.valid).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(input, { target: { value: '.' } });
    expect(input.validity.valid).toBe(false);
    fireEvent.change(input, { target: { value: '.5' } });
    expect(onValueChange).toHaveBeenLastCalledWith('.5');
    expect(input.validity.valid).toBe(true);
  });

  it('an add-line button refuses an invalid field, and clearing the form afterwards resets stale invalid text', () => {
    const onAdd = vi.fn();
    function Host() {
      const [qty, setQty] = useState<number | ''>('');
      return (
        <div data-decimal-scope="">
          <DecimalInput aria-label="تعداد" min="0" value={qty} onValueChange={t => setQty(t ? Number(t) : '')} />
          <button type="button" onClick={e => { if (!refuseInvalidDecimalInputs(e.currentTarget)) onAdd(qty); }}>افزودن</button>
          <button type="button" onClick={() => setQty(7)}>هفت</button>
          <span data-testid="qty">{String(qty)}</span>
        </div>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('تعداد') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '۱۲۵' } });
    fireEvent.change(input, { target: { value: '۱۲۵۰۰۰۰x' } });
    expect(screen.getByTestId('qty').textContent).toBe('');
    fireEvent.click(screen.getByText('افزودن'));
    expect(onAdd).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByText('هفت'));
    expect(input.value).toBe('7');
    expect(input.validity.valid).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('افزودن'));
    expect(onAdd).toHaveBeenLastCalledWith(7);
  });

  it('the invoice and stock document add-line buttons check their number fields first', () => {
    for (const file of ['pages/CreateInvoicePage.tsx', 'components/documents/stock/StockItemPicker.tsx']) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source).toContain('data-decimal-scope');
      expect(source).toMatch(/refuseInvalidDecimalInputs\(e\.currentTarget\)\) (handleAddItem|onAddItem)\(\)/);
    }
  });

  it('a value above max still reaches the form like the old field, but the field says so and blocks submission', () => {
    const onValueChange = vi.fn();
    function Host() {
      const [v, setV] = useState('');
      return <DecimalInput aria-label="درصد" value={v} min="0" max="100" onValueChange={t => { onValueChange(t); setV(t); }} />;
    }
    render(<Host />);
    const input = screen.getByLabelText('درصد') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '۱۲۰' } });
    expect(onValueChange).toHaveBeenLastCalledWith('120');
    expect(screen.getByRole('alert').textContent).toContain('۱۰۰');
    expect(input.validity.valid).toBe(false);
  });

  it('the payslip deductions field takes an amount typed with Persian digits', () => {
    const onAmountChange = vi.fn();
    render(<PayrollDeductionsField amount={0} onAmountChange={onAmountChange} description="" onDescriptionChange={() => {}} currencyLabel="ریال" />);
    fireEvent.change(screen.getByLabelText(/سایر کسورات/), { target: { value: '۱۲۵٬۰۰۰' } });
    expect(onAmountChange).toHaveBeenLastCalledWith(125000);
  });

  it('a stock document line takes quantity 12.5 written with the Persian decimal mark as 12.5, not 125, and a price typed with Persian digits', () => {
    const onQty = vi.fn();
    const onPrice = vi.fn();
    const item = { id: 7, code: 'R-1', name: 'مهره', unit: 'عدد', current_stock: 100 } as unknown as Item;
    render(
      <DocItemsTable
        docItems={[{ item, quantity: 1, unitPrice: 1000 }]}
        actionType="in"
        currencyLabel="ریال"
        totalSum={1000}
        getItemReservationSummary={() => ({ reservedForSelectedProject: 0, reservedForOtherProjects: 0 })}
        onUpdateItemQty={onQty}
        onUpdateItemPrice={onPrice}
        onRemove={() => {}}
      />,
    );
    const [qty, price] = screen.getAllByRole('textbox').filter(el => el.getAttribute('inputmode') === 'decimal');
    fireEvent.change(qty, { target: { value: '12٫5' } });
    expect(onQty).toHaveBeenLastCalledWith(0, 12.5);
    fireEvent.change(price, { target: { value: '۷۵۰۰۰۰' } });
    expect(onPrice).toHaveBeenLastCalledWith(0, 750000);
  });

  it('no production file adds a type="number" input (ratchet: the count only goes down)', () => {
    const counts: Record<string, number> = {};
    for (const file of productionSources(SRC)) {
      const n = (readFileSync(file, 'utf8').match(NUMBER_INPUT) ?? []).length;
      if (n > 0) counts[relative(SRC, file).split('\\').join('/')] = n;
    }
    expect(counts).toEqual(NUMBER_INPUT_BASELINE);
  });
});
