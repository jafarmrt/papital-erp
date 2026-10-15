import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { fetchJson, toastFn } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
  getAuthToken: () => null,
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));

import { ItemCodeChangeModal } from '../../components/items/ItemCodeChangeModal';
import { ItemsTable } from '../../components/items/ItemsTable';
import { itemCodeChangeError, oldCodeOrderNote } from '../../lib/items/itemCodeChange';
import { PERMISSION_CATALOG } from '../../lib/permissions/permissionCatalog';
import { ITEM_PICK_WITH_RESERVED_URL, itemPickWithReservedUrl } from '../../lib/permissions/pickLists';
import { BULK_DELIVERY_NO_ORDERS } from '../../lib/procurement/requisitionActions';
import type { Item } from '../../types';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** the server's answer the window shows as is */
const CODE_TAKEN_MESSAGE = 'این کد را کالای دیگری دارد.';

const item = { id: 7, code: 'NE-100', name: 'گردنبند آزمون', version: 3, category: 'گردنبند', type: 'product' } as unknown as Item;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastFn.success.mockReset();
});

// v10.1.8 (D-15, TD-1264): the item code is the online shop's SKU and changes only through «تغییر کد»
describe('item code change window (D-15)', () => {
  it('checks the new code and the reason before sending', () => {
    expect(itemCodeChangeError('NE-100', ' ', 'x')).toBe('کد تازه را بنویسید.');
    expect(itemCodeChangeError('NE-100', 'NE-100 ', 'x')).toBe('کد تازه با کد فعلی کالا یکی است.');
    expect(itemCodeChangeError('NE-100', 'NE-101', '  ')).toBe('دلیل تغییر کد را بنویسید.');
    expect(itemCodeChangeError('NE-100', 'NE-101', 'اصلاح')).toBeNull();
  });

  it('names the earlier codes an online order found its items by', () => {
    expect(oldCodeOrderNote([])).toBe('');
    expect(oldCodeOrderNote(['NE-100'])).toContain('«NE-100»');
  });

  it('is a permission of its own that needs the item edit key', () => {
    const entry = PERMISSION_CATALOG.flatMap(g => g.permissions).find(p => p.key === 'products.change_code');
    expect(entry?.requires).toEqual(['products.edit']);
  });

  it('sends the item version and shows the server message', async () => {
    fetchJson.mockImplementation((url: string) => (url.endsWith('/code-history')
      ? Promise.resolve({ data: [{ oldCode: 'NE-090', newCode: 'NE-100', reason: 'یکسان‌سازی', username: 'مدیر', createdAt: '2026-10-01T08:00:00.000Z' }] })
      : Promise.reject(new Error(CODE_TAKEN_MESSAGE))));
    const onChanged = vi.fn();
    render(<ItemCodeChangeModal item={item} onClose={() => undefined} onChanged={onChanged} />);
    expect(await screen.findByText('NE-090 → NE-100')).not.toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'کد تازه' }), { target: { value: ' NE-200 ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'دلیل تغییر' }), { target: { value: 'کد تکراری' } });
    fireEvent.click(screen.getByRole('button', { name: 'تغییر کد' }));
    expect((await screen.findByRole('alert')).textContent).toBe(CODE_TAKEN_MESSAGE);
    const post = fetchJson.mock.calls.find(([url]) => url === '/items/7/change-code');
    expect(JSON.parse(String((post?.[1] as { body: string }).body))).toEqual({ code: 'NE-200', reason: 'کد تکراری', version: 3 });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('is offered in the item list only with its handler', () => {
    const props = {
      sortedItems: [item], warehouses: [], sortConfig: null, requestSort: () => undefined, loading: false,
      onViewImage: () => undefined, page: 1, totalPages: 1, totalItems: 1, onPageChange: () => undefined,
    };
    const { unmount } = render(<ItemsTable {...props} onEditItem={() => undefined} />);
    expect(screen.queryByTitle('عملیات کالا')).toBeNull();
    unmount();
    const onChangeCode = vi.fn();
    render(<ItemsTable {...props} onChangeCode={onChangeCode} />);
    fireEvent.click(screen.getByTitle('عملیات کالا'));
    fireEvent.click(screen.getByText('تغییر کد'));
    expect(onChangeCode).toHaveBeenCalledWith(item);
  });

  it('the items page opens it only for holders of products.change_code', () => {
    const page = read('pages/ItemsPage.tsx');
    expect(page).toContain("useHasPermission('products.change_code')");
    expect(page).toContain('onChangeCode={canChangeCode ?');
  });
});

// v10.1.8 (TD-1209): an open proforma being edited counted its own reservation in «رزرو» of its item picker
describe('the edited proforma leaves out its own reservation (TD-1209)', () => {
  it('asks the pick list without the edited document', () => {
    expect(itemPickWithReservedUrl(null)).toBe(ITEM_PICK_WITH_RESERVED_URL);
    expect(itemPickWithReservedUrl(0)).toBe(ITEM_PICK_WITH_RESERVED_URL);
    expect(itemPickWithReservedUrl(42)).toBe(`${ITEM_PICK_WITH_RESERVED_URL}&excludeDocumentId=42`);
    expect(read('pages/CreateInvoicePage.tsx')).toContain('fetchUrl={itemPickWithReservedUrl(editingDocId)}');
  });
});

// v10.1.8: bulk delivery without an order named a button the window shows only before approval
describe('bulk delivery without an order names the button the window shows', () => {
  it('points to the order button of an approved requisition', () => {
    expect(BULK_DELIVERY_NO_ORDERS).toContain('«مشاهده / ثبت فاکتور تامین‌کننده»');
    expect(BULK_DELIVERY_NO_ORDERS).not.toContain('تفکیک تأمین‌کننده و صدور سفارش خرید');
    expect(read('components/procurement/RequisitionDetailModal.tsx')).toContain('مشاهده / ثبت فاکتور تامین‌کننده');
  });
});
