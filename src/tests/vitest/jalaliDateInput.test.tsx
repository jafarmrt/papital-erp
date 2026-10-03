import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { JalaliDateInput } from '../../components/common/JalaliDateInput';
import { toEnglishDigits } from '../../utils';

afterEach(cleanup);

// v7.0.136 (TD-232): ورودی تاریخ شمسی برای فرم‌هایی که ISO نگه می‌دارند (جایگزین input type="date" میلادی)
describe('JalaliDateInput', () => {
  it('shows a stored ISO date as a Jalali date', () => {
    const { container } = render(<JalaliDateInput value="2026-10-02" onChange={() => {}} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(toEnglishDigits(input.value)).toBe('1405/07/10');
  });

  it('shows a Jalali value as is and an empty value as empty', () => {
    const { container, rerender } = render(<JalaliDateInput value="1405/7/1" onChange={() => {}} />);
    expect(toEnglishDigits((container.querySelector('input') as HTMLInputElement).value)).toBe('1405/07/01');
    rerender(<JalaliDateInput value="" onChange={() => {}} />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
  });
});
