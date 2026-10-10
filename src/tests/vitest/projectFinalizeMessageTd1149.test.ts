import { describe, expect, it } from 'vitest';
import { finalizeReservationOutcome } from '../../lib/projects/reservationOutcome';

const shortage = { itemId: 1, itemCode: 'A', itemName: 'مهره', unit: 'عدد', requiredQty: 5, reservedQty: 0, shortQty: 5, stock: 0, reservedByOthers: 0 };

describe('v10.0.90 (TD-1149): the finalize message says what was really reserved', () => {
  it('nothing matched a warehouse item: no reservation is claimed', () => {
    const outcome = finalizeReservationOutcome([], []);
    expect(outcome.kind).toBe('warning');
    expect(outcome.message).not.toContain('رزرو شدند');
    expect(outcome.message).toContain('هیچ قلمی رزرو نشد');
  });

  it('only shortages: nothing reserved, the purchase list is named', () => {
    const outcome = finalizeReservationOutcome([], [shortage]);
    expect(outcome.kind).toBe('warning');
    expect(outcome.message).toContain('هیچ قلمی رزرو نشد');
    expect(outcome.message).toContain('فهرست خرید');
  });

  it('reserved rows: the count is in Persian digits', () => {
    const outcome = finalizeReservationOutcome([{ itemId: 1 }, { itemId: 2 }], []);
    expect(outcome.kind).toBe('success');
    expect(outcome.message).toContain('۲ قلم');
    expect(outcome.message).toContain('رزرو شد');
  });
});
