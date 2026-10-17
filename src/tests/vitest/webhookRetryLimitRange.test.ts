import { describe, expect, it } from 'vitest';
import { createWebhookSchema, updateWebhookSchema } from '../../routes/events.schemas';

// review of #295: the route took a retry limit from 0 to 20 while the form and the delivery use 1 to 10, so a stored 0 was
// delivered as 3 and 15 as 10
const fields = (retryLimit: unknown) => ({ name: 'hook', targetUrl: 'https://example.ir/hook', eventPatterns: ['*'], retryLimit });
const create = (retryLimit: unknown) => createWebhookSchema.safeParse({ body: fields(retryLimit) }).success;
const update = (retryLimit: unknown) => updateWebhookSchema.safeParse({ params: { id: '1' }, body: { retryLimit } }).success;

describe('webhook_retry_limit_range_v10_1_66', () => {
  it('refuses a retry limit outside 1 to 10 on create and edit', () => {
    for (const value of [0, 11, 20]) {
      expect(create(value)).toBe(false);
      expect(update(value)).toBe(false);
    }
  });

  it('keeps 1 to 10 and a missing value', () => {
    for (const value of [1, 3, 10]) expect(create(value) && update(value)).toBe(true);
    expect(create(undefined)).toBe(true);
  });
});
