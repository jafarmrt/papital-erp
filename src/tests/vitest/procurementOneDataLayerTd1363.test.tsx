import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import type { ProcurementOrder, PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => ({ toast: { error: () => undefined, success: () => undefined } }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
  useHasPermission: (key: string) => granted.has(key),
}));

import { ProcurementDesk } from '../../components/procurement/ProcurementDesk';
import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';
import { invalidatePreset } from '../../lib/queryInvalidation';
import { PROCUREMENT_RECEIVE_PERMISSION } from '../../lib/permissions/procurementPermissions';
import { QUERY_KEYS } from '../../lib/queryKeys';

// v10.2 package 11 part 5d (TD-1363, OBS-R2-102): the procurement desk reads through React Query. Each test is red on
// the desk that kept its summary, pages and open requisition in its own state.

const order = (id: number, status: 'draft' | 'final' = 'draft'): ProcurementOrder => ({
  id, refNumber: `R-1405-00${id}`, docType: 'receipt', status, date: '2026-10-06T10:00:00', supplierName: 'تامین الماس',
  notes: '', requisitionId: 5, requisitionCode: 'PR-1405-0005', projectName: null, location: 'WH1',
  totalAmount: 50000, itemsCount: 1, user: 'admin', items: [],
});

const requisitionWith = (status: PurchaseRequisition['status'], title = 'درخواست آزمون'): PurchaseRequisition => ({
  id: 5, code: 'PR-1405-0005', title, status, priority: 'normal', notes: '', totalEstimatedAmount: 50000,
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ فیروزه', unit: 'عدد', requestedQty: 5, orderedQty: 5, remainingQty: 0, unitPriceEstimate: 10000, linkedDocumentIds: [41, 42] }],
});

interface Server { requisitions: PurchaseRequisition[]; orders: ProcurementOrder[]; failDeliveryOf?: number }
let server: Server;
// the refusal the server gives for one order of a bulk delivery
const DELIVERY_REFUSED = 'تحویل این سفارش ممکن نشد';
const deliveries: number[] = [];

function serve() {
  fetchJson.mockImplementation(async (u: unknown, init?: { method?: string }) => {
    const url = String(u ?? '');
    const delivery = /\/api\/procurement\/orders\/(\d+)\/deliver$/.exec(url);
    if (delivery && init?.method === 'POST') {
      const id = Number(delivery[1]);
      if (id === server.failDeliveryOf) throw new Error(DELIVERY_REFUSED);
      deliveries.push(id);
      server.orders = server.orders.map(o => (o.id === id ? { ...o, status: 'final' as const } : o));
      return { success: true, message: 'تحویل شد' };
    }
    if (url.startsWith('/api/procurement/inbox/summary')) return { success: true, data: { totalRequisitions: server.requisitions.length, pendingCount: 0, underReviewCount: 0, managerApprovalCount: 0, orderedCount: 1, receivedCount: 0, urgentCount: 0, pendingDeliveryOrdersCount: 1, deliveredOrdersCount: 0, totalOrdersCount: 2 } };
    if (url.includes('/workflow-actions')) return { success: true, data: { hasInstance: true, actions: [] } };
    if (url === '/api/procurement/requisitions/5') return { success: true, data: server.requisitions[0] };
    if (url.startsWith('/api/procurement/requisitions')) return { success: true, data: server.requisitions, total: server.requisitions.length, page: 1, limit: 50 };
    if (url.startsWith('/api/procurement/orders')) {
      const rows = url.includes('status=pending_delivery') ? server.orders.filter(o => o.status !== 'final') : server.orders;
      return { success: true, data: rows, total: rows.length, page: 1, limit: 50 };
    }
    return { success: true, data: [] };
  });
}

function newClient() {
  // the app's freshness window (src/lib/queryClient.ts), so a test sees what a cached screen would
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}
function Provider({ client, children }: { client: QueryClient; children: ReactNode }) {
  const [c] = useState(client);
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}
const callsOf = (prefix: string) => fetchJson.mock.calls.filter(c => String(c[0]).startsWith(prefix) && !(c[1] as { method?: string } | undefined)?.method).length;

/** caches of the other screens a delivery changes: stock, Kardex, documents and vouchers */
function seedOtherScreens(client: QueryClient) {
  client.setQueryData(QUERY_KEYS.items.all, { data: [] });
  client.setQueryData(QUERY_KEYS.transactions.all, { data: [] });
  client.setQueryData(QUERY_KEYS.documents.all, { data: [] });
  client.setQueryData(QUERY_KEYS.accounting.all, { data: [] });
}
const invalidated = (client: QueryClient) => [QUERY_KEYS.items.all, QUERY_KEYS.transactions.all, QUERY_KEYS.documents.all, QUERY_KEYS.accounting.all]
  .map(key => client.getQueryState(key)?.isInvalidated ?? false);

beforeEach(() => {
  fetchJson.mockReset();
  deliveries.length = 0;
  granted.clear();
  for (const key of ['procurement.view', 'procurement.manage', 'procurement.order', 'procurement.approve', PROCUREMENT_RECEIVE_PERMISSION]) granted.add(key);
  server = { requisitions: [requisitionWith('ordered')], orders: [order(41), order(42)] };
  serve();
});
afterEach(cleanup);

describe('procurement_one_data_layer_td_1363', () => {
  it('a workflow approval elsewhere refreshes an open desk', async () => {
    const client = newClient();
    render(<Provider client={client}><ProcurementDesk /></Provider>);
    expect((await screen.findAllByText(/درخواست آزمون/)).length).toBeGreaterThan(0);
    server.requisitions = [requisitionWith('received', 'درخواست تحویل‌شده')];
    await act(async () => { await invalidatePreset(client, 'workflowChange'); });
    expect((await screen.findAllByText(/درخواست تحویل‌شده/)).length).toBeGreaterThan(0);
  });

  it('voiding a linked order on the documents page refreshes an open desk', async () => {
    const client = newClient();
    render(<Provider client={client}><ProcurementDesk /></Provider>);
    await screen.findAllByText(/درخواست آزمون/);
    const before = callsOf('/api/procurement/requisitions');
    await act(async () => { await invalidatePreset(client, 'documentChange'); });
    await waitFor(() => expect(callsOf('/api/procurement/requisitions')).toBe(before + 1));
  });

  it('delivering an order on the desk refreshes stock, Kardex, documents and vouchers', async () => {
    const client = newClient();
    seedOtherScreens(client);
    render(<Provider client={client}><ProcurementDesk /></Provider>);
    await screen.findAllByText(/درخواست آزمون/);
    fireEvent.click(screen.getByText('۲. سفارش‌های خرید (در انتظار تحویل انبار)'));
    fireEvent.click((await screen.findAllByText('تایید و تحویل به انبار'))[0]);
    fireEvent.click(await screen.findByText('تایید و صدور رسید قطعی انبار'));
    await waitFor(() => expect(deliveries).toEqual([41]));
    await waitFor(() => expect(invalidated(client)).toEqual([true, true, true, true]));
  });

  it('a desk delivery the server committed refreshes the screens even if the window then fails', async () => {
    const client = newClient();
    seedOtherScreens(client);
    render(<Provider client={client}><ProcurementDesk /></Provider>);
    await screen.findAllByText(/درخواست آزمون/);
    fireEvent.click(screen.getByText('۲. سفارش‌های خرید (در انتظار تحویل انبار)'));
    fireEvent.click((await screen.findAllByText('تایید و تحویل به انبار'))[0]);
    vi.spyOn(toast, 'success').mockImplementationOnce(() => { throw new Error('toast failed'); });
    fireEvent.click(await screen.findByText('تایید و صدور رسید قطعی انبار'));
    await waitFor(() => expect(deliveries).toEqual([41]));
    await waitFor(() => expect(invalidated(client)).toEqual([true, true, true, true]));
  });

  it('delivering all orders waits until the orders are loaded', async () => {
    let releaseOrders: () => void = () => undefined;
    const ordersLoaded = new Promise<void>(resolve => { releaseOrders = resolve; });
    const served = fetchJson.getMockImplementation()!;
    fetchJson.mockImplementation(async (u: unknown, init?: { method?: string }) => {
      if (String(u ?? '').startsWith('/api/procurement/orders') && !init?.method) await ordersLoaded;
      return served(u, init);
    });
    render(<Provider client={newClient()}>
      <RequisitionDetailModal isOpen requisition={requisitionWith('ordered')} onClose={() => undefined} onOpenSplitOrder={() => undefined} />
    </Provider>);
    const bulk = (await screen.findByText(/تحویل کلیه اقلام به انبار/)).closest('button') as HTMLButtonElement;
    expect(bulk.disabled).toBe(true);
    await act(async () => { releaseOrders(); });
    await waitFor(() => expect(bulk.disabled).toBe(false));
  });

  it('a bulk delivery stopped by one order still refreshes what the delivered ones changed', async () => {
    server.failDeliveryOf = 42;
    const client = newClient();
    seedOtherScreens(client);
    render(<Provider client={client}>
      <RequisitionDetailModal isOpen requisition={requisitionWith('ordered')} onClose={() => undefined} onOpenSplitOrder={() => undefined} />
    </Provider>);
    const bulk = (await screen.findByText(/تحویل کلیه اقلام به انبار/)).closest('button') as HTMLButtonElement;
    await waitFor(() => expect(bulk.disabled).toBe(false));
    fireEvent.click(bulk);
    fireEvent.click(await screen.findByText('تایید و صدور رسید قطعی انبار'));
    await waitFor(() => expect(deliveries).toEqual([41]));
    await waitFor(() => expect(invalidated(client)).toEqual([true, true, true, true]));
    // the window shows the delivered order as delivered
    expect(await screen.findByText(/تحویل انبار شده \(رسید قطعی\)/)).not.toBeNull();
  });

  it('the open requisition window shows the requisition as it is after a delivery', async () => {
    const client = newClient();
    render(<Provider client={client}>
      <RequisitionDetailModal isOpen requisition={requisitionWith('ordered')} onClose={() => undefined} onOpenSplitOrder={() => undefined} />
    </Provider>);
    const single = (await screen.findAllByText('تایید تحویل به انبار'))[0];
    // the last order delivered: the server moves the requisition to «received»
    server.orders = [order(42, 'final')];
    server.requisitions = [requisitionWith('received')];
    fireEvent.click(single);
    fireEvent.click(await screen.findByText('تایید و صدور رسید قطعی انبار'));
    await waitFor(() => expect(deliveries).toEqual([41]));
    expect(await screen.findByText('خرید و تحویل انبار شده')).not.toBeNull();
  });

  it('opening the desk again reads its summary and lists again', async () => {
    const client = newClient();
    const first = render(<Provider client={client}><ProcurementDesk /></Provider>);
    await screen.findAllByText(/درخواست آزمون/);
    first.unmount();
    render(<Provider client={client}><ProcurementDesk /></Provider>);
    await waitFor(() => expect(callsOf('/api/procurement/inbox/summary')).toBe(2));
    await waitFor(() => expect(callsOf('/api/procurement/requisitions?')).toBe(2));
  });
});
