import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Item } from '../../types';

// v10.0.27..v10.0.31: observations of the package 8 ledger (sales and stock document screens)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const ROOT = resolve(__dirname, '../..');
const source = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('OBS-R1-100 half of the remaining amount keeps the currency scale', () => {
  it('rounds a foreign amount to two decimals and a rial amount to whole rials', async () => {
    const { halfRemainingAmount } = await import('../../lib/invoices/settlementAccounts');
    expect(halfRemainingAmount(10.05, 'USD')).toBe('5.03');
    expect(halfRemainingAmount(0.05, 'EUR')).toBe('0.03');
    expect(halfRemainingAmount(101, 'IRR')).toBe('51');
    expect(halfRemainingAmount(101, null)).toBe('51');
  });

  it('the settlement window uses it instead of Math.round', () => {
    const modal = source('components/invoices/InvoiceSettlementModal.tsx');
    expect(modal).toContain('halfRemainingAmount(remainingAmount, currency)');
    expect(modal).not.toContain('Math.round(remainingAmount / 2)');
  });
});

describe('OBS-R1-102 the old remittance address opens the stock document page', () => {
  it('redirects /remittances to /receipts and has no page access row of its own', () => {
    const routes = source('components/AppRoutes.tsx');
    expect(routes).toMatch(/path="\/remittances" element=\{<Navigate to="\/receipts" replace \/>\}/);
    expect(source('lib/permissions/pageAccess.ts')).not.toContain("'/remittances'");
    expect(source('pages/CRMPage.tsx')).not.toContain("'/remittances'");
  });
});

describe('OBS-R1-101 return rows carry the listed item with its stock', () => {
  it('takes the item of the item list by id and keeps the short form otherwise', async () => {
    const { returnRowsFromInvoice } = await import('../../lib/documents/stockDocumentParties');
    const listed = { id: 5, name: 'گردنبند نقره', code: 'P-5', unit: 'عدد', category: 'گردنبند', current_stock: 7 } as unknown as Item;
    const rows = returnRowsFromInvoice([
      { itemId: 5, quantity: 2, unitPrice: 1000, discount: 0, name: 'گردنبند نقره', code: 'P-5', unit: 'عدد' },
      { itemId: 6, quantity: 1, unitPrice: 500, name: 'انگشتر', code: 'P-6', unit: 'عدد' },
    ], [listed]);
    expect(rows[0].item.current_stock).toBe(7);
    expect(rows[0].item.category).toBe('گردنبند');
    expect(rows[0]).toMatchObject({ quantity: 2, unitPrice: 1000 });
    expect(rows[1].item).toMatchObject({ id: 6, name: 'انگشتر', code: 'P-6' });
    expect(rows[1].item.current_stock).toBeUndefined();
  });

  it('the stock document form builds its return rows with it', () => {
    expect(source('hooks/documents/useStockDocumentForm.ts')).toContain('returnRowsFromInvoice(');
  });
});

describe('OBS-R1-99 the remittance receiver is picked by personnel id', () => {
  it('tells two personnel with the same name apart', async () => {
    const { personnelById, personnelDisplayName } = await import('../../lib/documents/stockDocumentParties');
    const list = [{ id: 1, fullName: 'علی رضایی' }, { id: 2, fullName: 'علی رضایی' }];
    expect(personnelById(list, 2)).toBe(list[1]);
    expect(personnelById(list, null)).toBeNull();
    expect(personnelDisplayName({ fullName: '', firstName: 'مینا', lastName: 'احمدی' })).toBe('مینا احمدی');
  });

  it('the form keeps the id and no longer finds the receiver by name', () => {
    const form = source('hooks/documents/useStockDocumentForm.ts');
    expect(form).toContain('personnelById(personnelList, receiverPersonnelId)');
    expect(form).not.toMatch(/personnelList\.find\(p => \(p\.fullName/);
    expect(source('components/documents/stock/StockCounterpartyField.tsx')).toContain('value: String(p.id)');
  });
});

describe('OBS-R1-97 document requests are cancelled when the page closes', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('passes the query signal to the document list request', async () => {
    fetchJson.mockResolvedValue({ data: [], total: 0 });
    const { useDocumentsQuery } = await import('../../hooks/queries/useDocumentQueries');
    renderHook(() => useDocumentsQuery({ type: 'invoice' }), { wrapper });
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    const init = fetchJson.mock.calls[0][1] as { signal?: AbortSignal } | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes it to every reference list of the stock document page', () => {
    const refData = source('hooks/documents/useStockDocumentReferenceData.ts');
    expect(refData.match(/queryFn: async \(\{ signal \}\)/g)?.length).toBe(4);
    expect(refData).not.toMatch(/queryFn: async \(\) =>/);
  });
});
