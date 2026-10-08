import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvoiceSettlementModal } from '../../components/invoices/InvoiceSettlementModal';

// v9.0.459 (TD-907, finding P5-S-01 / P5-P06): the settlement form sends the document's party id with the receipt or
// payment, so the voucher row carries the party id and stays on the party's account card after a rename
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const SALES_SUBMIT = 'تایید و ثبت تسویه';
const PURCHASE_SUBMIT = 'تایید و ثبت پرداخت';
const BUYER = 'مشتری کارت';
const accounts = [{ id: 1, title: 'بانک ملت', type: 'bank', currency: 'IRR', code: '1101' }];
const invoice = { id: 9, type: 'invoice', ref_number: 'INV-9', buyer_name: BUYER, partyId: 42, currency: 'IRR', payableAmount: 1_100_000, paidAmount: 0, remainingAmount: 1_100_000 };

async function submittedBody(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/accounting/bank-accounts/options' ? accounts : { success: true }));
  render(<InvoiceSettlementModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} document={doc as never} />);
  await screen.findByDisplayValue(/بانک ملت/);
  fireEvent.click(screen.getByText(doc.type === 'receipt' ? PURCHASE_SUBMIT : SALES_SUBMIT));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/accounting/treasury', expect.anything()));
  const call = fetchJson.mock.calls.find(([u]) => u === '/accounting/treasury') as [string, { body: string }];
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('settlement form sends the document party id (TD-907)', () => {
  it('a sales invoice receipt carries the invoice party id and its buyer name', async () => {
    const body = await submittedBody(invoice);
    expect(body).toMatchObject({ type: 'receipt', partyType: 'customer', partyId: 42, partyName: BUYER, documentId: 9 });
  });

  it('a purchase payment carries the supplier id', async () => {
    const body = await submittedBody({ ...invoice, id: 10, type: 'receipt', partyId: 7 });
    expect(body).toMatchObject({ type: 'payment', partyType: 'supplier', partyId: 7, documentId: 10 });
  });

  it('a legacy document without a party sends no party id (the server keeps the exact-name rule)', async () => {
    const body = await submittedBody({ ...invoice, partyId: null });
    expect('partyId' in body).toBe(false);
    expect(body.partyName).toBe(BUYER);
  });
});
