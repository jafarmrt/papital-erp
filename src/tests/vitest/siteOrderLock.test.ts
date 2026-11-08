import { describe, expect, it } from 'vitest';
import { SITE_ORDER_OPEN_STATUSES } from '../../services/documents/siteOrderLock';
import { OPEN_ORDER_STATUSES } from '../../lib/storefront/storefrontOrderRules';

describe('open site order guard of the documents package (v12 phase 7)', () => {
  it('guards exactly the storefront open statuses, so a new open status cannot slip past the guard', () => {
    expect([...SITE_ORDER_OPEN_STATUSES].sort()).toEqual([...OPEN_ORDER_STATUSES].sort());
  });
});
