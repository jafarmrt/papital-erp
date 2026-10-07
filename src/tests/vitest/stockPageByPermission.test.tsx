import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentsPage from '../../pages/DocumentsPage';
import { permissionToCreateDocument } from '../../services/documents/documentRecordRule';
import { STOCK_PAGE_DOC_TYPES, stockPageAccess, stockPageRecordPermission } from '../../lib/documents/stockDocumentAccess';
import type { User } from '../../types';

// v9.0.241 (TD-791، یافته B08-22، تصمیم ت۱ «الف» بسته ۸): صفحه «ورود و خروج به انبار» جهت، نوع سند و دکمه ثبت را با همان
// مجوزی نشان می‌دهد که سرور برای ثبت قطعی آن نوع می‌سنجد، نه با کد نقش. پیش‌تر دکمه فقط برای کد `viewer` غیرفعال بود: مدیر
// تولید (فقط `warehouse.in`) برگشت از فروش را می‌دید و ۴۰۳ می‌گرفت، و کاربری بی مجوز ثبت دکمه فعال می‌دید.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
  useHasPermission: (key: string) => granted.has(key),
}));

const reservedItem = { id: 3, type: 'raw_material', name: 'سنگ فیروزه', code: 'RM-3', current_stock: 10, unit: 'عدد', purchase_price: 500 };

function apiResponse(url: string): unknown {
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url === '/personnel') return [];
  if (url === '/projects/options') return { success: true, data: [{ id: 7, projectCode: 'PRJ-7', project_code: 'PRJ-7', title: 'گردنبند سفارشی', status: 'in_progress' }] };
  if (url.startsWith('/items/options')) return { data: url === '/items/options' ? [reservedItem] : [] };
  if (url === '/inventory/reserved-items') {
    return {
      allReservationEntries: [
        { sourceType: 'project', sourceId: 7, sourceRef: 'PRJ-7', sourceTitle: 'گردنبند سفارشی', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ فیروزه', reservedQty: 4, unit: 'عدد' },
      ],
    };
  }
  if (url.startsWith('/documents/next-ref?type=')) return { nextRef: `NEXT-${url.split('=')[1]}` };
  return [];
}

beforeEach(() => {
  granted.clear();
  fetchJson.mockImplementation((url: string) => Promise.resolve(apiResponse(url)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function renderPage(role: string, permissions: string[]) {
  for (const p of permissions) granted.add(p);
  const user: User = { id: 1, username: 'p8user', full_name: 'کاربر آزمون', role };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsPage user={user} />
    </QueryClientProvider>,
  );
}

const toggle = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement;
const typeSelect = () => screen.getByText('نوع سند').parentElement!.querySelector('select') as HTMLSelectElement;
const typeValues = () => Array.from(typeSelect().options).map(o => o.value);
const submitButton = () => screen.getByText(/ثبت نهایی و صدور/).closest('button') as HTMLButtonElement;

async function addReservedItemToRemittance() {
  await screen.findByText('پروژه PRJ-7 - گردنبند سفارشی');
  await screen.findByText('اقلام رزرو شده انبار (1 کالا)');
  fireEvent.change(screen.getByDisplayValue('— خروج عمومی (بدون تخصیص به پروژه) —'), { target: { value: '7' } });
  fireEvent.click(await screen.findByText('+ افزودن'));
  await screen.findByText('✓ در سند');
}

describe('stock document page follows the record permission of each type, not the role code (TD-791)', () => {
  it('asks for each type exactly the permission the server asks to record it final', () => {
    for (const types of Object.values(STOCK_PAGE_DOC_TYPES)) {
      for (const docType of types) {
        expect(stockPageRecordPermission(docType)).toBe(permissionToCreateDocument({ docType, status: 'final' }));
      }
    }
    expect(stockPageAccess(k => k === 'warehouse.in').types).toEqual({ in: ['receipt'], out: [] });
    expect(stockPageAccess(k => k === 'warehouse.out').types).toEqual({ in: [], out: ['remittance', 'waste'] });
    expect(stockPageAccess(k => k === 'documents.finalize').types).toEqual({ in: ['return'], out: [] });
    expect(stockPageAccess(() => false).directions).toEqual([]);
  });

  it('a production manager with warehouse.in alone is offered receipts only, not a sales return or the remittance side', async () => {
    renderPage('production_manager', ['warehouse.view', 'warehouse.in', 'documents.view']);
    await waitFor(() => expect(typeValues()).toEqual(['receipt']));
    expect(toggle('خروج از انبار (حواله مصرف)').disabled).toBe(true);
    expect(toggle('ورود به انبار (رسید انبار)').disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the viewer role code no longer disables the button: a warehouse.out holder starts on the remittance side and can submit', async () => {
    renderPage('viewer', ['warehouse.view', 'warehouse.out']);
    await waitFor(() => expect(typeValues()).toEqual(['remittance', 'waste']));
    expect(toggle('ورود به انبار (رسید انبار)').disabled).toBe(true);
    await addReservedItemToRemittance();
    expect(submitButton().disabled).toBe(false);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('a user who can record nothing here sees why, and the button stays disabled with an item in the document', async () => {
    renderPage('staff', ['documents.view', 'documents.create']);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('ثبت خروج کالا (حواله)');
    fireEvent.click(toggle('خروج از انبار (حواله مصرف)'));
    await addReservedItemToRemittance();
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('«ثبت خروج کالا (حواله)»');
  });

  it('a holder of documents.finalize alone records sales returns: the type moves to return and its number is fetched', async () => {
    renderPage('staff', ['documents.view', 'documents.finalize']);
    await waitFor(() => expect(typeSelect().value).toBe('return'));
    expect(typeValues()).toEqual(['return']);
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/documents/next-ref?type=return', expect.anything()));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

// v9.0.256 (TD-780، یافته B08-11، تصمیم ت۷ «الف» بسته ۸): محصول پروژه فقط از «ورود به انبار» همان پروژه وارد انبار می‌شود
describe('stock document page never offers a production receipt (TD-780)', () => {
  it('no permission set makes the stock page offer a production receipt', () => {
    expect(Object.values(STOCK_PAGE_DOC_TYPES).flat()).not.toContain('production_receipt');
    expect(stockPageAccess(() => true).types.in).toEqual(['receipt', 'return']);
  });

  it('a holder of every record permission sees only purchase receipts and sales returns on the in side', async () => {
    renderPage('manager', ['warehouse.view', 'warehouse.in', 'warehouse.out', 'documents.view', 'documents.finalize']);
    await waitFor(() => expect(typeValues()).toEqual(['receipt', 'return']));
    expect(screen.queryByText('رسید انبار تولید (تحویل محصولات ساخته‌شده)')).toBeNull();
  });
});
