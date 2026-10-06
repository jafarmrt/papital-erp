import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Cheque } from '../../types';
import { getTodayIsoDate } from '../../utils';

vi.mock('../../hooks/accounting/useChequeQueries', () => ({ useChequeReconciliationReport: () => ({ data: [], loading: false }) }));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import { ChequesTab } from '../../components/accounting/ChequesTab';

afterEach(cleanup);

const received = {
  id: 9, type: 'received', chequeNumber: '111009', bankName: 'Test bank', issueDate: '2026-09-01', dueDate: '2026-10-01',
  amount: 4_000_000, currency: 'IRR', partyName: 'Test customer', status: 'received',
} as Cheque;

// v9.0.89 (TD-506، B04-10، تصمیم ت۶ الف): پنجره تغییر وضعیت چک تاریخ اقدام دارد (پیش‌فرض امروز) و آن را می‌فرستد؛ پیش‌تر
// پنجره هیچ تاریخی نداشت و سند هر گام به تاریخ روز ثبت در سیستم صادر می‌شد.
describe('cheque status form sends the action date (TD-506)', () => {
  it('shows an action date defaulting to today and sends it', async () => {
    const onUpdateStatus = vi.fn(async (..._args: unknown[]) => undefined);
    const { container } = render(
      <ChequesTab cheques={[received]} bankAccounts={[]} customers={[]} personnelList={[]} loading={false}
        onRefresh={() => undefined} onCreateCheque={async () => undefined} onUpdateStatus={onUpdateStatus} onDeleteCheque={async () => undefined} />
    );
    fireEvent.click(screen.getAllByText('دریافت شده').find(el => el.tagName === 'BUTTON') as HTMLElement);
    const form = await waitFor(() => {
      const f = container.ownerDocument.querySelector('form select')?.closest('form');
      if (!f) throw new Error('status form not shown');
      return f as HTMLFormElement;
    });
    expect(screen.getByText('تاریخ اقدام *')).toBeTruthy();
    expect(form.querySelector('input[placeholder="تاریخ اقدام"]')).not.toBeNull();

    fireEvent.submit(form);
    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledTimes(1));
    expect(onUpdateStatus.mock.calls[0][0]).toBe(9);
    expect(onUpdateStatus.mock.calls[0][5]).toBe(getTodayIsoDate());
  });
});
