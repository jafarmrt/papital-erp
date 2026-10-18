import { describe, expect, it } from 'vitest';
import { MAX_PAGE_LIMIT, parsePagination } from '../../lib/pagination';

// TD-1320: a list whose service caps its rows pages with that cap; a cap that is not a whole number above zero keeps the general cap
describe('pagination_cap_td_1320', () => {
  it('a service cap below the asked limit pages with that cap', () => {
    expect(parsePagination({ page: '2', limit: '5000' }, { maxLimit: 200 })).toEqual({ page: 2, limit: 200, offset: 200 });
  });

  it('a cap of zero, below zero or not a number keeps the general cap and never a zero or NaN limit', () => {
    for (const maxLimit of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parsed = parsePagination({ page: '2', limit: '5000' }, { maxLimit });
      expect(parsed).toEqual({ page: 2, limit: MAX_PAGE_LIMIT, offset: MAX_PAGE_LIMIT });
    }
    expect(parsePagination({ page: '3' }, { maxLimit: 0 })).toEqual({ page: 3, limit: 50, offset: 100 });
  });

  it('a fractional cap reads whole rows', () => {
    expect(parsePagination({ limit: '5000' }, { maxLimit: 99.7 }).limit).toBe(99);
  });
});
