import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartOfAccountsTab } from '../../components/accounting/ChartOfAccountsTab';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t, toast: t };
});

// v9.0.200 (TD-553, B03-11, decision t4 option a): a system account takes only a new name and description, so its edit
// form locks the parent, type and nature; an ordinary account keeps them editable.

afterEach(() => cleanup());

const account = (id: number, code: string, name: string, level: string, parentId: number | null, isSystem: number) => ({
  id, code, name, level, parentId, accountType: 'revenue', nature: 'credit', isSystem, isActive: 1, balance: 0, children: [],
});
const accounts = [
  account(50, '50', 'درآمد عملیاتی', 'general', null, 1),
  account(5001, '5001', 'فروش کالا', 'subsidiary', 50, 1),
  account(5090, '5090', 'درآمد آزمایشی', 'subsidiary', 50, 0),
];

const openEdit = (code: string) => {
  const tab = render(<ChartOfAccountsTab accounts={accounts as never} treeAccounts={[]} loading={false} onRefresh={() => {}}
    onCreateAccount={vi.fn()} onUpdateAccount={vi.fn()} onDeleteAccount={vi.fn()} onSeedStandardAccounts={vi.fn()} />);
  fireEvent.click(screen.getByText('نمای جدولی'));
  const row = screen.getByText(code).closest('tr') as HTMLElement;
  fireEvent.click(row.querySelector('button[title="ویرایش"]') as HTMLElement);
  return tab;
};
const field = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe('account edit form (TD-553)', () => {
  it('a system account locks parent, type and nature and says why', () => {
    openEdit('5001');
    expect(field('حساب بالادست').disabled).toBe(true);
    expect(field('نوع حساب').disabled).toBe(true);
    expect(field('ماهیت حساب').disabled).toBe(true);
    expect(screen.getByText('این حساب سیستمی است؛ فقط عنوان و توضیحات آن ویرایش می‌شود.')).toBeTruthy();
  });

  it('an ordinary account keeps parent, type and nature editable', () => {
    openEdit('5090');
    expect(field('حساب بالادست').disabled).toBe(false);
    expect(field('نوع حساب').disabled).toBe(false);
    expect(field('ماهیت حساب').disabled).toBe(false);
    expect(screen.queryByText('این حساب سیستمی است؛ فقط عنوان و توضیحات آن ویرایش می‌شود.')).toBeNull();
  });
});
