import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

/**
 * 10.3 (ARCH review finding 3, part 14): the server the event admin tab tests talk to (`fetchJson`, mocked over
 * `../../api` by each test file). Reads answer from `server` the way the routes do (`{ success, … }`); one read can be held
 * (`reads.hold`, by path) or refused once (`reads.fail`); every write succeeds.
 */
export type Opts = { method?: string; body?: string; signal?: AbortSignal };
type Row = Record<string, unknown>;

export const deadLetter = (id: number, failureReason: string) => ({
  id, originalEventId: `evt-${id}-abcdefghijklmnop`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: String(id),
  source: 'outbox', payload: {}, metadata: {}, failureReason, errorStack: '', retryCount: 1, status: 'quarantined', quarantinedAt: '2026-10-06 10:00:00',
});
export const webhook = (id: number, name: string) => ({
  id, name, targetUrl: `https://hook${id}.example.com`, secretKey: '********', eventPatterns: ['*'], customHeaders: {}, isActive: 1, retryLimit: 3,
  timeoutMs: 5000, totalDeliveries: 0, successfulDeliveries: 0, failedDeliveries: 0, createdAt: '2026-10-01T10:00:00Z',
});
export const delivery = (id: number, subscriptionName: string) => ({
  id, subscriptionId: 1, subscriptionName, eventId: `e-${id}`, eventType: 'InvoiceApproved', targetUrl: 'https://hook1.example.com', statusCode: 200,
  status: 'success', signature: 'sig', attempt: 1, durationMs: 12, createdAt: '2026-10-06T10:00:00Z',
});
export const timelineItem = (title: string) => ({
  id: title, eventId: `e-${title}`, eventType: 'InvoiceApproved', occurredAt: '2026-10-06T10:00:00Z', source: 'outbox', actor: 'a', title, description: '',
  status: 'ok', payload: {}, metadata: {},
});
export const aggregateType = (type: string, title: string) => ({ type, title, description: '', icon: '' });

const initial = () => ({
  dlqStats: { total: 1, quarantined: 1, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } as Row | null,
  dlq: [deadLetter(1, 'fresh reason')] as Row[],
  dlqTotal: 1,
  webhookStats: null as Row | null,
  webhooks: [webhook(1, 'fresh hook')] as Row[],
  deliveries: [] as Row[],
  types: [] as Row[],
  /** the records of every type, unless `aggregatesOf` names that type's own */
  aggregates: [{ id: '5', title: 'record five' }],
  aggregatesOf: {} as Record<string, Array<{ id: string; title: string }>>,
  /** the timeline of every record, unless `timelineOf` names that record's own */
  timeline: [timelineItem('fresh step')] as Row[],
  timelineOf: {} as Record<string, Row[]>,
});
export const server = initial();
export const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };

export function resetServer() {
  Object.assign(server, initial());
  Object.assign(reads, { hold: null, fail: null, held: [] });
}

function read(path: string, query: URLSearchParams): unknown {
  if (path === '/events/dlq/stats') return { success: true, stats: server.dlqStats };
  if (path === '/events/dlq') return { success: true, data: server.dlq, total: server.dlqTotal };
  if (path === '/events/webhooks/stats') return { success: true, stats: server.webhookStats };
  if (path === '/events/webhooks') return { success: true, data: server.webhooks };
  if (path === '/events/webhooks/deliveries/list') return { success: true, data: server.deliveries };
  if (path === '/events/event-sourcing/types') return { success: true, types: server.types };
  if (path === '/events/event-sourcing/aggregates') return { success: true, data: server.aggregatesOf[query.get('type') ?? ''] ?? server.aggregates };
  if (path === '/events/event-sourcing/timeline') return { success: true, timeline: server.timelineOf[query.get('id') ?? ''] ?? server.timeline, auditIncluded: true };
  return { success: true };
}

export const fetchJson = vi.fn(async (url: string, opts?: Opts): Promise<unknown> => {
  if (opts?.method) return { success: true, message: 'done', succeeded: 1, total: 1 };
  const [path = '', search = ''] = url.split('?');
  if (reads.hold === path) {
    reads.hold = null;
    return new Promise(resolve => { reads.held.push(resolve); });
  }
  if (reads.fail === path) {
    reads.fail = null;
    return { success: false, message: 'server refused the read' };
  }
  return read(path, new URLSearchParams(search));
});

export const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
export const renderIn = (client: QueryClient, ui: ReactNode) => render(createElement(QueryClientProvider, { client }, ui));
/** the time an earlier opening of a tab read its data */
export const earlier = () => ({ updatedAt: Date.now() - 60_000 });
export const keysOf = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
/** the query strings of the reads of a path, in order */
export const readsOf = (path: string) => fetchJson.mock.calls
  .filter(([u, o]) => u.split('?')[0] === path && !o?.method)
  .map(([u]) => new URLSearchParams(u.split('?')[1] ?? ''));
export const firstPage = { status: 'all', source: 'all', search: '', page: 1 };
