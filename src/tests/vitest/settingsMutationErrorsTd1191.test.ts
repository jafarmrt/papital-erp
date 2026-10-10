import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mutationSucceeded } from '../../lib/settings/mutationSucceeded';

// v10.0.89 (TD-1191): a refused settings save shows its message once and never leaves the submit handler as an error
describe('mutationSucceeded (TD-1191)', () => {
  it('answers true for a saved mutation and false for a refused one, without rethrowing', async () => {
    await expect(mutationSucceeded(Promise.resolve({ ok: true }))).resolves.toBe(true);
    await expect(mutationSucceeded(Promise.reject(new Error('warehouse code taken')))).resolves.toBe(false);
  });

  it('is how every settings form action waits on its mutation', () => {
    const hook = readFileSync('src/hooks/useSettings.ts', 'utf8');
    expect(hook).not.toMatch(/await \w+\.mutateAsync\(/);
    expect(hook).toContain('mutationSucceeded(saveWarehouseMutation.mutateAsync(');
  });
});
