import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import InvoicePrintView from '../../components/InvoicePrintView';

// TD-793 (B08-24): پیش‌فاکتور فروشی که با نوع `proforma` ذخیره شده (کاربر بی مجوز قطعی) مثل فاکتور فروش چاپ می‌شود
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const settings = {
  settings: [
    { key: 'company_name', value: 'کارگاه پاپیتال' },
    { key: 'company_phone', value: '02112345678' },
    { key: 'company_address', value: 'تهران، خیابان آزادی' },
  ],
};
const base = {
  id: 21, ref_number: 'PF-21', date: '2026-10-01 10:00:00', status: 'proforma', currency: 'IRR', user: 'کارشناس فروش',
  buyer_name: 'سارا احمدی', buyer_city: 'اصفهان', buyer_phone: '09121234567', buyer_address: 'اصفهان، خیابان چهارباغ',
  vatPercent: 0, vatAmount: 0, payableAmount: 2_000_000,
  items: [{ item_id: 3, name: 'گردنبند نقره', code: 'P-3', unit: 'عدد', quantity: 2, unit_price: 1_000_000, discount: 0 }],
};

function renderDoc(doc: Record<string, unknown>) {
  fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/public-settings' ? settings : { signatures: [] }));
  return render(<InvoicePrintView printedDoc={doc} />);
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('InvoicePrintView — a sales proforma of type "proforma" prints as a sales document (TD-793)', () => {
  it('prints the sales title, the seller and buyer boxes and the buyer address', async () => {
    renderDoc({ ...base, type: 'proforma' });
    expect(await screen.findByText('صورتحساب فروش کالا و خدمات')).toBeTruthy();
    expect(screen.getByText('پیش‌فاکتور')).toBeTruthy();
    expect(screen.getByText('مشخصات فروشنده')).toBeTruthy();
    expect(screen.getByText('مشخصات خریدار / مشتری')).toBeTruthy();
    expect(screen.getAllByText(/اصفهان، خیابان چهارباغ/).length).toBeGreaterThan(0);
    expect(screen.queryByText('سند انبار')).toBeNull();
    expect(screen.queryByText('گیرنده حواله / مصرف‌کننده:')).toBeNull();
  });

  it('a purchase proforma (receipt) keeps the receipt layout', async () => {
    renderDoc({ ...base, type: 'receipt' });
    expect(await screen.findByText('رسید ورود و خرید کالا و مواد اولیه')).toBeTruthy();
    expect(screen.queryByText('صورتحساب فروش کالا و خدمات')).toBeNull();
    expect(screen.queryByText('مشخصات خریدار / مشتری')).toBeNull();
  });
});
