// @vitest-environment node
/**
 * v12 phase 7 (site review 1.4): the site's list of items is kept a few seconds for the public reads, so a burst of
 * searches makes one database read; it is kept per price list, forgotten by a publish or a settings save, and a read
 * that started before such a change never stores its older list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ON_SALE_KEEP_MS, forgetOnSale, keepOnSaleFor, keptOnSale } from '../../services/storefront/storefrontOnSaleCache';

describe('the kept list of items on the site', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    keepOnSaleFor(ON_SALE_KEEP_MS);
  });
  afterEach(() => {
    keepOnSaleFor(0);
    vi.useRealTimers();
  });

  it('answers many reads at once and within the window with one database read', async () => {
    const read = vi.fn(async () => [{ slug: 'a' }, { slug: 'b' }]);
    const [first, second] = await Promise.all([keptOnSale('retail', read), keptOnSale('retail', read)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    vi.advanceTimersByTime(ON_SALE_KEEP_MS - 1);
    await keptOnSale('retail', read);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await keptOnSale('retail', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the list per price list and gives a list callers cannot change', async () => {
    const read = vi.fn(async () => [{ slug: 'a' }]);
    const list = await keptOnSale('retail', read);
    await keptOnSale('other list', read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('reads again after a publish or a settings save, and a read started before it does not store its older list', async () => {
    let release: (value: Array<{ slug: string }>) => void = () => undefined;
    const slow = vi.fn(() => new Promise<Array<{ slug: string }>>((resolve) => { release = resolve; }));
    const before = keptOnSale<{ slug: string }>('retail', slow);
    forgetOnSale();
    release([{ slug: 'old' }]);
    expect((await before).map(i => i.slug)).toEqual(['old']);
    const fresh = vi.fn(async () => [{ slug: 'new' }]);
    expect((await keptOnSale<{ slug: string }>('retail', fresh)).map(i => i.slug)).toEqual(['new']);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing when the window is 0 (the test suites), and a failed read is not kept', async () => {
    keepOnSaleFor(0);
    const read = vi.fn(async () => [{ slug: 'a' }]);
    await keptOnSale('retail', read);
    await keptOnSale('retail', read);
    expect(read).toHaveBeenCalledTimes(2);
    keepOnSaleFor(ON_SALE_KEEP_MS);
    const failing = vi.fn(async (): Promise<Array<{ slug: string }>> => { throw new Error('database down'); });
    await expect(keptOnSale('retail', failing)).rejects.toThrow('database down');
    await expect(keptOnSale('retail', failing)).rejects.toThrow('database down');
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
