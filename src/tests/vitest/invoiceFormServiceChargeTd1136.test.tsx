import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computeInvoiceTotals } from '../../lib/invoiceTotals';
import { SERVICE_CHARGE_INVALID, serviceChargeInputOf } from '../../lib/invoices/serviceChargeInput';
import { invoiceFormFromDocument } from '../../lib/invoices/invoiceForm';
import { InvoiceServiceChargeField } from '../../components/invoices/create/InvoiceServiceChargeField';

const SERVICE_CHARGE_LABEL = 'هزینه ارسال و خدمات';

afterEach(cleanup);

describe('manual invoice service charge (TD-1136)', () => {
  it('adds the service charge to the payable amount after VAT', () => {
    const totals = computeInvoiceTotals([{ quantity: 2, unitPrice: 1000, discount: 0 }], 10, 'IRR', '350');
    expect(totals.vatAmount).toBe(200);
    expect(totals.serviceCharge).toBe(350);
    expect(totals.payable).toBe(2550);
  });

  it('reads Persian digits and separators and refuses text or a negative amount', () => {
    expect(serviceChargeInputOf('۱۲٬۵۰۰')).toEqual({ amount: '12500', error: null });
    expect(serviceChargeInputOf('')).toEqual({ amount: '0', error: null });
    expect(serviceChargeInputOf('abc').error).toBe(SERVICE_CHARGE_INVALID);
    expect(serviceChargeInputOf('-5').error).toBe(SERVICE_CHARGE_INVALID);
  });

  it('restores the stored service charge when a proforma is loaded for editing', () => {
    expect(invoiceFormFromDocument({ type: 'proforma', serviceChargeAmount: 400 }, 'P-1').serviceChargeAmount).toBe(400);
    expect(invoiceFormFromDocument({ type: 'proforma' }, 'P-1').serviceChargeAmount).toBe(0);
  });

  it('shows the field with its error', () => {
    let value = '';
    render(<InvoiceServiceChargeField value="x" onChange={v => { value = v; }} error={SERVICE_CHARGE_INVALID} currency="IRR" />);
    expect(screen.getByText(SERVICE_CHARGE_LABEL)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(SERVICE_CHARGE_INVALID);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '۵۰' } });
    expect(value).toBe('50');
  });

  it('sends the service charge with the invoice and blocks an invalid one', () => {
    const page = readFileSync('src/pages/CreateInvoicePage.tsx', 'utf8');
    expect(page).toContain('serviceChargeAmount: serviceCharge.amount');
    expect(page).toContain('if (serviceCharge.error)');
    expect(page).toContain('<InvoiceServiceChargeField');
  });
});
