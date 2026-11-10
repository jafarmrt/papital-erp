// v12 phase 7 (site review 1.4): the per-visitor search limit of the site app, on its own (the page-level check is in
// account.test.ts, which runs with STOREFRONT_TRUST_PROXY=1)
import { beforeEach, describe, expect, it } from 'vitest';
import { SEARCHES_PER_MINUTE, allowSearch, resetVisitorLimits, searchRetryAfter } from '../app/lib/visitorLimit.server';

describe('allowSearch', () => {
  beforeEach(() => resetVisitorLimits());

  it('lets one visitor search SEARCHES_PER_MINUTE times a minute, then refuses until the minute is over', () => {
    const t = 1_000_000;
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) expect(allowSearch('203.0.113.7', t + i)).toBe(true);
    expect(allowSearch('203.0.113.7', t + 100)).toBe(false);
    expect(searchRetryAfter('203.0.113.7', t + 30_000)).toBe(30);
    expect(allowSearch('203.0.113.7', t + 60_000)).toBe(true);
  });

  it('counts each visitor apart, and never limits a visitor without an address (one shared counter would block everyone)', () => {
    for (let i = 0; i <= SEARCHES_PER_MINUTE; i++) allowSearch('203.0.113.8', 5_000);
    expect(allowSearch('203.0.113.8', 5_000)).toBe(false);
    expect(allowSearch('198.51.100.1', 5_000)).toBe(true);
    for (let i = 0; i < SEARCHES_PER_MINUTE * 3; i++) expect(allowSearch('', 5_000)).toBe(true);
  });
});
