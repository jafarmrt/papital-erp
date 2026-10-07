import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountSearchSelect } from '../../components/accounting/AccountSearchSelect';

// v9.0.173 (TD-571, B03-29): the account picker matches Persian and Arabic digits; «۱۱۰۱» typed on a Persian keyboard found nothing.

const accounts = [
  { id: 1101, code: '1101', name: 'صندوق', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 1201, code: '۱۲۰۱', name: 'دریافتنی تجاری', level: 'subsidiary', accountType: 'asset', nature: 'debit' },
  { id: 5001, code: '5001', name: 'فروش کالا ۲', level: 'subsidiary', accountType: 'revenue', nature: 'credit' },
];

afterEach(() => cleanup());

function search(text: string) {
  render(<AccountSearchSelect accounts={accounts as never} value="" onChange={() => {}} />);
  const input = screen.getByPlaceholderText('انتخاب یا جستجوی کد/عنوان حساب...');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
}

describe('account picker digits (TD-571)', () => {
  it.each([['۱۱۰۱'], ['١١٠١'], ['1101']])('«%s» finds «صندوق»', (text) => {
    search(text);
    expect(screen.getByText('صندوق')).toBeTruthy();
    expect(screen.queryByText('حسابی با این کد یا عنوان یافت نشد')).toBeNull();
  });

  it('a code or name stored with Persian digits is found by Latin digits', () => {
    search('1201');
    expect(screen.getByText('دریافتنی تجاری')).toBeTruthy();
    cleanup();
    search('کالا 2');
    expect(screen.getByText('فروش کالا ۲')).toBeTruthy();
  });
});
