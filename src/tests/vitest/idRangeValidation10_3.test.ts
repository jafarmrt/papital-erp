// @vitest-environment node
/**
 * 10.3 (package 2 part 17): ids read with `numericIdString` or `createParamsIdSchema` are PostgreSQL integers. An id above
 * that range passed the check and the query failed in the database (a 500); it is now refused with a 400 and its reason.
 */
import { describe, expect, it } from 'vitest';
import { createParamsIdSchema, numericIdString, PG_INT_MAX } from '../../middleware/validate';

const itemParams = createParamsIdSchema('id', 'item id');
const messagesOf = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) => r.error?.issues.map(i => i.message) ?? [];

describe('ids stay inside the PostgreSQL integer range (10.3)', () => {
  it('the largest integer id passes', () => {
    expect(numericIdString.safeParse(String(PG_INT_MAX)).success).toBe(true);
    expect(itemParams.safeParse({ params: { id: String(PG_INT_MAX) } }).success).toBe(true);
  });

  it('an id one above the range, or with more digits, is refused once', () => {
    for (const id of [String(PG_INT_MAX + 1), '99999999999', '10000000000000000000000']) {
      const r = numericIdString.safeParse(id);
      expect(r.success).toBe(false);
      expect(messagesOf(r)).toHaveLength(1);
      expect(itemParams.safeParse({ params: { id } }).success).toBe(false);
    }
  });

  it('a malformed id says only that it is not a positive integer', () => {
    for (const id of ['abc', '0', '-3', '1.5']) {
      const r = numericIdString.safeParse(id);
      expect(r.success).toBe(false);
      expect(messagesOf(r)).toHaveLength(1);
    }
  });
});
