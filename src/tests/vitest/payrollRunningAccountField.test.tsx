import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// v12 colleague sales part B (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.3): «کسر از حساب جاری همکار» on the payslip
vi.mock('../../hooks/useAppCurrency', () => ({ useRialDisplay: () => ({ amount: (v: number) => String(v), number: (v: number) => String(v) }) }));

import { PayrollRunningAccountField, RUNNING_ACCOUNT_DEDUCTION_TEXT, runningDeductionExceedsDebt } from '../../components/piecework/PayrollRunningAccountField';

afterEach(() => cleanup());

describe('v12 colleague sales: the payslip running-account deduction', () => {
  it('shows nothing for a colleague who owes nothing and deducts nothing', () => {
    const { container } = render(<PayrollRunningAccountField value={0} onChange={vi.fn()} debt={0} />);
    expect(container.textContent).toBe('');
  });

  it('offers the whole debt and warns above it', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PayrollRunningAccountField value={0} onChange={onChange} debt={400000} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(RUNNING_ACCOUNT_DEDUCTION_TEXT.applyAll) }));
    expect(onChange).toHaveBeenCalledWith(400000);
    expect(screen.queryByText(RUNNING_ACCOUNT_DEDUCTION_TEXT.exceeds)).toBeNull();
    rerender(<PayrollRunningAccountField value={400001} onChange={onChange} debt={400000} />);
    expect(screen.getByText(RUNNING_ACCOUNT_DEDUCTION_TEXT.exceeds)).toBeTruthy();
    expect(screen.getByText(RUNNING_ACCOUNT_DEDUCTION_TEXT.explain)).toBeTruthy();
  });

  it('adds a draft payslip\'s own deduction to the ceiling, and compares nothing when the debt was not read', () => {
    expect(runningDeductionExceedsDebt(400000, 0, 400000)).toBe(false);
    expect(runningDeductionExceedsDebt(400001, 0, 400000)).toBe(true);
    expect(runningDeductionExceedsDebt(999, null)).toBe(false);
    render(<PayrollRunningAccountField value={300000} onChange={vi.fn()} debt={100000} alreadyDeducted={300000} />);
    expect(screen.getByRole('button', { name: new RegExp(RUNNING_ACCOUNT_DEDUCTION_TEXT.applyAll) })).toBeTruthy();
  });
});
