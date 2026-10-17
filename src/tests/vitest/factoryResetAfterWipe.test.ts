import { afterEach, describe, expect, it, vi } from 'vitest';

// a failure after the committed wipe (the seed throwing instead of answering, the default engines, the file removal) was a
// plain error, so the route kept the session cookie of a user the wipe had deleted; it is now the committed-reset error
vi.mock('../../db/seed.js', () => ({ runSeed: vi.fn(async () => { throw new Error('seed connection lost'); }) }));
vi.mock('../../lib/advisoryLock.js', async (original) => ({
  ...(await original<typeof import('../../lib/advisoryLock.js')>()),
  withAdvisoryLock: async <T>(_key: number, fn: () => Promise<T>) => ({ acquired: true, result: await fn() }),
}));

const { FactoryResetService, isFactoryResetCommittedError } = await import('../../services/system/factoryReset.service');

type Internals = Record<'wipeAllData' | 'removeAttachmentFiles' | 'removeMediaFiles' | 'invalidateCaches', (...args: unknown[]) => unknown>;

describe('factory_reset_after_wipe_failure_v10_1_66', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('reports a seed that throws after the wipe as the committed-reset error', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_DANGEROUS_DATA_PURGE', 'true');
    const internals = FactoryResetService as unknown as Internals;
    vi.spyOn(internals, 'wipeAllData').mockResolvedValue({ deletedRows: { users: 1 }, attachmentPaths: [], mediaFiles: [] });
    vi.spyOn(internals, 'removeAttachmentFiles').mockResolvedValue({ removed: 0, missing: 0, failed: 0 });
    vi.spyOn(internals, 'removeMediaFiles').mockResolvedValue({ removed: 0, missing: 0, failed: 0 });
    vi.spyOn(internals, 'invalidateCaches').mockReturnValue(undefined);
    const outcome = await FactoryResetService.wipeAndReseed({ username: 'admin', ip: '127.0.0.1' }).then(() => null, (err: unknown) => err);
    expect(outcome).not.toBeNull();
    expect(isFactoryResetCommittedError(outcome)).toBe(true);
  });
});
