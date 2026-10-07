import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InteractiveJalaliCalendar } from '../../components/dashboard/InteractiveJalaliCalendar';
import { getTodayJalaliDate } from '../../utils';

afterEach(cleanup);

// v9.0.282 (TD-681، B16-17): روز هفته آغاز ماه برای ماه‌های دور هم درست است (۰ = شنبه)
const EXPECTED: Array<[number, number, number]> = [[1406, 9, 2], [1406, 10, 4], [1406, 11, 6], [1406, 12, 1], [1407, 1, 2]];

function leadingBlankCells(): number {
  const grids = document.querySelectorAll('.grid.grid-cols-7');
  const days = grids[grids.length - 1];
  let blanks = 0;
  for (const cell of Array.from(days.children)) {
    if (cell.tagName === 'BUTTON' || (cell.textContent ?? '').trim() !== '') break;
    blanks++;
  }
  return blanks;
}

describe('dashboard calendar weekday of far months (TD-681)', () => {
  it('starts Azar 1406 to Farvardin 1407 on their real weekdays', () => {
    render(<InteractiveJalaliCalendar />);
    const [ty, tm] = getTodayJalaliDate().split('/').map(Number);
    let index = ty * 12 + tm;
    for (const [jy, jm, weekday] of EXPECTED) {
      for (; index < jy * 12 + jm; index++) fireEvent.click(screen.getByTitle('ماه بعد'));
      for (; index > jy * 12 + jm; index--) fireEvent.click(screen.getByTitle('ماه قبل'));
      expect(`${jy}/${jm}: ${leadingBlankCells()}`).toBe(`${jy}/${jm}: ${weekday}`);
    }
  });
});
