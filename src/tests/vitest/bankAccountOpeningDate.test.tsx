import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({ code: 'BANK-09' })) }));
vi.mock('../../components/common/JalaliDateInput', () => ({
  JalaliDateInput: ({ id, value, onChange, disabled }: { id?: string; value: string; onChange: (iso: string) => void; disabled?: boolean }) => (
    <input id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
  ),
}));

import { BankAccountModal } from '../../components/accounting/treasury/BankAccountModal';
import { getTodayIsoDate } from '../../utils/dateUtils';
import type { BankAccount } from '../../types';

afterEach(cleanup);

/**
 * 10.3 package 4 (OBS-R1-65, decision ت۴۷ item 2): the bank account form asks for the account's start date («تاریخ آغاز
 * حساب», default today), which dates the opening voucher; an edit sends it only when changed, and once the opening voucher
 * is issued the field is read only. Red on v10.3.18: the form had no such field and sent no start date.
 * v11 phase 3.1 (M2): a draft opening voucher moves with the start date, so the field locks only once that voucher is approved.
 */
const SHOWN = {
  startDate: 'تاریخ آغاز حساب',
  titlePlaceholder: 'مثال: حساب جاری ملت - کارگاه',
} as const;

const savedBank = (overrides: Partial<BankAccount>): BankAccount => ({
  id: 7, code: 'BANK-07', title: 'Saved bank', type: 'bank', currency: 'IRR', initialBalance: 0, accountId: null, ...overrides,
});

function renderForm(editingBank: BankAccount | null, onSave: (data: unknown, id?: number) => Promise<void>) {
  render(<BankAccountModal isOpen onClose={() => undefined} editingBank={editingBank} accounts={[]} appCurrency="IRR" onSave={onSave} />);
  return screen.getByLabelText(SHOWN.startDate) as HTMLInputElement;
}

describe('bank account start date (OBS-R1-65)', () => {
  it('a new account starts today unless the user picks another day, and the day is sent', async () => {
    const onSave = vi.fn(async (..._args: unknown[]) => undefined);
    const field = renderForm(null, onSave);
    expect(field.value).toBe(getTodayIsoDate());
    fireEvent.change(field, { target: { value: '2026-04-05' } });
    fireEvent.change(screen.getByPlaceholderText(SHOWN.titlePlaceholder), { target: { value: 'حساب تازه' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { openingDate?: string }).openingDate).toBe('2026-04-05');
  });

  it('an edit sends the start date only when it changed', async () => {
    const onSave = vi.fn(async (..._args: unknown[]) => undefined);
    const field = renderForm(savedBank({ openingDate: '2026-04-07', openingVoucherIssued: false }), onSave);
    expect(field.value).toBe('2026-04-07');
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('openingDate');

    fireEvent.change(field, { target: { value: '2026-04-08' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect((onSave.mock.calls[1][0] as { openingDate?: string }).openingDate).toBe('2026-04-08');
    expect(onSave.mock.calls[1][1]).toBe(7);
  });

  it('after the opening voucher is approved the start date is read only', () => {
    const field = renderForm(savedBank({ openingDate: '2026-04-05', openingVoucherIssued: true, openingDateLocked: true, initialBalance: 3_000_000 }), vi.fn());
    expect(field.disabled).toBe(true);
    expect(field.value).toBe('2026-04-05');
  });

  it('while the opening voucher is a draft the start date still moves', () => {
    const field = renderForm(savedBank({ openingDate: '2026-04-05', openingVoucherIssued: true, openingDateLocked: false, initialBalance: 3_000_000 }), vi.fn());
    expect(field.disabled).toBe(false);
  });
});
