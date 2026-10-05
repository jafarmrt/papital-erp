import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DocumentDetailsPreview } from '../../components/approval/DocumentDetailsPreview';
import { serverPayableOf } from '../../lib/invoices/documentPayable';
import { formatPersianPrice } from '../../utils';

// v8.0.112 (TD-389): کارتابل تأیید و پرونده مشتری مبلغ قابل پرداخت سرور را نشان می‌دهند، نه خالص اقلام
afterEach(cleanup);

describe('payable amount outside the invoice list (TD-389)', () => {
  it('uses the server payable, else net + VAT + service charge', () => {
    expect(serverPayableOf({ totalAmount: 1_000_000, vatAmount: 100_000, payableAmount: 1_150_000 })).toBe(1_150_000);
    expect(serverPayableOf({ total_amount: 1_000_000, vat_amount: 100_000, service_charge_amount: 50_000 })).toBe(1_150_000);
    expect(serverPayableOf({ net_amount: 0.1, vatAmount: 0.2, currency: 'USD' })).toBe(0.3);
    expect(serverPayableOf({})).toBe(0);
  });

  it('approval preview shows the payable amount with VAT', () => {
    render(
      <DocumentDetailsPreview
        isLoadingDoc={false}
        docDetails={{
          ref_number: 'PF-7',
          currency: 'IRR',
          total_amount: 1_000_000,
          vat_amount: 100_000,
          payable_amount: 1_100_000,
          items: [{ item_name: 'انگشتر', quantity: 1, unit_price: 1_000_000 }],
        }}
      />
    );
    expect(screen.getByText(formatPersianPrice(1_100_000, 'IRR'))).toBeTruthy();
  });

  it('approval preview keeps cents of a foreign document', () => {
    render(
      <DocumentDetailsPreview
        isLoadingDoc={false}
        docDetails={{
          ref_number: 'PF-8',
          currency: 'USD',
          total_amount: 100,
          vat_amount: 9,
          payable_amount: 109,
          items: [{ item_name: 'دستبند', quantity: 3, unit_price: 33.35 }],
        }}
      />
    );
    expect(screen.getByText(formatPersianPrice(109, 'USD'))).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(100.05, undefined, 2))).toBeTruthy();
  });
});
