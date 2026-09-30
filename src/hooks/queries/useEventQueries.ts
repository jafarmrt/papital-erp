import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { toast } from 'react-hot-toast';
import { QUERY_KEYS } from '../../lib/queryKeys';

export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
  metadata: {
    userId?: number;
    userName?: string;
    correlationId?: string;
    timestamp: string;
  };
  occurredAt: string;
}

export interface DomainEventStats {
  totalEmitted: number;
  eventCounts: Record<string, number>;
  recentCount: number;
}

export interface OutboxEvent {
  id: number;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: any;
  metadata: any;
  retryCount: number;
  nextRetryAt?: string;
  lastError?: string;
  occurredAt: string;
  processedAt?: string;
}

export interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  workerRunning: boolean;
}

export interface ActionRule {
  id: number;
  name: string;
  description: string;
  eventType: string;
  conditionsJson: any[];
  actionType: 'webhook' | 'in_app_notification' | 'workflow_trigger' | 'sms_simulation' | 'audit_log';
  actionConfigJson: any;
  isActive: number;
  executionCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActionLog {
  id: number;
  ruleId: number;
  eventId: string;
  eventType: string;
  actionType: string;
  status: 'success' | 'failed' | 'condition_unmatched' | 'skipped';
  requestPayloadJson: any;
  responsePayloadJson: any;
  errorMessage?: string;
  durationMs: number;
  executedAt: string;
}

export interface ActionStats {
  totalRules: number;
  activeRules: number;
  totalLogs: number;
  successLogs: number;
  failedLogs: number;
  unmatchedLogs: number;
  successRate: number;
  avgDurationMs: number;
}

// Live Domain Events Query
export function useDomainEventsQuery(filter: string = 'ALL', options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<{ events: DomainEvent[]; stats: DomainEventStats | null }>({
    queryKey: QUERY_KEYS.events.list(filter),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ events?: DomainEvent[]; stats?: DomainEventStats }>(
        `/events/domain-events?limit=100&filter=${encodeURIComponent(filter)}`,
        { signal }
      );
      return {
        events: Array.isArray(res?.events) ? res.events : [],
        stats: res?.stats || null,
      };
    },
    staleTime: 5000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

// Outbox Stats Query
export function useOutboxStatsQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<OutboxStats | null>({
    queryKey: QUERY_KEYS.events.outboxStats(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ success?: boolean; stats?: OutboxStats }>('/events/outbox/stats', { signal });
      return res?.stats || null;
    },
    staleTime: 5000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

// Outbox Events List Query
export function useOutboxEventsQuery(status: string = 'ALL', options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<OutboxEvent[]>({
    queryKey: QUERY_KEYS.events.outbox(status),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ success?: boolean; events?: OutboxEvent[] }>(
        `/events/outbox?limit=100&status=${encodeURIComponent(status)}`,
        { signal }
      );
      return Array.isArray(res?.events) ? res.events : [];
    },
    staleTime: 5000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

// Action Rules Query
export function useActionRulesQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<ActionRule[]>({
    queryKey: QUERY_KEYS.events.actionRules(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ success?: boolean; data?: ActionRule[] }>('/events/action-rules', { signal });
      return Array.isArray(res?.data) ? res.data : [];
    },
    staleTime: 10000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 12000,
  });
}

// Action Rules Stats Query
export function useActionStatsQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<ActionStats | null>({
    queryKey: QUERY_KEYS.events.actionStats(),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ success?: boolean; stats?: ActionStats }>('/events/action-rules/stats', { signal });
      return res?.stats || null;
    },
    staleTime: 10000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 12000,
  });
}

// Action Logs Query
export function useActionLogsQuery(limit: number = 50, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<ActionLog[]>({
    queryKey: QUERY_KEYS.events.actionLogs(limit),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ success?: boolean; logs?: ActionLog[] }>(`/events/action-logs?limit=${limit}`, { signal });
      return Array.isArray(res?.logs) ? res.logs : [];
    },
    staleTime: 10000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 12000,
  });
}

// Mutation: Simulate Domain Event
export function useSimulateEventMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { eventType: string; aggregateType: string; aggregateId: string; payload: any }) => {
      return fetchJson<{ success?: boolean; message?: string }>('/events/domain-events/simulate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
      toast.success('رویداد شبیه‌سازی‌شده با موفقیت منتشر و در Outbox ذخیره شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در شبیه‌سازی انتشار رویداد');
    },
  });
}

// Mutation: Process Outbox Now
export function useProcessOutboxMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return fetchJson<{ success?: boolean; message?: string }>('/events/outbox/process-now', {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
      toast.success(res?.message || 'صف رویدادها با موفقیت پردازش شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در پردازش دستی صف Outbox');
    },
  });
}

// Mutation: Retry Failed Outbox Events
export function useRetryFailedOutboxMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return fetchJson<{ success?: boolean; message?: string }>('/events/outbox/retry-failed', {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
      toast.success(res?.message || 'رویدادهای ناموفق برای تلاش مجدد نشانه‌گذاری شدند');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در بازنشانی تلاش مجدد رویدادهای ناموفق');
    },
  });
}

// Mutation: Retry Single Outbox Event
export function useRetrySingleOutboxEventMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      return fetchJson<{ success?: boolean; message?: string }>(`/events/outbox/${encodeURIComponent(eventId)}/retry`, {
        method: 'POST',
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
      toast.success(res?.message || 'رویداد برای تلاش مجدد زمان‌بندی شد');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'خطا در تلاش مجدد رویداد');
    },
  });
}
