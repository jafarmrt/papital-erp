import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../middleware/logger.js';

export class OptimisticLockError extends Error {
  public readonly entityType: string;
  public readonly entityId: string | number;
  public readonly expectedVersion: number;
  public readonly currentVersion?: number;

  constructor(
    optionsOrEntityType: {
      entityType: string;
      entityId: string | number;
      expectedVersion: number;
      currentVersion?: number;
      message?: string;
    } | string,
    entityId?: string | number,
    expectedVersion?: number,
    currentVersion?: number
  ) {
    let opts: {
      entityType: string;
      entityId: string | number;
      expectedVersion: number;
      currentVersion?: number;
      message?: string;
    };

    if (typeof optionsOrEntityType === 'string') {
      opts = {
        entityType: optionsOrEntityType,
        entityId: entityId ?? 'unknown',
        expectedVersion: expectedVersion ?? 1,
        currentVersion,
      };
    } else {
      opts = optionsOrEntityType;
    }

    const defaultMsg = `Optimistic concurrency conflict on ${opts.entityType} (ID: ${opts.entityId}): expected version ${opts.expectedVersion}, but found ${opts.currentVersion ?? 'different version'}.`;
    super(opts.message || defaultMsg);
    this.name = 'OptimisticLockError';
    this.entityType = opts.entityType;
    this.entityId = opts.entityId;
    this.expectedVersion = opts.expectedVersion;
    this.currentVersion = opts.currentVersion;
  }
}

export interface OccUpdateOptions {
  entityType: string;
  entityId: string | number;
  expectedVersion: number;
}

/**
 * Checks OCC version condition and throws OptimisticLockError if version mismatch occurs.
 */
export function checkOccVersion(
  currentRecord: { version?: number | null } | null | undefined,
  options: OccUpdateOptions
): void {
  if (!currentRecord) {
    throw new OptimisticLockError({
      ...options,
      message: `${options.entityType} (ID: ${options.entityId}) not found during OCC check.`
    });
  }

  const currentVer = currentRecord.version ?? 1;
  if (currentVer !== options.expectedVersion) {
    logger.warn(`[OCC] Version mismatch on ${options.entityType} #${options.entityId}: expected v${options.expectedVersion}, actual v${currentVer}`);
    throw new OptimisticLockError({
      ...options,
      currentVersion: currentVer
    });
  }
}

/**
 * Calculates next version number for an update payload
 */
export function nextVersion(currentVersion: number = 1): number {
  return Number(currentVersion) + 1;
}

/**
 * Executes a function with automatic retry on OptimisticLockError.
 */
export async function withOccRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const maxDelayMs = options.maxDelayMs ?? 500;

  let attempt = 1;
  const totalAttempts = maxRetries + 1;
  while (attempt <= totalAttempts) {
    try {
      return await operation(attempt);
    } catch (err: unknown) {
      const errObj = (err && typeof err === 'object') ? (err as Record<string, unknown>) : null;
      const isOcc = err instanceof OptimisticLockError || errObj?.name === 'OptimisticLockError';
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (isOcc) {
        if (attempt >= totalAttempts) {
          logger.error(`[OCC Retry] Exceeded max retries (${maxRetries}) for OCC operation: ${errorMsg}`);
          throw err;
        }

        const jitter = Math.random() * 0.5 + 0.75; // 0.75 - 1.25
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, maxDelayMs);
        logger.info(`[OCC Retry] Retrying operation attempt ${attempt}/${maxRetries} after ${Math.round(delay)}ms due to: ${errorMsg}`);
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }

  throw new Error('Unreachable OCC retry loop exit');
}
