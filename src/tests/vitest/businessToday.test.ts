import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuditPayload } from '../../lib/inventoryAudit/auditSheet';
import { getTodayIsoDate } from '../../utils';

// v8.0.49 (TD-312): «امروز» مرورگر روز منطقه زمانی توافقی (تهران) است، نه روز UTC
describe('browser today in the business time zone', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('gives the Tehran day after midnight even while UTC is still on the previous day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T21:00:00Z')); // ۰۰:۳۰ تهران ۱ فروردین ۱۴۰۵
    expect(getTodayIsoDate()).toBe('2026-03-21');
    vi.setSystemTime(new Date('2026-03-20T20:00:00Z')); // ۲۳:۳۰ تهران ۲۹ اسفند ۱۴۰۴
    expect(getTodayIsoDate()).toBe('2026-03-20');
  });

  it('dates a stock count saved on Nowruz night in the new year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T21:00:00Z'));
    const payload = buildAuditPayload([], { location: 'main', notes: '', user: null });
    expect(payload.date).toBe('2026-03-21');
  });
});
