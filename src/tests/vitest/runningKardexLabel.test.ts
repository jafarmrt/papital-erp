import { describe, expect, it } from 'vitest';
import { normalizeRunningKardex, runningKardexEntryLabel } from '../../lib/transactions/runningKardex';

/**
 * v8.0.7 (TD-266، تصمیم مالک محصول): کاردکس تفصیلی سند ابطال‌شده را با برچسب نشان می‌دهد — ردیف اصلی «باطل‌شده» و
 * ردیف معکوس «معکوس ابطال»؛ گردش عادی برچسب ندارد و نرمال‌سازی پاسخ پرچم‌ها را نگه می‌دارد.
 */
describe('runningKardexEntryLabel (TD-266)', () => {
  it('labels the voided original and its reversal, not ordinary rows', () => {
    expect(runningKardexEntryLabel({ isVoided: true })).toBe('باطل‌شده');
    expect(runningKardexEntryLabel({ isReversal: true })).toBe('معکوس ابطال');
    expect(runningKardexEntryLabel({})).toBe('');
  });

  it('keeps the void flags through response normalization', () => {
    const data = normalizeRunningKardex({
      item: null,
      summary: null,
      entries: [
        { date: '2025-12-02', type: 'out', quantity: 3, unitPrice: 100000, isVoided: true },
        { date: '2026-01-01', type: 'in', quantity: 3, unitPrice: 100000, isReversal: true, reversalOfId: 7 },
      ],
    });
    expect(data.entries.map(runningKardexEntryLabel)).toEqual(['باطل‌شده', 'معکوس ابطال']);
  });
});
