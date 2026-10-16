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
