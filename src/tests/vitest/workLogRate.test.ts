import { describe, expect, it } from 'vitest';
import { refreshSuggestedRates, submittedRate, suggestedRate } from '../../lib/payroll/workLogRate';

// v8.0.87 (TD-386): فرم ثبت کارکرد نرخ اختصاصی پرسنل را پیشنهاد می‌دهد و فقط نرخ دستی را می‌فرستد
const tasks = [{ id: 1, defaultRate: 100_000 }, { id: 2, defaultRate: '50000' }];
const custom = { 1: 120_000 };

describe('piecework work-log rate (TD-386)', () => {
  it('suggests the personnel custom rate, else the task default rate', () => {
    expect(suggestedRate(1, tasks, custom)).toBe(120_000);
    expect(suggestedRate(2, tasks, custom)).toBe(50_000);
    expect(suggestedRate('', tasks, custom)).toBe(0);
    expect(suggestedRate(9, tasks, custom)).toBe(0);
  });

  it('sends a rate only when the user changed it, so the server picks the personnel rate', () => {
    expect(submittedRate({ taskId: 1, unitRate: 100_000 })).toBeUndefined();
    expect(submittedRate({ taskId: 1, unitRate: 100_000, rateEdited: false })).toBeUndefined();
    expect(submittedRate({ taskId: 1, unitRate: 130_000, rateEdited: true })).toBe(130_000);
  });

  it('refreshes untouched rows when the personnel rates load and keeps manual ones', () => {
    const rows = [
      { taskId: 1 as const, unitRate: 100_000 },
      { taskId: 2 as const, unitRate: 70_000, rateEdited: true },
      { taskId: '' as const, unitRate: 0 },
    ];
    expect(refreshSuggestedRates(rows, tasks, custom).map(r => r.unitRate)).toEqual([120_000, 70_000, 0]);
  });
});
