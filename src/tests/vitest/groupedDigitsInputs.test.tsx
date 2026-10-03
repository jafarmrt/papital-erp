import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BankCardInput } from '../../components/common/BankCardInput';
import { ShebaInput } from '../../components/common/ShebaInput';

afterEach(cleanup);

// v7.0.140: رفتار دو ورودی کارت و شبا پس از یکی‌کردن کد مشترک (تکرار کد) باید همان بماند
describe('BankCardInput', () => {
  it('groups 16 digits, shows the bank and marks a valid card', () => {
    const { container } = render(<BankCardInput value="6037991234567893" onChange={() => {}} label="شماره کارت" required />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('6037 - 9912 - 3456 - 7893');
    expect(screen.getByText('بانک ملی ایران')).toBeTruthy();
    expect(screen.getByTitle('شماره کارت معتبر است')).toBeTruthy();
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('flags an invalid complete card', () => {
    const { container } = render(<BankCardInput value="6037991234567890" onChange={() => {}} />);
    expect(container.querySelector('[title="شماره کارت معتبر است"]')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBeTruthy();
  });

  it('returns raw latin digits (max 16) on change and deletes the digit before a separator on backspace', () => {
    const onChange = vi.fn();
    const { container } = render(<BankCardInput value="60379912" onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '۶۰۳۷ - ۹۹۱۲ - 345678931234' } });
    expect(onChange).toHaveBeenLastCalledWith('6037991234567893');
    input.setSelectionRange(7, 7); // «6037 - |9912»
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('6039912');
  });
});

describe('ShebaInput', () => {
  it('groups the 24 digits after the fixed IR prefix, shows the bank and marks a valid Sheba', () => {
    const { container } = render(<ShebaInput value="IR820540102680020817909002" onChange={() => {}} label="شبا" />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('82 0540 1026 8002 0817 9090 02');
    expect(screen.getByText('IR')).toBeTruthy();
    expect(screen.getByText('بانک پارسیان')).toBeTruthy();
    expect(screen.getByTitle('شماره شبا معتبر است (تایید ISO 7064)')).toBeTruthy();
  });

  it('returns IR + digits on change (pasted IR stripped) and handles backspace over a space', () => {
    const onChange = vi.fn();
    const { container } = render(<ShebaInput value="IR8205" onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ir 82 0540 1026' } });
    expect(onChange).toHaveBeenLastCalledWith('IR8205401026');
    input.setSelectionRange(3, 3); // «82 |05»
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('IR805');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
