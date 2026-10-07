import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProcurementOrder, PurchaseRequisition } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({ toast: { error: () => undefined, success: () => undefined } }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
  useHasPermission: (key: string) => granted.has(key),
}));

import { ConfirmWarehouseDeliveryModal } from '../../components/procurement/ConfirmWarehouseDeliveryModal';
import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';
import { ProcurementDesk } from '../../components/procurement/ProcurementDesk';

/** an order exactly as `GET /api/procurement/orders` returns it (`listProcurementOrders`) */
const serverOrder: ProcurementOrder = {
  id: 41, refNumber: 'R-1405-0009', docType: 'receipt', status: 'draft', date: '2026-10-06T10:00:00', supplierName: 'تامین الماس',
  notes: '[تدارکات: درخواست PR-1405-0005]', requisitionId: 5, requisitionCode: 'PR-1405-0005', projectName: null, location: 'WH1',
  totalAmount: 50000, itemsCount: 1, user: 'admin',
  items: [{ id: 1, itemId: 9, itemName: 'سنگ فیروزه', itemCode: 'RM-9', unit: 'عدد', quantity: 5, unitPrice: 10000, totalPrice: 50000, location: 'WH1' }],
};

const pending: PurchaseRequisition = {
  id: 6, code: 'PR-1405-0006', title: 'درخواست در انتظار', status: 'pending', priority: 'normal', notes: '', totalEstimatedAmount: 3000,
  items: [{ id: 'r2', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ فیروزه', unit: 'عدد', requestedQty: 3, orderedQty: 0, remainingQty: 3, unitPriceEstimate: 1000, linkedDocumentIds: [] }],
};

const requisition: PurchaseRequisition = {
  id: 5, code: 'PR-1405-0005', title: 'درخواست آزمون', status: 'ordered', priority: 'normal', notes: '', totalEstimatedAmount: 50000,
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ فیروزه', unit: 'عدد', requestedQty: 5, orderedQty: 5, remainingQty: 0, unitPriceEstimate: 10000, linkedDocumentIds: [41] }],
};

beforeEach(() => {
  fetchJson.mockReset();
  granted.clear();
});
afterEach(cleanup);

/**
 * v9.0.276 (TD-701، B10-14): مودال‌های سفارش همان فیلدهایی را می‌خوانند که سرور برمی‌گرداند. پیش‌تر تأیید تحویل
 * `buyerName` را می‌خواند و به‌جای تأمین‌کننده سفارش «تامین‌کننده تدارکات» نشان می‌داد، و جزئیات درخواست
 * `orderNumber` / `orderDate` را می‌خواند و شماره و تاریخ سفارش خالی می‌ماند.
 */
describe('procurement order fields (TD-701)', () => {
  it('delivery confirmation shows the supplier of the order', () => {
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={serverOrder} />);
    expect(screen.queryByText('تامین الماس')).not.toBeNull();
    expect(screen.queryByText('تامین‌کننده تدارکات')).toBeNull();
  });

  it('bulk delivery lists the supplier of each order', () => {
    const second = { ...serverOrder, id: 42, refNumber: 'R-1405-0010', supplierName: 'تامین یاقوت' };
    render(<ConfirmWarehouseDeliveryModal isOpen isSubmitting={false} onClose={() => undefined} onConfirm={() => undefined} order={null} bulkOrders={[serverOrder, second]} />);
    expect(screen.queryByText('تامین الماس')).not.toBeNull();
    expect(screen.queryByText('تامین یاقوت')).not.toBeNull();
  });

  it('requisition detail shows the number and the Jalali date of each purchase order', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [serverOrder] });
    render(<RequisitionDetailModal isOpen requisition={requisition} warehouseItems={[]} onClose={() => undefined} onRefresh={() => undefined} onOpenSplitOrder={() => undefined} />);
    await waitFor(() => expect(screen.queryAllByText(/تامین الماس/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/R-1405-0009/)).not.toBeNull();
    expect(screen.queryByText(/۱۴۰۵\/۰۷\/۱۴/)).not.toBeNull();
  });
});

const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });

/** the desk's API answers; `fail` names the requests that are refused (by URL prefix) */
function deskApi(fail: Record<string, Error> = {}) {
  fetchJson.mockImplementation(async (u: unknown) => {
    const url = String(u ?? '');
    for (const [prefix, err] of Object.entries(fail)) if (url.startsWith(prefix)) throw err;
    if (url.startsWith('/api/procurement/inbox/summary')) return { success: true, data: { totalRequisitions: 2, pendingCount: 1, underReviewCount: 0, managerApprovalCount: 0, orderedCount: 1, receivedCount: 0, urgentCount: 0, pendingDeliveryOrdersCount: 1, deliveredOrdersCount: 0, totalOrdersCount: 1 } };
    if (url.startsWith('/api/procurement/requisitions')) return { success: true, data: [requisition, pending], total: 2, page: 1, limit: 50 };
    if (url.startsWith('/api/procurement/orders')) return { success: true, data: [serverOrder], total: 1, page: 1, limit: 50 };
    return { success: true, data: [] };
  });
}

const deskRendered = async () => {
  render(<ProcurementDesk />);
  await waitFor(() => expect(fetchJson).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/در حال بارگذاری کارتابل/)).toBeNull());
};

/**
 * v9.0.277 (TD-702، B10-15): هر بخش میز تدارکات جدا بارگذاری می‌شود و خطای یک بخش بخش‌های دیگر را خالی نمی‌کند، و هر
 * دکمه فقط با مجوز همان API نشان داده می‌شود. پیش‌تر چهار درخواست میز در یک `Promise.all` بودند و ۴۰۳ خلاصه (برای
 * دارنده `projects.view`) کل میز را خالی می‌کرد، و دکمه‌ها هیچ مجوزی نمی‌سنجیدند.
 */
describe('procurement desk sections and buttons (TD-702)', () => {
  it('lists the requisitions when only the summary is refused', async () => {
    granted.add('projects.view');
    deskApi({ '/api/procurement/inbox/summary': forbidden() });
    await deskRendered();
    expect(screen.queryAllByText(/PR-1405-0005/).length).toBeGreaterThan(0);
  });

  it('says the requisitions could not be loaded instead of "no requisition found"', async () => {
    granted.add('procurement.view');
    deskApi({ '/api/procurement/requisitions': Object.assign(new Error('Internal server error'), { status: 500 }) });
    await deskRendered();
    expect(screen.queryByText(/هیچ درخواست خریدی/)).toBeNull();
    expect(screen.queryByText(/درخواست‌های خرید بارگذاری نشد/)).not.toBeNull();
  });

  it('a reader sees no create, order, consolidate or delete button', async () => {
    granted.add('procurement.view');
    deskApi();
    await deskRendered();
    expect(screen.queryAllByText(/PR-1405-0006/).length).toBeGreaterThan(0);
    expect(screen.queryByText('ثبت درخواست خرید جدید')).toBeNull();
    expect(screen.queryByText('تفکیک و صدور فاکتور')).toBeNull();
    expect(screen.queryByTitle('حذف درخواست')).toBeNull();
    expect(screen.queryByText('انتخاب همه')).toBeNull();
  });

  it('each button follows the permission of its API', async () => {
    for (const key of ['procurement.view', 'procurement.create', 'procurement.manage', 'procurement.order']) granted.add(key);
    deskApi();
    await deskRendered();
    expect(screen.queryByText('ثبت درخواست خرید جدید')).not.toBeNull();
    expect(screen.queryByText('انتخاب همه')).not.toBeNull();
    expect(screen.queryAllByTitle('حذف درخواست')).toHaveLength(1);
    // ordering an unapproved requisition approves it in the user's name, so it needs an approval permission too (TD-689)
    expect(screen.queryAllByText('تفکیک و صدور فاکتور')).toHaveLength(1);
  });

  it('the requisition detail offers workflow actions only to approvers', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [] });
    granted.add('procurement.view');
    const { unmount } = render(<RequisitionDetailModal isOpen requisition={pending} warehouseItems={[]} onClose={() => undefined} onRefresh={() => undefined} onOpenSplitOrder={() => undefined} />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(screen.queryByText('رد درخواست خرید')).toBeNull();
    expect(screen.queryByText(/تایید و صدور دستور خرید/)).toBeNull();
    unmount();
    granted.add('procurement.approve');
    render(<RequisitionDetailModal isOpen requisition={pending} warehouseItems={[]} onClose={() => undefined} onRefresh={() => undefined} onOpenSplitOrder={() => undefined} />);
    expect(screen.queryByText('رد درخواست خرید')).not.toBeNull();
  });
});

/** the URLs the desk asked for, as `URLSearchParams` of the given path */
const requestsTo = (path: string): URLSearchParams[] => fetchJson.mock.calls
  .map(call => String(call[0] ?? ''))
  .filter(url => url.startsWith(`${path}?`))
  .map(url => new URLSearchParams(url.slice(path.length + 1)));

/**
 * v9.0.278 (TD-697، B10-10): میز درخواست‌ها و سفارش‌ها را صفحه‌به‌صفحه از سرور می‌خواند، با وضعیت، اولویت و جست‌وجوی
 * سرور، و شمار سفارش‌های هر درخواست را از پاسخ سرور نشان می‌دهد. پیش‌تر ۱۰۰ درخواست و ۲۰۰ سفارش آخر خوانده و در
 * مرورگر فیلتر می‌شد، پس درخواست‌های قدیمی‌تر هرگز دیده نمی‌شدند.
 */
describe('procurement desk pages and server filters (TD-697)', () => {
  it('reads one page of requisitions with the status, priority and search of the desk and pages forward', async () => {
    granted.add('procurement.view');
    deskApi();
    fetchJson.mockImplementation(async (u: unknown) => {
      const url = String(u ?? '');
      if (url.startsWith('/api/procurement/requisitions')) return { success: true, data: [requisition, pending], total: 45, page: 1, limit: 20 };
      return { success: true, data: [] };
    });
    await deskRendered();
    const first = requestsTo('/api/procurement/requisitions')[0];
    expect(first?.get('page')).toBe('1');
    expect(first?.get('limit')).toBe('20');
    screen.getByTitle('صفحه بعدی').click();
    await waitFor(() => expect(requestsTo('/api/procurement/requisitions').some(q => q.get('page') === '2')).toBe(true));
    screen.getByText('خرید و تحویل انبار شده (تکمیل)').click();
    await waitFor(() => expect(requestsTo('/api/procurement/requisitions').some(q => q.get('status') === 'received' && q.get('page') === '1')).toBe(true));
    const search = screen.getByPlaceholderText(/جستجو در کد درخواست/);
    fireEvent.change(search, { target: { value: 'فیروزه' } });
    await waitFor(() => expect(requestsTo('/api/procurement/requisitions').some(q => q.get('search') === 'فیروزه')).toBe(true));
  });

  it('shows the order counts the server sends for each requisition', async () => {
    granted.add('procurement.view');
    fetchJson.mockImplementation(async (u: unknown) => {
      const url = String(u ?? '');
      if (url.startsWith('/api/procurement/requisitions')) return { success: true, data: [{ ...requisition, ordersCount: 2, pendingDeliveryOrdersCount: 1 }], total: 1, page: 1, limit: 20 };
      return { success: true, data: [] };
    });
    await deskRendered();
    expect(screen.queryByText('۲ فاکتور خرید')).not.toBeNull();
    expect(screen.queryByText('۱ در انتظار تحویل')).not.toBeNull();
  });

  it('reads each order tab with its own status filter, one page at a time', async () => {
    granted.add('procurement.view');
    deskApi();
    await deskRendered();
    expect(requestsTo('/api/procurement/orders')).toHaveLength(0);
    screen.getByText('۲. فاکتورهای خرید (در انتظار تحویل انبار)').click();
    await waitFor(() => expect(requestsTo('/api/procurement/orders').some(q => q.get('status') === 'pending_delivery' && q.get('limit') === '20')).toBe(true));
    screen.getByText('۳. رسیدهای قطعی انبار (تحویل‌شده)').click();
    await waitFor(() => expect(requestsTo('/api/procurement/orders').some(q => q.get('status') === 'final')).toBe(true));
  });
});
