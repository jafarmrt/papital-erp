import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VoucherPrintModal } from '../../components/accounting/VoucherPrintModal';
import { VoucherListToolbar } from '../../components/accounting/vouchers/VoucherListToolbar';
import { EMPTY_VOUCHER_STATUS_COUNTS } from '../../lib/accounting/voucherList';

// v9.0.158 (TD-573, B03-31): the voucher print labels its amount columns with the voucher's currency, prints a multi-currency
// voucher in rials with each row's own amount and rate, and names every voucher type (settlement included).

afterEach(() => cleanup());

type Row = Record<string, unknown>;
const row = (id: number, code: string, debit: number, credit: number, currency: string, exchangeRate: number): Row => ({
  id, accountId: Number(code), accountCode: code, accountName: code === '1201' ? 'دریافتنی تجاری' : 'فروش', debit, credit, currency, exchangeRate, description: '',
});
const voucher = (over: Row) => ({
  id: 5, voucherNumber: 42, date: '2026-04-02', status: 'approved', voucherType: 'general', currency: 'IRR', description: 'فروش صادراتی',
  totalDebit: 100, totalCredit: 100, items: [], ...over,
});
const printText = (v: Row) => {
  const { container } = render(<VoucherPrintModal voucher={v as never} isOpen onClose={() => {}} />);
  return container.ownerDocument.body.textContent || '';
};
const headers = () => [...document.querySelectorAll('#voucher-print-modal th, th')].map(th => th.textContent);

describe('voucher print currency and type (TD-573)', () => {
  it('a dollar voucher prints its columns, totals and words in dollars, with the rate', () => {
    const text = printText(voucher({ voucherType: 'opening', currency: 'USD', items: [row(1, '1201', 100, 0, 'USD', 600_000), row(2, '5001', 0, 100, 'USD', 600_000)] }));
    expect(headers()).toContain('بدهکار (دلار)');
    expect(headers()).toContain('بستانکار (دلار)');
    expect(text).not.toContain('(ریال)');
    expect(text).toContain('نوع سند: افتتاحیه');
    expect(text).toContain('نرخ هر دلار ۶۰۰,۰۰۰ ریال');
    expect(text).toMatch(/صد دلار/);
  });

  it('a multi-currency voucher prints in rials: the dollar row at its rate, totals and words in rials', () => {
    const text = printText(voucher({ currency: 'IRR', items: [row(1, '1201', 100, 0, 'USD', 600_000), row(2, '5001', 0, 60_000_000, 'IRR', 1)] }));
    expect(headers()).toContain('بدهکار (ریال)');
    expect(text).toContain('۱۰۰ دلار به نرخ ۶۰۰,۰۰۰');
    expect(screen.getAllByText('۶۰,۰۰۰,۰۰۰').length).toBeGreaterThanOrEqual(4); // two rows and two totals
    expect(text).toContain('شصت میلیون ریال');
    expect(text).not.toContain('صد ریال');
  });

  it('settlement and adjustment vouchers print their own type, not «عمومی»', () => {
    expect(printText(voucher({ voucherType: 'settlement' }))).toContain('نوع سند: تسویه');
    cleanup();
    expect(printText(voucher({ voucherType: 'adjustment' }))).toContain('نوع سند: اصلاحی / برگشت');
    cleanup();
    expect(printText(voucher({ voucherType: 'something_else' }))).toContain('نوع سند: نوع نامشخص');
  });

  it('the voucher list type filter offers every type, settlement included', () => {
    render(<VoucherListToolbar filters={{ status: 'all', search: '', voucherType: 'all', startDate: '', endDate: '' } as never}
      statusCounts={EMPTY_VOUCHER_STATUS_COUNTS} onChange={() => {}} />);
    const select = screen.getByLabelText('نوع سند') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['all', 'general', 'sales', 'purchase', 'treasury', 'payroll', 'opening', 'closing', 'adjustment', 'settlement']);
    expect(select.options[select.options.length - 1].textContent).toBe('تسویه');
  });
});
