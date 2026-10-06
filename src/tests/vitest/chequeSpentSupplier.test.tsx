import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Cheque, Customer } from '../../types';

vi.mock('../../hooks/accounting/useChequeQueries', () => ({ useChequeReconciliationReport: () => ({ data: [], loading: false }) }));
vi.mock('../../hooks/useAppCurrency', () => ({ useAppCurrency: () => 'IRR' }));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import { ChequesTab } from '../../components/accounting/ChequesTab';

afterEach(cleanup);

const received = {
  id: 4, type: 'received', chequeNumber: '111004', bankName: 'Test bank', issueDate: '2026-10-06', dueDate: '2026-10-06',
  amount: 4_000_000, currency: 'IRR', partyName: 'Test customer', status: 'received',
} as Cheque;
const parties = [
  { id: 3, name: 'شرکت بازرگانی پارس', partyType: 'supplier' },
  { id: 7, name: 'مشتری فقط', partyType: 'customer' },
] as unknown as Customer[];

// v9.0.85 (TD-498، B04-02، تصمیم ت۳ الف): خرج چک تأمین‌کننده را با شناسه از فهرست می‌گیرد؛ پیش‌تر پنجره فقط کادر نام داشت
// و `onUpdateStatus(4, 'spent', '', undefined, 'شرکت بازرگانی پارس')` بی شناسه صدا زده می‌شد.
describe('spending a cheque asks for a supplier (TD-498)', () => {
  it('is not sent without a supplier and sends the chosen supplier id', async () => {
    const onUpdateStatus = vi.fn(async (..._args: unknown[]) => undefined);
    const { container } = render(
      <ChequesTab cheques={[received]} bankAccounts={[]} customers={parties} personnelList={[]} loading={false}
        onRefresh={() => undefined} onCreateCheque={async () => undefined} onUpdateStatus={onUpdateStatus} onDeleteCheque={async () => undefined} />
    );
    fireEvent.click(screen.getAllByText('دریافت شده').find(el => el.tagName === 'BUTTON') as HTMLElement);
    const statusSelect = await waitFor(() => {
      const select = Array.from(container.ownerDocument.querySelectorAll('form select')).find(s => s.querySelector('option[value="spent"]'));
      if (!select) throw new Error('status select not shown');
      return select as HTMLSelectElement;
    });
    fireEvent.change(statusSelect, { target: { value: 'spent' } });
    expect(screen.getByText('تأمین‌کننده گیرنده چک *')).toBeTruthy();
    const form = statusSelect.closest('form') as HTMLFormElement;
    // no free-text payee name field (the only text input is the action date picker, v9.0.89)
    expect(Array.from(form.querySelectorAll('input')).filter(i => i.getAttribute('placeholder') !== 'تاریخ اقدام' && i.type === 'text')).toEqual([]);

    fireEvent.submit(form);
    await waitFor(() => expect(onUpdateStatus).not.toHaveBeenCalled());

    fireEvent.click(screen.getByText('جستجو و انتخاب تأمین‌کننده...'));
    expect(screen.queryByText('مشتری فقط')).toBeNull();
    fireEvent.click(await screen.findByText('شرکت بازرگانی پارس'));
    fireEvent.submit(form);
    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledTimes(1));
    expect(onUpdateStatus.mock.calls[0][0]).toBe(4);
    expect(onUpdateStatus.mock.calls[0][1]).toBe('spent');
    expect(onUpdateStatus.mock.calls[0][4]).toBe(3);
  });
});
