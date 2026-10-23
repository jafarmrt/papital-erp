import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';
import { EVENT_LIST_PAGE_SIZE } from './useEventQueries';

/**
 * 10.3 (ARCH review finding 3, part 14): the event admin tools of the settings page (dead letters, webhooks and the event
 * timeline) read through the shared cache under `events`, again on each opening of their tab; a dead letter write
 * refreshes everything under `events` (a replay publishes again) and a webhook write everything under webhooks. A read
 * the server refuses (`success: false`) is an error carrying the server's own message (v9.0.439, TD-730).
 */
export const DLQ_KEY = [...QUERY_KEYS.events.all, 'dlq'] as const;
export const WEBHOOKS_KEY = [...QUERY_KEYS.events.all, 'webhooks'] as const;
export const EVENT_SOURCING_KEY = [...QUERY_KEYS.events.all, 'event-sourcing'] as const;

export interface DeadLetterItem {
  id: number;
  originalEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  source: string;
  payload: unknown;
  metadata: unknown;
  failureReason: string;
  errorStack?: string;
  retryCount: number;
  status: 'quarantined' | 'replayed' | 'dismissed';
  quarantinedAt: string;
  resolvedAt?: string;
  resolvedBy?: number;
  resolutionNotes?: string;
}

export interface DlqStats {
  total: number;
  quarantined: number;
  replayed: number;
  dismissed: number;
  byEventType: Record<string, number>;
  bySource: Record<string, number>;
}

export interface WebhookSubscription {
  id: number;
  name: string;
  targetUrl: string;
  secretKey: string;
  eventPatterns: string[];
  customHeaders?: Record<string, string>;
  isActive: number;
  retryLimit: number;
  timeoutMs: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: string;
  lastStatus?: string;
  lastError?: string;
  createdAt: string;
}

export interface WebhookDeliveryLog {
  id: number;
  subscriptionId: number;
  subscriptionName: string;
  eventId: string;
  eventType: string;
  targetUrl: string;
  statusCode: number;
  status: 'success' | 'failed' | 'timeout';
  responseBody?: string;
  errorMessage?: string;
  signature: string;
  attempt: number;
  durationMs: number;
  createdAt: string;
}

export interface WebhookStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRate: number;
}

export interface AggregateTypeOption {
  type: string;
  title: string;
  description: string;
  icon: string;
}

export interface TimelineItem {
  id: string | number;
  eventId: string;
  eventType: string;
  occurredAt: string;
  source: 'outbox' | 'dlq' | 'audit_log' | 'workflow';
  actor: string;
  title: string;
  description: string;
  status: string;
  payload: unknown;
  metadata: unknown;
  changes?: unknown;
}

type Answer<T> = { success?: boolean; message?: string } & T;

/** the answer of a `{ success, … }` route, or its refusal as an error with the server's message */
async function successful<T>(url: string, signal: AbortSignal, refused: string): Promise<Answer<T>> {
  const data = await fetchJson<Answer<T> | null>(url, { signal });
  if (!data?.success) throw new Error(data?.message || refused);
  return data;
}
const listOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

/** The dead letter filters; `search` is the text last submitted, not the one being typed */
export interface DlqFilter { status: string; source: string; search: string; page: number }
export interface DlqPage { rows: DeadLetterItem[]; total: number }

export function useDlqStatsQuery() {
  return useQuery({
    queryKey: [...DLQ_KEY, 'stats'],
    queryFn: async ({ signal }) => (await successful<{ stats?: DlqStats }>('/events/dlq/stats', signal, 'آمار صف خطا خوانده نشد.')).stats ?? null,
    ...READ_ON_EVERY_OPENING,
  });
}

/** OBS-R2-86 (TD-1323): one page of the dead letters, filtered and searched on the server */
export function useDlqPageQuery(filter: DlqFilter) {
  return useQuery({
    queryKey: [...DLQ_KEY, 'page', filter],
    queryFn: async ({ signal }): Promise<DlqPage> => {
      const params = new URLSearchParams();
      if (filter.status !== 'all') params.append('status', filter.status);
      if (filter.source !== 'all') params.append('source', filter.source);
      if (filter.search) params.append('search', filter.search);
      params.append('page', String(filter.page));
      params.append('limit', String(EVENT_LIST_PAGE_SIZE));
      const data = await successful<{ data?: unknown; total?: number }>(`/events/dlq?${params.toString()}`, signal, 'فهرست صف خطا بارگذاری نشد.');
      const rows = listOf<DeadLetterItem>(data.data);
      return { rows, total: Number(data.total ?? rows.length) };
    },
    ...READ_ON_EVERY_OPENING,
  });
}

export function useWebhookStatsQuery() {
  return useQuery({
    queryKey: [...WEBHOOKS_KEY, 'stats'],
    queryFn: async ({ signal }) => (await successful<{ stats?: WebhookStats }>('/events/webhooks/stats', signal, 'آمار وب‌هوک‌ها خوانده نشد.')).stats ?? null,
    ...READ_ON_EVERY_OPENING,
  });
}

export function useWebhookSubscriptionsQuery() {
  return useQuery({
    queryKey: [...WEBHOOKS_KEY, 'subscriptions'],
    queryFn: async ({ signal }) => listOf<WebhookSubscription>((await successful<{ data?: unknown }>('/events/webhooks', signal, 'فهرست وب‌هوک‌ها بارگذاری نشد.')).data),
    ...READ_ON_EVERY_OPENING,
  });
}

/** the last 30 deliveries, of one webhook or of all */
export function useWebhookDeliveriesQuery(subscriptionId: number | null) {
  return useQuery({
    queryKey: [...WEBHOOKS_KEY, 'deliveries', subscriptionId ?? 'all'],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (subscriptionId) params.append('subscriptionId', String(subscriptionId));
      return listOf<WebhookDeliveryLog>((await successful<{ data?: unknown }>(`/events/webhooks/deliveries/list?${params.toString()}`, signal, 'گزارش تحویل وب‌هوک‌ها خوانده نشد.')).data);
    },
    ...READ_ON_EVERY_OPENING,
  });
}

export function useAggregateTypesQuery() {
  return useQuery({
    queryKey: [...EVENT_SOURCING_KEY, 'types'],
    queryFn: async ({ signal }) => listOf<AggregateTypeOption>((await successful<{ types?: unknown }>('/events/event-sourcing/types', signal, 'نوع موجودیت‌ها خوانده نشد.')).types),
    ...READ_ON_EVERY_OPENING,
  });
}

/**
 * v9.0.440 (TD-731): the records of a type matching the settled keyword; each keyword is its own read, so a late answer
 * for an older keyword never lands in the list of the newer one, and a read no longer wanted is cancelled
 */
export function useAggregateSearchQuery(type: string, keyword: string) {
  return useQuery({
    queryKey: [...EVENT_SOURCING_KEY, 'aggregates', type, keyword],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ type, aggregateType: type, search: keyword, limit: '25' });
      return listOf<{ id: string; title: string }>((await successful<{ data?: unknown }>(`/events/event-sourcing/aggregates?${params.toString()}`, signal, 'جست‌وجوی موجودیت انجام نشد.')).data);
    },
    enabled: type !== '',
    ...READ_ON_EVERY_OPENING,
  });
}

/** v9.0.431 (TD-711): audit rows come only to holders of the audit log permission; `auditIncluded` says whether they were read */
export function useAggregateTimelineQuery(type: string, aggregateId: string) {
  return useQuery({
    queryKey: [...EVENT_SOURCING_KEY, 'timeline', type, aggregateId],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ type, aggregateType: type, id: aggregateId, aggregateId });
      const data = await successful<{ timeline?: unknown; auditIncluded?: boolean }>(`/events/event-sourcing/timeline?${params.toString()}`, signal, 'خطا در بارگذاری خط زمان رویدادها');
      return { timeline: listOf<TimelineItem>(data.timeline), auditIncluded: data.auditIncluded !== false };
    },
    enabled: type !== '' && aggregateId !== '',
    ...READ_ON_EVERY_OPENING,
  });
}
