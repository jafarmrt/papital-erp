import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import ReservedItemsReportPage from '../../pages/ReservedItemsReportPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const emptyReport = {
  summaryMetrics: { totalReservedItemsCount: 0, totalReservedQty: 0, totalReservedValue: 0, proformaReservationsCount: 0, projectReservationsCount: 0 },
  itemSummaries: [],
  allReservationEntries: [],
};

// v9.0.375 (TD-821، یافته B07-05): گزارشی که ساخته نشد پنل خطا با «تلاش مجدد» است، نه صفحه‌ای با رزرو صفر. پیش‌تر صفحه فقط
// یک پیام گذرا نشان می‌داد و همه شمارنده‌ها «۰» می‌ماند، پس خطای خواندن رزرو با «هیچ رزروی نیست» یکی دیده می‌شد.
describe('reserved items report shows a load error instead of zeros (TD-821)', () => {
  it('shows an error panel without the report, and the report after a successful retry', async () => {
    fetchJson.mockRejectedValueOnce(new Error('reservation read failed'));
    render(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('گزارش اقلام رزروی ساخته نشد');
    expect(screen.queryByText('گزارش اقلام رزروی انبار')).toBeNull();

    fetchJson.mockResolvedValueOnce(emptyReport);
    fireEvent.click(screen.getByText('تلاش مجدد'));
    await waitFor(() => expect(screen.getByText('گزارش اقلام رزروی انبار')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
