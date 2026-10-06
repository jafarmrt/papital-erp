import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({})) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/accounting/useTreasuryQueries', () => ({
  useContraAccountsQuery: () => ({ data: [{ id: 76, code: '7002', name: 'هزینه اجاره کارگاه و دفتر', accountType: 'expense' }], isLoading: false }),
}));

import { TreasuryTransactionModal } from '../../components/accounting/treasury/TreasuryTransactionModal';
import type { BankAccount, Personnel } from '../../types';

afterEach(cleanup);

const bank = { id: 5, code: '1003-01', title: 'بانک آزمون', type: 'bank', currency: 'IRR', currentBalance: 10_000_000, accountId: 40 } as unknown as BankAccount;
const worker = { id: 9, firstName: 'علی', lastName: 'رضایی' } as unknown as Personnel;

function renderModal(onSave: (data: Record<string, unknown>) => Promise<void>) {
  return render(
    <TreasuryTransactionModal isOpen onClose={() => undefined} type="payment" bankAccounts={[bank]} customers={[]}
      personnelList={[worker]} appCurrency="IRR" onSave={onSave} />
  );
}

function partyTypeSelect(container: HTMLElement): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option[value="other"]') && s.querySelector('option[value="customer"]'));
  if (!select) throw new Error('party type select not found');
  return select as HTMLSelectElement;
}

// v9.0.72 (TD-507، تصمیم مالک محصول ت۴ الف): «متفرقه» و «سایر» پرسنل سرفصل طرف مقابل را از کاربر می‌گیرند و هدف پرسنل الزامی است
describe('treasury form asks the counter account (TD-507)', () => {
  it('a misc payment shows the counter account field and is not saved until an account is chosen', async () => {
    const onSave = vi.fn(async (_data: Record<string, unknown>) => undefined);
    const { container } = renderModal(onSave);
    fireEvent.change(partyTypeSelect(container), { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByText('سرفصل طرف مقابل *')).toBeTruthy());

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());

    const input = screen.getByPlaceholderText('جستجو و انتخاب سرفصل معین...');
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText(/هزینه اجاره کارگاه و دفتر/));
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ partyType: 'other', contraAccountId: 76, purpose: undefined });
  });

  it('a personnel payment has no default purpose, and «other» asks the counter account', async () => {
    const { container } = renderModal(async () => undefined);
    fireEvent.change(partyTypeSelect(container), { target: { value: 'personnel' } });
    const purpose = await waitFor(() => {
      const select = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option[value="advance"]'));
      if (!select) throw new Error('purpose select not shown');
      return select as HTMLSelectElement;
    });
    expect(purpose.value).toBe('');
    expect(purpose.required).toBe(true);
    expect(screen.queryByText('سرفصل طرف مقابل *')).toBeNull();
    fireEvent.change(purpose, { target: { value: 'other' } });
    await waitFor(() => expect(screen.getByText('سرفصل طرف مقابل *')).toBeTruthy());
  });
});
