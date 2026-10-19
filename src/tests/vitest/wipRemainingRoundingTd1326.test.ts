import { describe, expect, it } from 'vitest';
import { wipLeftOver, wipOverdrawn } from '../../lib/projects/deliveryCostSuggestion';

// TD-1326 (backlog of PR #319): the «ورود به انبار» tab rounds the project's work-in-progress balance to the rial the
// way the voucher does, half away from zero. `Math.round(-0.5)` is -0, so a delivery crediting exactly half a rial more
// than the balance was not warned about, while the voucher rounded it to one rial below zero.
describe('wip_remaining_rounding_td_1326', () => {
  it('half a rial below zero is an overdraw', () => {
    expect(wipOverdrawn({ remaining: -0.5 })).toBe(true);
    expect(wipOverdrawn({ remaining: -0.4999 })).toBe(false);
    expect(wipOverdrawn({ remaining: -0.0001 })).toBe(false);
    expect(wipOverdrawn({ remaining: 0 })).toBe(false);
  });

  it('half a rial above zero is left over', () => {
    expect(wipLeftOver({ remaining: 0.5 })).toBe(true);
    expect(wipLeftOver({ remaining: 0.4999 })).toBe(false);
    expect(wipLeftOver({ remaining: -0.5 })).toBe(false);
  });
});
