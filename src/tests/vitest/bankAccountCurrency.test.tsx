import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ fetchJson: vi.fn(async () => ({ code: 'BANK-09' })) }));

import { BankAccountModal } from '../../components/accounting/treasury/BankAccountModal';
import { TREASURY_CURRENCIES, normalizeTreasuryCurrency } from '../../lib/treasury/treasuryCurrency';

afterEach(cleanup);

// v9.0.90 (TD-508، B04-12، تصمیم ت۵ الف): فرم حساب بانکی ارز را از فهرست AGENTS §6 می‌گیرد و می‌فرستد؛ پیش‌تر کلیدهای ذخیره
// فرم `currency` نداشتند و حساب ارزی فقط از API ساخته می‌شد.
describe('bank account form currency (TD-508)', () => {
  it('offers the supported currencies and sends the chosen one', async () => {
    const onSave = vi.fn(async (..._args: unknown[]) => undefined);
    const { container } = render(
      <BankAccountModal isOpen onClose={() => undefined} editingBank={null} accounts={[]} appCurrency="IRR" onSave={onSave} />
    );
    const currencySelect = await waitFor(() => {
      const select = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option[value="USD"]'));
      if (!select) throw new Error('currency select not shown');
      return select as HTMLSelectElement;
    });
    expect(Array.from(currencySelect.options).map(o => o.value)).toEqual([...TREASURY_CURRENCIES]);
    expect(currencySelect.value).toBe('IRR');
    fireEvent.change(currencySelect, { target: { value: 'USD' } });
    fireEvent.change(screen.getByPlaceholderText('مثال: حساب جاری ملت - کارگاه'), { target: { value: 'حساب دلاری' } });
    fireEvent.submit(currencySelect.closest('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as { currency: string }).currency).toBe('USD');
  });

  it('normalizes the currency code', () => {
    expect(normalizeTreasuryCurrency(' usd ')).toBe('USD');
    expect(normalizeTreasuryCurrency('')).toBe('IRR');
    expect(normalizeTreasuryCurrency('ریال')).toBe('IRR');
  });
});
