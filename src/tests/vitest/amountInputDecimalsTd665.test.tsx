import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';
import { parseCleanNumber, parseQuantityOrTime, cleanDecimalString, roundFinancial } from '../../utils';
import { readAmountText } from '../../lib/amountText';

afterEach(cleanup);

function ControlledAmount({ currency, log, initial = 0 }: { currency: string; log: number[]; initial?: number }) {
  const [value, setValue] = useState<number>(initial);
  return <FinancialAmountInput value={value} currency={currency} showWordsBadge={false} onChange={n => { log.push(n); setValue(n); }} />;
}

describe('TD-665 amount input keeps decimals while typing', () => {
  it('typing 1, 12, 12., 12.5 in a USD field gives 12.5, not 125', () => {
    const log: number[] = [];
    render(<ControlledAmount currency="USD" log={log} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    for (const step of ['1', '12', '12.']) fireEvent.change(input, { target: { value: step } });
    expect(input.value).toBe('12.');
    fireEvent.change(input, { target: { value: `${input.value}5` } });
    expect(log).toEqual([1, 12, 12, 12.5]);
    expect(input.value).toBe('12.5');
  });

  it('a third decimal in a USD field and any decimal in a rial field are refused with a message, the amount is kept', () => {
    const usd: number[] = [];
    render(<ControlledAmount currency="USD" log={usd} initial={12.55} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12.555' } });
    expect(usd).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('۲ رقم اعشار');
    cleanup();

    const irr: number[] = [];
    render(<ControlledAmount currency="IRR" log={irr} initial={1000} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1000.5' } });
    expect(irr).toEqual([]);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1,000');
  });

  it('a minus sign is typed only when the field allows negative amounts', () => {
    expect(readAmountText('-25', { scale: 0, allowNegative: true })).toEqual({ ok: true, text: '-25', value: -25 });
    expect(readAmountText('-25', { scale: 0, allowNegative: false }).ok).toBe(false);
  });
});

describe('TD-666 Persian separators and stray characters never zero an amount', () => {
  it('Persian, Arabic and spaced separators and a copied currency label are read', () => {
    const cases: Array<[string, number]> = [
      ['۱٬۲۵۰٬۰۰۰', 1250000],
      ['۱،۲۵۰،۰۰۰', 1250000],
      ['1 250 000', 1250000],
      ['۱,۲۵۰,۰۰۰ ریال', 1250000],
      ['۱٬۲۵۰٬۰۰۰ ریال', 1250000]
    ];
    for (const [typed, expected] of cases) {
      const onChange = vi.fn();
      render(<FinancialAmountInput value={0} onChange={onChange} showWordsBadge={false} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: typed } });
      expect(onChange).toHaveBeenLastCalledWith(expected);
      cleanup();
    }
    const usd = vi.fn();
    render(<FinancialAmountInput value={0} currency="USD" onChange={usd} showWordsBadge={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '۱۲٫۵' } });
    expect(usd).toHaveBeenLastCalledWith(12.5);
  });

  it('a stray letter keeps the previous amount and shows a message instead of sending 0', () => {
    const onChange = vi.fn();
    render(<FinancialAmountInput value={1250000} onChange={onChange} showWordsBadge={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1,250,000x' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('مبلغ فقط رقم و ممیز می‌پذیرد');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1,250,000');
  });

  it('the shared number parsers read the Persian decimal and thousands separators', () => {
    expect(parseCleanNumber('۱۲٫۵')).toBe(12.5);
    expect(parseCleanNumber('۱٬۲۵۰٬۰۰۰')).toBe(1250000);
    expect(parseCleanNumber('۱،۲۵۰،۰۰۰')).toBe(1250000);
    expect(parseQuantityOrTime('۲٫۵')).toBe(2.5);
    expect(cleanDecimalString('۱٬۲۵۰٫۵')).toBe('1250.5');
    expect(roundFinancial('۱۲٫۵۶۷', 2)).toBe(12.57);
  });
});
