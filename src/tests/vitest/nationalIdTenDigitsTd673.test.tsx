import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { NationalIdInput } from '../../components/common/NationalIdInput';
import { normalizeNationalId, validateIranianNationalId } from '../../utils';
import { readImportedNationalId } from '../../lib/personnel/nationalIdCell';
import { requirePersonnelNationalId } from '../../services/personnel/personnelNationalId';

afterEach(cleanup);

describe('TD-673 a national ID is exactly ten digits and is never zero-padded by a form', () => {
  it('a short ID is refused, not padded into a valid one', () => {
    expect(validateIranianNationalId('19')).toEqual({ isValid: false, error: 'کد ملی باید ۱۰ رقم باشد' });
    expect(validateIranianNationalId('1236').isValid).toBe(false);
    expect(normalizeNationalId('19')).toBe('19');
    expect(validateIranianNationalId('0012345679').isValid).toBe(true);
    expect(validateIranianNationalId('۰۰۱-۲۳۴۵۶۷-۹').isValid).toBe(true);
  });

  it('no ID of one to five digits is valid', () => {
    let valid = 0;
    for (let n = 1; n <= 99999; n++) if (validateIranianNationalId(String(n)).isValid) valid++;
    expect(valid).toBe(0);
  });

  it('the input keeps a short ID as typed on blur', () => {
    function Field() { const [v, setV] = useState(''); return <NationalIdInput value={v} onChange={setV} />; }
    render(<Field />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '19' } });
    fireEvent.blur(input);
    expect(input.value).toBe('19');
    expect(screen.queryByText('کد ملی معتبر')).toBeNull();
  });

  it('the server refuses a short ID on save, but keeps an unchanged legacy one', () => {
    expect(() => requirePersonnelNationalId('19')).toThrow('کد ملی باید ۱۰ رقم باشد');
    expect(requirePersonnelNationalId('0012345679')).toBe('0012345679');
    expect(requirePersonnelNationalId('')).toBe('');
    expect(requirePersonnelNationalId('19', '19')).toBe('19');
  });

  it('only the Excel import pads eight or nine digits and says so; other lengths are row errors', () => {
    expect(readImportedNationalId(12345679)).toEqual({ value: '0012345679', padded: true });
    expect(readImportedNationalId('0012345679')).toEqual({ value: '0012345679', padded: false });
    expect(readImportedNationalId('19').error).toBe('کد ملی باید ۱۰ رقم باشد');
    expect(readImportedNationalId('')).toEqual({ value: '', padded: false });
  });
});
