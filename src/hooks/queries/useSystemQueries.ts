import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { ConditionalConstraintEntry } from '../../lib/system/conditionalConstraints';
import type { AccountingHealth, OutboxHealth, WorkflowHealth } from '../../lib/system/subsystemHealth';
import type { StorageHealth } from '../../lib/system/storageHealth';
import type { MediaLibraryHealth } from '../../lib/system/mediaLibraryHealth';
import type { NightlyVerifyHealth } from '../../lib/system/nightlyVerify';
import type { DatabaseHealthView, ServerRuntimeView } from '../../components/system/CoreHealthCards';
import type { IntegrityReportView } from '../../components/system/IntegrityCheckPanel';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/** 10.3 (ARCH review finding 3, part 13): the system reads of the settings page, read again on each opening of their tab */
export const SYSTEM_KEY = ['system'] as const;
export const SYSTEM_ENV_KEY = [...SYSTEM_KEY, 'env'] as const;
export const CONDITIONAL_CONSTRAINTS_KEY = [...SYSTEM_KEY, 'conditional-constraints'] as const;
/** 10.3 (part 16): the health tab's two reads; a queue fix refreshes both (with the whole SYSTEM_KEY) */
export const SYSTEM_HEALTH_KEY = [...SYSTEM_KEY, 'health'] as const;
export const INTEGRITY_CHECK_KEY = [...SYSTEM_KEY, 'reconciliation-check'] as const;

/** V1.1.1: خروجی GET /system/env — فقط وضعیت set/not-set؛ هرگز مقدار secret ها */
export interface SystemEnvInfo {
  db: 'set' | 'not set';
  nodeEnv: string;
  nodeVersion: string;
  flags: Record<string, 'set' | 'not set'>;
}

export function useSystemEnvQuery() {
  return useQuery({
    queryKey: SYSTEM_ENV_KEY,
    queryFn: ({ signal }) => fetchJson<SystemEnvInfo>('/system/env', { signal }),
    ...READ_ON_EVERY_OPENING,
  });
}

export function useConditionalConstraintsQuery() {
  return useQuery({
    queryKey: CONDITIONAL_CONSTRAINTS_KEY,
    queryFn: ({ signal }) => fetchJson<{ missing: ConditionalConstraintEntry[] }>('/system/conditional-constraints', { signal }),
    ...READ_ON_EVERY_OPENING,
  });
}

/** GET /system/health: each part its own card on the health tab */
export interface HealthData {
  database: DatabaseHealthView;
  storage?: StorageHealth;
  outbox?: OutboxHealth;
  accounting?: AccountingHealth;
  workflow?: WorkflowHealth;
  mediaLibrary?: MediaLibraryHealth;
  nightlyVerify?: NightlyVerifyHealth;
  server: ServerRuntimeView;
  checkTimestamp: string;
}

export function useSystemHealthQuery() {
  return useQuery({
    queryKey: SYSTEM_HEALTH_KEY,
    queryFn: ({ signal }) => fetchJson<HealthData>('/system/health', { signal }),
    ...READ_ON_EVERY_OPENING,
  });
}

export function useIntegrityCheckQuery() {
  return useQuery({
    queryKey: INTEGRITY_CHECK_KEY,
    queryFn: ({ signal }) => fetchJson<IntegrityReportView>('/system/reconciliation-check', { signal }),
    ...READ_ON_EVERY_OPENING,
  });
}
