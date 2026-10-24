import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { LIVE_EVENT_BUFFER_SIZE } from '../../lib/events/liveEventBuffer';
import { fetchJson } from '../../api';
import { repeatPollHeaders } from './repeatPollHeaders';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { StoredRuleActionType } from '../../lib/events/ruleActionTypes';
import type { ActionEngineStats, ActionLogPage, ActionLogRow } from '../../lib/events/actionLogContract';
import type { EventSimulationResult } from '../../lib/events/eventSimulationContract';

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
  actionType: StoredRuleActionType;
  actionConfigJson: any;
  isActive: number;
  executionCount: number;
  lastExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// v9.0.408 (TD-721): the server's own contract (src/lib/events/actionLogContract.ts)
export type ActionLog = ActionLogRow;
export type ActionStats = ActionEngineStats;

/** v9.0.441 (TD-733): the live events list refreshes this often; the tab's label reads the same constant. */
export const DOMAIN_EVENTS_REFRESH_MS = 10000;

// Live Domain Events Query
export function useDomainEventsQuery(filter: string = 'ALL', options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<{ events: DomainEvent[]; stats: DomainEventStats | null }>({
    queryKey: QUERY_KEYS.events.list(filter),
    queryFn: async (context) => {
      const res = await fetchJson<{ events?: DomainEvent[]; stats?: DomainEventStats }>(
        `/events/domain-events?limit=${LIVE_EVENT_BUFFER_SIZE}&filter=${encodeURIComponent(filter)}`,
        { signal: context.signal, headers: repeatPollHeaders(context) }
      );
      return {
        events: Array.isArray(res?.events) ? res.events : [],
        stats: res?.stats || null,
      };
    },
    // 10.3 package 6: each visit of the tab, and each filter picked again during it, reads at once (its screen shows only
    // this visit's answers, `useOpeningRead`, so an answer cached before the visit must never wait for the next poll)
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? DOMAIN_EVENTS_REFRESH_MS,
  });
}

// Outbox Stats Query
export function useOutboxStatsQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<OutboxStats | null>({
    queryKey: QUERY_KEYS.events.outboxStats(),
    queryFn: async (context) => {
      const res = await fetchJson<{ success?: boolean; stats?: OutboxStats }>('/events/outbox/stats', { signal: context.signal, headers: repeatPollHeaders(context) });
      return res?.stats || null;
    },
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

// Outbox Events List Query
/** OBS-R2-86 (TD-1323): one page of the outbox, filtered and searched on the server */
export const EVENT_LIST_PAGE_SIZE = 50;
export interface OutboxEventPage { events: OutboxEvent[]; total: number }
export function useOutboxEventsQuery(
  status: string = 'ALL',
  options?: { enabled?: boolean; refetchInterval?: number | false; page?: number; search?: string },
) {
  const page = options?.page ?? 1;
  const search = (options?.search ?? '').trim();
  return useQuery<OutboxEventPage>({
    queryKey: QUERY_KEYS.events.outbox(status, page, search),
    queryFn: async (context) => {
      const params = new URLSearchParams({ page: String(page), limit: String(EVENT_LIST_PAGE_SIZE), status });
      if (search) params.set('search', search);
      const res = await fetchJson<{ success?: boolean; events?: OutboxEvent[]; total?: number }>(`/events/outbox?${params.toString()}`, {
        signal: context.signal, headers: repeatPollHeaders(context),
      });
      const events = Array.isArray(res?.events) ? res.events : [];
      return { events, total: Number(res?.total ?? events.length) };
    },
    // the tab shows only answers of its current visit and filter, so an earlier page is never kept on screen as a placeholder,
    // and a filter, page or search picked again reads at once instead of waiting for the next poll (a search has none)
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: options?.enabled ?? true,
    // a search reads the whole table on the server, so it is not repeated every ten seconds
    refetchInterval: search ? false : (options?.refetchInterval ?? 10000),
  });
}

// Action Rules Query
export function useActionRulesQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<ActionRule[]>({
    queryKey: QUERY_KEYS.events.actionRules(),
    queryFn: async (context) => {
      const res = await fetchJson<{ success?: boolean; data?: ActionRule[] }>('/events/action-rules', { signal: context.signal, headers: repeatPollHeaders(context) });
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
    queryFn: async (context) => {
      const res = await fetchJson<{ success?: boolean; stats?: ActionStats }>('/events/action-rules/stats', { signal: context.signal, headers: repeatPollHeaders(context) });
      return res?.stats || null;
    },
    staleTime: 10000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 12000,
  });
}

// Action Logs Query
/** OBS-R2-86 (TD-1323): one page of the rule execution log */
export function useActionLogsQuery(page: number = 1, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<{ logs: ActionLog[]; total: number }>({
    queryKey: QUERY_KEYS.events.actionLogs(page),
    queryFn: async (context) => {
      // v9.0.408 (TD-721): the server sends { data, total }; the hook used to read `logs`, so the list was always empty
      const res = await fetchJson<Partial<ActionLogPage>>(`/events/action-logs?page=${page}&limit=${EVENT_LIST_PAGE_SIZE}`, {
        signal: context.signal, headers: repeatPollHeaders(context),
      });
      const logs = Array.isArray(res?.data) ? res.data : [];
      return { logs, total: Number(res?.total ?? logs.length) };
    },
    staleTime: 10000,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 12000,
  });
}

// Mutation: Simulate Domain Event
// v9.0.430 (TD-708, decision t5 a): the simulation has no effect (nothing is published, sent or written), so nothing is
// invalidated; the caller shows the rules and webhooks the event would have reached
export function useSimulateEventMutation() {
  return useMutation({
    mutationFn: async (body: { eventType: string; payload?: Record<string, unknown> }) => {
      return fetchJson<EventSimulationResult & { success?: boolean }>('/events/domain-events/simulate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
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
    // v9.0.441 (TD-733): the events tab announces the result once, in its own banner
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
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
    // v9.0.441 (TD-733): the events tab announces the result once, in its own banner
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
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
    // v9.0.441 (TD-733): the events tab announces the result once, in its own banner
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.events.all });
    },
  });
}
