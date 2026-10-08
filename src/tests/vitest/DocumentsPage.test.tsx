import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentsPage from '../../pages/DocumentsPage';
import type { User } from '../../types';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
// v9.0.241 (TD-791): نوع سند و دکمه ثبت با مجوز ثبت همان نوع؛ انباردار آزمون مجوزهای ثبت این صفحه را دارد
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: ['warehouse.in', 'warehouse.out'], isAdmin: false } }),
  useHasPermission: () => false,
}));

const user: User = { id: 1, username: 'storekeeper', full_name: 'انباردار تست', role: 'staff' };

const reservedItem = { id: 3, type: 'raw_material', name: 'سنگ فیروزه', code: 'RM-3', current_stock: 10, unit: 'عدد', purchase_price: 500 };

function apiResponse(url: string): unknown {
  if (url === '/warehouses') return [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }];
  if (url === '/personnel') return [{ id: 1, fullName: 'علی رضایی', personnelCode: 'P1', jobTitle: 'زرگر' }];
  if (url === '/projects/options') return { success: true, data: [{ id: 7, projectCode: 'PRJ-7', project_code: 'PRJ-7', title: 'گردنبند سفارشی', status: 'in_progress' }] };
  if (url === '/customers?limit=1000') return { data: [] };
  if (url === '/items/options') return { data: [reservedItem] };
  if (url === '/inventory/reserved-items') {
    return {
      allReservationEntries: [
        { sourceType: 'project', sourceId: 7, sourceRef: 'PRJ-7', sourceTitle: 'گردنبند سفارشی', itemId: 3, itemCode: 'RM-3', itemName: 'سنگ فیروزه', reservedQty: 4, unit: 'عدد' },
      ],
    };
  }
  if (url === '/categories') return [];
  if (url === '/documents/next-ref?type=receipt') return { nextRef: 'RC-1001' };
  if (url === '/documents/next-ref?type=remittance') return { nextRef: 'RM-2001' };
  if (url.startsWith('/items/options?search=')) return { data: [] };
  return [];
}

beforeEach(() => {
  fetchJson.mockImplementation((url: string) => Promise.resolve(apiResponse(url)));
});

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsPage user={user} />
    </QueryClientProvider>,
  );
}

function submitButton(label: string): HTMLButtonElement {
  const button = screen.getByText(label).closest('button');
  if (!button) throw new Error(`submit button «${label}» not found`);
  return button as HTMLButtonElement;
}

describe('DocumentsPage — stock receipt / remittance form (TD-080 part 3 characterization)', () => {
  it('renders the receipt (in) form with its labels, next reference and global reservation count', async () => {
    renderPage();
    expect(screen.getByText('ورود و خروج به انبار (رسید و حواله)')).toBeTruthy();
    expect(screen.getByText('ثبت ورود کالا (رسید انبار)')).toBeTruthy();
    expect(screen.getByText('مشخصات سند رسید ورود و انبارداری')).toBeTruthy();
    expect(screen.getByText('تامین‌کننده / فروشنده کالا')).toBeTruthy();
    expect(screen.getByText('انبار مقصد (ورود)')).toBeTruthy();
    expect(screen.getByText('واحد پول (ارز سند)')).toBeTruthy();
    expect(screen.queryByText('پروژه مربوطه (جهت خروج)')).toBeNull();
    expect(await screen.findByDisplayValue('RC-1001')).toBeTruthy();
    expect(await screen.findByText('اقلام رزرو شده انبار (۱ کالا)')).toBeTruthy();
    expect(await screen.findByText('📦 انبار مرکزی')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/documents/next-ref?type=receipt', expect.anything());
  });

  it('keeps the submit button disabled while the document has no items', () => {
    renderPage();
    expect(screen.getByText('هنوز هیچ کالایی به جدول اقلام این سند اضافه نشده است.')).toBeTruthy();
    expect(submitButton('ثبت نهایی و صدور سند رسید خرید').disabled).toBe(true);
  });

  it('switches to the remittance (out) form with recipient personnel and project selection', async () => {
    renderPage();
    fireEvent.click(screen.getByText('خروج از انبار (حواله مصرف)'));
    expect(screen.getByText('ثبت خروج کالا (حواله مصرف)')).toBeTruthy();
    expect(screen.getByText('مشخصات سند حواله خروج و تحویل‌گیرنده')).toBeTruthy();
    expect(screen.getByText('گیرنده حواله (پرسنل کارگاه)')).toBeTruthy();
    expect(screen.getByText('پروژه مربوطه (جهت خروج)')).toBeTruthy();
    expect(screen.getByText('انبار مبدا (خروج)')).toBeTruthy();
    expect(screen.getByText('⚠️ خروج کالا تنها از موجودی آزاد و غیررزروی امکان‌پذیر است')).toBeTruthy();
    expect(screen.queryByText('واحد پول (ارز سند)')).toBeNull();
    expect(await screen.findByText('پروژه PRJ-7 - گردنبند سفارشی')).toBeTruthy();
    expect(await screen.findByDisplayValue('RM-2001')).toBeTruthy();
    expect(submitButton('ثبت نهایی و صدور حواله خروج').disabled).toBe(true);
  });

  it('shows the selected project reservations and adds a reserved item to the remittance', async () => {
    renderPage();
    fireEvent.click(screen.getByText('خروج از انبار (حواله مصرف)'));
    await screen.findByText('پروژه PRJ-7 - گردنبند سفارشی');
    await screen.findByText('اقلام رزرو شده انبار (۱ کالا)');
    const projectSelect = screen.getByDisplayValue('— خروج عمومی (بدون تخصیص به پروژه) —');
    fireEvent.change(projectSelect, { target: { value: '7' } });
    expect(await screen.findByText('اقلام رزرو شده انبار برای پروژه «PRJ-7»')).toBeTruthy();
    expect(screen.getByText('۱ قلم کالای رزروشده')).toBeTruthy();
    // v9.0.139 (TD-889): پروژه برگزیده از فهرست انتخاب می‌آید، نه از پرونده کامل پروژه
    expect(fetchJson.mock.calls.some(([url]) => String(url).startsWith('/projects/7'))).toBe(false);
    await screen.findByText('+ افزودن');
    fireEvent.click(screen.getByText('+ افزودن'));
    expect(await screen.findByText('✓ در سند')).toBeTruthy();
    expect(submitButton('ثبت نهایی و صدور حواله خروج').disabled).toBe(false);
  });

  it('caps a remittance by the stock of the source warehouse, not the total (TD-799)', async () => {
    // v9.0.242 (B08-30): کالا فقط در انبار دوم موجودی دارد؛ «بارگذاری تمام اقلام» رزرو پروژه را از انبار اول به صفر محدود می‌کند و از انبار دوم می‌افزاید
    const splitItem = { ...reservedItem, stocks: { WH1: 0, WH2: 10 }, stock_WH1: 0, stock_WH2: 10 };
    fetchJson.mockImplementation((url: string) => Promise.resolve(
      url === '/warehouses' ? [{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }, { id: 2, name: 'انبار دوم', code: 'WH2', is_active: 1 }]
        : url === '/items/options' ? { data: [splitItem] }
          : apiResponse(url),
    ));
    renderPage();
    fireEvent.click(screen.getByText('خروج از انبار (حواله مصرف)'));
    await screen.findByText('پروژه PRJ-7 - گردنبند سفارشی');
    await screen.findByText('اقلام رزرو شده انبار (۱ کالا)');
    await screen.findByText('📦 انبار دوم');
    fireEvent.change(screen.getByDisplayValue('— خروج عمومی (بدون تخصیص به پروژه) —'), { target: { value: '7' } });
    fireEvent.click(await screen.findByText('➕ بارگذاری تمام اقلام رزروشده در حواله'));
    expect(screen.queryByText('✓ در سند')).toBeNull();
    expect(submitButton('ثبت نهایی و صدور حواله خروج').disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue('📦 انبار مرکزی'), { target: { value: 'WH2' } });
    fireEvent.click(screen.getByText('➕ بارگذاری تمام اقلام رزروشده در حواله'));
    expect(await screen.findByText('✓ در سند')).toBeTruthy();
    expect(submitButton('ثبت نهایی و صدور حواله خروج').disabled).toBe(false);
  });
});
