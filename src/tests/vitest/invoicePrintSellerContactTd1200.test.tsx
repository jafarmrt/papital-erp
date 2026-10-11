import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import InvoicePrintView from '../../components/InvoicePrintView';

// v10.0.128 (TD-1200, fresh-eyes guide test roles-c Rc9): the seller's phone and address come from the login-only settings
// list; `/public-settings` carries only the name, logo and currency, so the print showed «-» for both
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const PUBLIC = { companyName: 'کارگاه پاپیتال', companyLogo: '', currency: 'IRR', settings: [{ key: 'company_name', value: 'کارگاه پاپیتال' }] };
const SETTINGS = [
  { key: 'company_name', value: 'کارگاه پاپیتال' },
  { key: 'company_phone', value: '02112345678' },
  { key: 'company_address', value: 'تهران، خیابان آزادی' },
];
const DOC = {
  id: 21, ref_number: 'F-21', type: 'invoice', date: '2026-10-01 10:00:00', status: 'final', currency: 'IRR', user: 'فروشنده',
  buyer_name: 'سارا احمدی', vatPercent: 0, vatAmount: 0, payableAmount: 1_000_000,
  items: [{ item_id: 3, name: 'گردنبند نقره', code: 'P-3', unit: 'عدد', quantity: 1, unit_price: 1_000_000, discount: 0 }],
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('InvoicePrintView prints the seller phone and address (TD-1200)', () => {
  it('reads them from the settings list, not the public settings', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(
      url === '/public-settings' ? PUBLIC : url === '/settings' ? SETTINGS : { signatures: [] },
    ));
    render(<InvoicePrintView printedDoc={DOC} />);
    expect(await screen.findByText(/تهران، خیابان آزادی/)).toBeTruthy();
    expect(screen.getByText(/۰۲۱۱۲۳۴۵۶۷۸/)).toBeTruthy();
  });
});
