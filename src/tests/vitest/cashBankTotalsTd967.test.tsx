import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CashBankTotals } from '../../components/accounting/CashBankTotals';

describe('cash and bank card per currency (TD-967)', () => {
  afterEach(cleanup);

  it('lists each foreign balance apart and keeps the main number rial only', () => {
    render(<CashBankTotals total={50_000_000} byCurrency={[{ currency: 'IRR', amount: 50_000_000 }, { currency: 'USD', amount: 1_000 }]} />);
    const foreign = screen.getByTestId('cash-bank-foreign');
    expect(foreign.querySelectorAll('li')).toHaveLength(1);
    expect(foreign.textContent).not.toMatch(/۵۰٬۰۰۰٬۰۰۰/);
  });

  it('shows no foreign list when every account is in rials', () => {
    render(<CashBankTotals total={10} byCurrency={[{ currency: 'IRR', amount: 10 }]} />);
    expect(screen.queryByTestId('cash-bank-foreign')).toBeNull();
  });
});
