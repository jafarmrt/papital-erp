import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChartOfAccountsTab } from '../../components/accounting/ChartOfAccountsTab';
import { ACCOUNT_CODE_FORMAT_MESSAGE, isValidAccountCode, normalizeAccountCode } from '../../lib/accounting/accountCode';

const { toastFn } = vi.hoisted(() => ({ toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn }));

// v9.0.201 (TD-558, B03-16): an account code is Latin digits only; the form turns Persian digits into Latin, refuses other
// characters before sending, and keeps the code read-only on edit (the server ignored a new code and said «ویرایش شد»).

beforeEach(() => { toastFn.success.mockReset(); toastFn.error.mockReset(); });
afterEach(() => cleanup());

const accounts = [
  { id: 11, code: '11', name: 'موجودی نقد', level: 'general', parentId: null, accountType: 'asset', nature: 'debit', isSystem: 1, isActive: 1, children: [] },
  { id: 1190, code: '1190', name: 'صندوق آزمایشی', level: 'subsidiary', parentId: 11, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, children: [] },
];

const renderTab = () => {
  const onCreateAccount = vi.fn().mockResolvedValue(undefined);
  const onUpdateAccount = vi.fn().mockResolvedValue(undefined);
  render(<ChartOfAccountsTab accounts={accounts as never} treeAccounts={[]} loading={false} onRefresh={() => {}}
    onCreateAccount={onCreateAccount} onUpdateAccount={onUpdateAccount} onDeleteAccount={vi.fn()} onSeedStandardAccounts={vi.fn()} />);
  return { onCreateAccount, onUpdateAccount };
};
const codeInput = () => screen.getByLabelText('کد حساب') as HTMLInputElement;
const fillNew = (code: string) => {
  fireEvent.click(screen.getByText('تعریف حساب جدید'));
  fireEvent.change(codeInput(), { target: { value: code } });
  fireEvent.change(screen.getByPlaceholderText('مثال: صندوق مرکزی کارگاه'), { target: { value: 'صندوق دوم' } });
};

describe('account code rule (TD-558)', () => {
  it('normalizes Persian and Arabic digits and accepts digits only', () => {
    expect(normalizeAccountCode(' ۱۱۰۵ ')).toBe('1105');
    expect(normalizeAccountCode('١١٠٥')).toBe('1105');
    expect(isValidAccountCode('1105')).toBe(true);
    expect(isValidAccountCode('11-05')).toBe(false);
    expect(isValidAccountCode('')).toBe(false);
  });

  it('a new account typed with Persian digits is sent with Latin digits', async () => {
    const { onCreateAccount } = renderTab();
    fillNew('۱۱۰۵');
    expect(codeInput().value).toBe('1105');
    fireEvent.click(screen.getByText('ایجاد حساب'));
    await waitFor(() => expect(onCreateAccount).toHaveBeenCalledTimes(1));
    expect(onCreateAccount.mock.calls[0][0].code).toBe('1105');
  });

  it('a code with other characters is refused before sending', () => {
    const { onCreateAccount } = renderTab();
    fillNew('11A5');
    fireEvent.click(screen.getByText('ایجاد حساب'));
    expect(onCreateAccount).not.toHaveBeenCalled();
    expect(toastFn.error).toHaveBeenCalledWith(ACCOUNT_CODE_FORMAT_MESSAGE);
  });

  it('the code is read-only when an account is edited', () => {
    renderTab();
    fireEvent.click(screen.getByText('نمای جدولی'));
    const row = screen.getByText('1190').closest('tr') as HTMLElement;
    fireEvent.click(row.querySelector('button[title="ویرایش"]') as HTMLElement);
    expect(codeInput().readOnly).toBe(true);
  });
});
