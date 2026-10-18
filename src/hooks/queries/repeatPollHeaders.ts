import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { BACKGROUND_POLL_HEADERS } from '../../lib/social/presence';

/**
 * v10.2 package 9 (delta review nit 3): a page's own first read counts as the user's presence; only a repeat read of a
 * query that already holds data (its timed refetch) carries `X-ERP-Background`, so opening «کارتابل» or the event
 * monitor still marks the user «برخط است», while the page left open does not.
 */
export function repeatPollHeaders(context: { client: QueryClient; queryKey: QueryKey }): Record<string, string> | undefined {
  return context.client.getQueryState(context.queryKey)?.dataUpdatedAt ? BACKGROUND_POLL_HEADERS : undefined;
}
