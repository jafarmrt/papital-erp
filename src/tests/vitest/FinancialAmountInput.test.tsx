import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FinancialAmountInput } from '../../components/common/FinancialAmountInput';

afterEach(cleanup);

describe('FinancialAmountInput', () => {
  it('shows the amount with thousand separators', () => {
    render(<FinancialAmountInput value={1234567} onChange={() => {}} label="مبلغ" showWordsBadge={false} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1,234,567');
  });

  it('returns a clean number for typed Persian digits and separators', () => {
    const onChange = vi.fn();
    render(<FinancialAmountInput value={0} onChange={onChange} label="مبلغ" showWordsBadge={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '۲,۵۰۰,۰۰۰' } });
    expect(onChange).toHaveBeenLastCalledWith(2500000);
  });

  it('returns 0 when the field is cleared', () => {
    const onChange = vi.fn();
    render(<FinancialAmountInput value={5000} onChange={onChange} label="مبلغ" showWordsBadge={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('shows the amount in Persian words with the toman equivalent for rials', () => {
    render(<FinancialAmountInput value={1000000} onChange={() => {}} label="مبلغ" currency="IRR" />);
    expect(screen.getByText(/یک میلیون/)).toBeTruthy();
    expect(screen.getByText(/معادل/)).toBeTruthy();
  });
});
