import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IranianPhoneInput } from '../../components/common/IranianPhoneInput';
import { NationalIdInput } from '../../components/common/NationalIdInput';
import { ShebaInput } from '../../components/common/ShebaInput';
import { BankCardInput } from '../../components/common/BankCardInput';
import { getIranianPhoneOperatorInfo } from '../../utils';

afterEach(cleanup);

const INVALID_PREFIX_TEXT = 'پیش‌شماره نامعتبر است';

describe('TD-1271 Iranian identity inputs follow the vibefarsi iran-validation and forms rules', () => {
  it('a full mobile number with a prefix missing from the operator table is valid; the operator is only a hint', () => {
    for (const phone of ['09341234567', '09001234567', '09311234567', '09991234567']) {
      expect(getIranianPhoneOperatorInfo(phone).isValid).toBe(true);
    }
    const unknown = getIranianPhoneOperatorInfo('09001234567');
    expect(unknown.operatorKey).toBe('unknown');
    expect(getIranianPhoneOperatorInfo('0900123456').isValid).toBe(false);
    expect(getIranianPhoneOperatorInfo('09121234567').operatorKey).toBe('mci');
  });

  it('the phone input does not mark a valid number with an unlisted prefix as an error', () => {
    render(<IranianPhoneInput value="09341234567" onChange={() => {}} />);
    expect(screen.queryByText(INVALID_PREFIX_TEXT)).toBeNull();
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
  });

  it('the phone input has no 11-character limit, so a pasted +98 or spaced number is not cut short', () => {
    const onChange = vi.fn();
    render(<IranianPhoneInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.maxLength).toBe(-1);
    expect(input.getAttribute('inputmode')).toBe('tel');
    fireEvent.change(input, { target: { value: '+98 912 345 6789' } });
    expect(onChange).toHaveBeenLastCalledWith('09123456789');
    fireEvent.change(input, { target: { value: '۰۹۱۲ ۳۴۵ ۶۷۸۹' } });
    expect(onChange).toHaveBeenLastCalledWith('09123456789');
  });

  it('an invalid phone, national ID, Sheba or card number is announced with aria-invalid', () => {
    const { unmount } = render(<IranianPhoneInput value="09121234" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
    unmount();
    render(<IranianPhoneInput value="91234567890" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    cleanup();

    render(<NationalIdInput value="1234567890" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    cleanup();
    render(<NationalIdInput value="0012345679" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
    cleanup();

    render(<ShebaInput value="IR000000000000000000000000" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    cleanup();
    render(<BankCardInput value="6037991234567890" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    cleanup();
    render(<BankCardInput value="603799123456" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
  });

  it('on an iPhone a form field computes to at least 16px, so Safari does not zoom the page on focus', () => {
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
    const block = css.match(/@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{([\s\S]*?)\n\}/);
    expect(block).not.toBeNull();
    expect(block?.[1]).toMatch(/input[\s\S]*textarea[\s\S]*select[\s\S]*font-size:\s*max\(1rem,\s*1em\)/);
  });
});
