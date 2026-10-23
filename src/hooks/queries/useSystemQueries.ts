import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { ConditionalConstraintEntry } from '../../lib/system/conditionalConstraints';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/** 10.3 (ARCH review finding 3, part 13): the system reads of the settings page, read again on each opening of their tab */
export const SYSTEM_KEY = ['system'] as const;
export const SYSTEM_ENV_KEY = [...SYSTEM_KEY, 'env'] as const;
export const CONDITIONAL_CONSTRAINTS_KEY = [...SYSTEM_KEY, 'conditional-constraints'] as const;

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
