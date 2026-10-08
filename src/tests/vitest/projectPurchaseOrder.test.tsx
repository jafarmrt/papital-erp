import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Item, ProductionProject, PurchaseListItem } from '../../types';

const fetchJson = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({
  toast: { error: (msg: string) => toastError(msg), success: (msg: string) => toastSuccess(msg) },
}));
// مرجع پایدار، مانند داده react-query؛ آرایه تازه در هر رندر useEffect انبار مقصد را بی‌پایان اجرا می‌کند
const { warehousesResult, suppliersResult, granted } = vi.hoisted(() => {
  const parties = [
    { id: 12, name: 'تأمین‌کننده الف', partyType: 'supplier', phone: '' },
    { id: 13, name: 'مشتری ب', partyType: 'customer', phone: '' },
    { id: 14, name: 'طرف حساب ج', partyType: 'both', phone: '' },
  ];
  return {
    warehousesResult: { data: [{ id: 1, code: 'WH1', name: 'انبار مرکزی' }, { id: 2, code: 'WH2', name: 'انبار مواد' }] },
    suppliersResult: { suppliers: parties, options: parties.map(p => ({ value: p.name, label: p.name })) },
    granted: new Set<string>(),
  };
});
vi.mock('../../hooks/queries/useSettingsQueries', () => ({ useWarehousesQuery: () => warehousesResult }));
vi.mock('../../hooks/useEntitySelectors', () => ({ useSupplierSelectOptions: () => suppliersResult }));
vi.mock('../../contexts/AuthContext', () => ({
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(k => granted.has(k)),
}));
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange, options = [] }: {
    value: string; onChange: (v: string) => void; options?: Array<{ value: string; label: string }>;
  }) => (
    <select aria-label="تأمین‌کننده" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">-</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { CreatePurchaseOrderModal } from '../../components/project/CreatePurchaseOrderModal';
import { supplierPickOptions } from '../../lib/projects/projectPurchaseOrder';
import { getTodayIsoDate } from '../../utils';

const project = { id: 7, project_code: 'PRJ-7', title: 'گردنبند سفارشی' } as unknown as ProductionProject;
const purchaseList = [
  { id: 'r1', itemCode: 'RM-9', itemName: 'سنگ فیروزه', category: '', totalRequiredQty: 12, unit: 'عدد', warehouseStockQty: 2, toPurchaseQty: 10 },
] as PurchaseListItem[];
const warehouseItems = [{ id: 9, code: 'RM-9', name: 'سنگ فیروزه', unit: 'عدد', weighted_average_cost: 1000 }] as unknown as Item[];
const ALL_KEYS = ['procurement.create', 'procurement.order', 'procurement.approve'];

const onOrderCreated = vi.fn();
const renderModal = () => render(
  <CreatePurchaseOrderModal isOpen onClose={() => undefined} project={project} purchaseList={purchaseList} warehouseItems={warehouseItems} onOrderCreated={onOrderCreated} />,
);
const DIRECT_TAB = 'سفارش خرید پیش‌نویس به تأمین‌کننده (سریع)';
const calls = () => fetchJson.mock.calls.map(([url, opts]) => ({ url: String(url), body: JSON.parse(String((opts as { body?: string })?.body ?? '{}')) as Record<string, unknown> }));

beforeEach(() => {
  granted.clear();
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/api/procurement/requisitions') return { success: true, data: { id: 41, code: 'PR-1405-0007' } };
    if (url.endsWith('/convert-to-orders')) return { success: true, data: { createdDocuments: [{ id: 90, refNumber: 'RC-1405-0012' }] } };
    return { success: true };
  });
});
afterEach(() => { cleanup(); toastError.mockReset(); toastSuccess.mockReset(); onOrderCreated.mockReset(); });

// v9.0.392 (TD-745، B11-11، تصمیم ت۸ ب): سفارش مستقیم صفحه پروژه فقط سفارش پیش‌نویس تدارکات با شماره سامانه
describe('direct purchase order from a project (TD-745)', () => {
  it('records a draft procurement order with the server number, a listed supplier and a listed warehouse', async () => {
    ALL_KEYS.forEach(k => granted.add(k));
    renderModal();
    fireEvent.click(screen.getByText(DIRECT_TAB));
    expect(screen.queryByText(/رسید خرید قطعی/)).toBeNull();
    expect(screen.queryByDisplayValue(/^PO-/)).toBeNull();
    expect([...screen.getByLabelText('تأمین‌کننده').querySelectorAll('option')].map(o => o.textContent)).toEqual(['-', 'تأمین‌کننده الف', 'طرف حساب ج']);

    fireEvent.change(screen.getByLabelText('تأمین‌کننده'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('انبار مقصد:'), { target: { value: 'WH2' } });
    fireEvent.click(screen.getByText('صدور سفارش خرید پیش‌نویس'));

    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    const [requisition, order] = calls();
    expect(requisition.url).toBe('/api/procurement/requisitions');
    expect(requisition.body).toMatchObject({ projectId: 7, items: [{ itemId: 9, requestedQty: 10, unitPriceEstimate: 1000 }] });
    // v9.0.396 (TD-764): the required date is picked on the Jalali calendar and sent as ISO (it was Jalali text)
    expect(requisition.body.requiredDate).toBe(getTodayIsoDate());
    expect(order.url).toBe('/api/procurement/requisitions/41/convert-to-orders');
    expect(order.body).toEqual({
      orderGroups: [expect.objectContaining({
        supplierId: 12, supplierName: 'تأمین‌کننده الف', targetWarehouse: 'WH2', docType: 'receipt', status: 'draft',
        items: [expect.objectContaining({ itemId: 9, quantity: 10, unitPrice: 1000 })],
      })],
    });
    expect(calls().some(c => c.url.includes('/documents') || 'refNumber' in c.body)).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('RC-1405-0012'));
    expect(onOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }), ['r1']);
  });

  it('asks for a supplier from the list before sending anything', () => {
    ALL_KEYS.forEach(k => granted.add(k));
    renderModal();
    fireEvent.click(screen.getByText(DIRECT_TAB));
    fireEvent.click(screen.getByText('صدور سفارش خرید پیش‌نویس'));
    expect(fetchJson).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('تأمین‌کننده سفارش را از فهرست انتخاب کنید.');
  });

  it('keeps the requisition and says so when the order is refused', async () => {
    ALL_KEYS.forEach(k => granted.add(k));
    fetchJson.mockImplementation(async (url: string) => {
      if (url === '/api/procurement/requisitions') return { success: true, data: { id: 41, code: 'PR-1405-0007' } };
      throw Object.assign(new Error('refused'), { message: 'درخواست خرید PR-1405-0007 هنوز تأیید نشده است.' });
    });
    renderModal();
    fireEvent.click(screen.getByText(DIRECT_TAB));
    fireEvent.change(screen.getByLabelText('تأمین‌کننده'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('صدور سفارش خرید پیش‌نویس'));
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain('درخواست خرید PR-1405-0007 ثبت شد ولی سفارش صادر نشد');
    expect(onOrderCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }), ['r1']);
  });

  it('offers only the purchase requisition to a user who may not approve and order', async () => {
    granted.add('procurement.create');
    renderModal();
    expect(screen.queryByText(/مستقیم|پیش‌نویس به تأمین‌کننده/)).toBeNull();
    fireEvent.click(screen.getByText('ثبت و ارسال درخواست به کارتابل تدارکات'));
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));
    expect(calls()[0].url).toBe('/api/procurement/requisitions');
    expect(calls()[0].body).toMatchObject({ priority: 'normal', items: [{ itemId: 9, requestedQty: 10 }] });
  });
});

describe('supplier pick options (TD-745)', () => {
  it('lists supplier and both-type parties by id', () => {
    expect(supplierPickOptions([
      { id: 1, name: 'الف', partyType: 'supplier', phone: '0912' },
      { id: 2, name: 'ب', partyType: 'customer' },
      { id: 3, name: ' ج ', partyType: 'both' },
      { id: 0, name: 'بی شناسه', partyType: 'supplier' },
    ])).toEqual([
      { value: '1', label: 'الف - 0912', supplier: { id: 1, name: 'الف' } },
      { value: '3', label: ' ج ', supplier: { id: 3, name: 'ج' } },
    ]);
  });
});
