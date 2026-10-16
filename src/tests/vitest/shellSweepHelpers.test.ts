/**
 * Closing sweep, app shell (part 3): the date helpers and the page limit (OBS-R2-100) and the chunk reload guard
 * (OBS-R2-92). Each date and limit test is red on v10.1.53.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFutureJalaliDate, getTodayIsoDate, getTodayJalaliDate, normalizeDateToDbTimestamp, setDisplayTimezone,
} from '../../utils/dateUtils';
import { parsePagination } from '../../lib/pagination';
import { CHUNK_RELOAD_GUARD_MS, CHUNK_RELOAD_STORAGE_KEY, claimChunkReload, isChunkLoadError } from '../../lib/system/chunkReload';

afterEach(() => {
  vi.useRealTimers();
  setDisplayTimezone('Asia/Tehran');
  try { window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY); } catch { /* storage unavailable */ }
});

describe('OBS-R2-100 date helpers and the page limit', () => {
  it('obs_r2_100_today_without_fixed_fallback: an unusable display zone gives today in the default zone, never a fixed date', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T08:00:00Z'));
    setDisplayTimezone('Mars/Olympus');
    expect(getTodayJalaliDate()).toBe('1405/07/24');
    expect(getTodayIsoDate()).toBe('2026-10-16');
  });

  it('obs_r2_100_day_shift_ignores_daylight_saving: adding days moves calendar days, not 24-hour blocks', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:30 on 7 March in New York; the clocks move forward on 8 March
    vi.setSystemTime(new Date('2026-03-08T04:30:00Z'));
    setDisplayTimezone('America/New_York');
    expect(getTodayJalaliDate()).toBe('1404/12/16');
    expect(getFutureJalaliDate(1)).toBe('1404/12/17');
    expect(getFutureJalaliDate(2)).toBe('1404/12/18');
  });

  it('obs_r2_100_empty_date_is_empty: an empty or unreadable date is no date, not the UTC now', () => {
    expect(normalizeDateToDbTimestamp('')).toBe('');
    expect(normalizeDateToDbTimestamp(null)).toBe('');
    expect(normalizeDateToDbTimestamp('not a date')).toBe('');
    expect(normalizeDateToDbTimestamp('2026-10-16')).toBe('2026-10-16 00:00:00');
  });

  it('obs_r2_100_limit_zero_is_default_page: limit 0 or below is the default page, never an unlimited read', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(50);
    expect(parsePagination({ limit: '-5' }).limit).toBe(50);
    expect(parsePagination({ limit: '0' }, { limit: 20 }).limit).toBe(20);
    expect(parsePagination({ limit: '30' }).limit).toBe(30);
  });
});

describe('OBS-R2-92 the automatic reload for a new version', () => {
  it('obs_r2_92_chunk_reload_guard: only chunk load errors count, and one reload runs per guard window', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(new Error('Invalid hook call.'))).toBe(false);

    const start = 1_800_000_000_000;
    expect(claimChunkReload(start)).toBe(true);
    expect(claimChunkReload(start + 1000)).toBe(false);
    expect(claimChunkReload(start + CHUNK_RELOAD_GUARD_MS + 1)).toBe(true);
  });
});
