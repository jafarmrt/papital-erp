import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../lib/memoryCache';

// OBS-R1-10: a full cache evicts only when a new key comes in, and it evicts the oldest key even when that key is ''.
describe('memory_cache_eviction_obs_r1_10', () => {
  it('replacing an existing key in a full cache keeps every other key', () => {
    const cache = new MemoryCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    expect(cache.get('a')).toBe(3);
    expect(cache.get('b')).toBe(2);
  });

  it('evicts the oldest key when it is the empty string', () => {
    const cache = new MemoryCache<number>(60_000, 2);
    cache.set('', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('never grows beyond its limit', () => {
    const cache = new MemoryCache<number>(60_000, 2);
    cache.set('', 0);
    for (const key of ['a', 'b', 'c', 'd']) cache.set(key, 1);
    expect(['', 'a', 'b', 'c', 'd'].filter(k => cache.get(k) !== undefined)).toEqual(['c', 'd']);
  });
});
