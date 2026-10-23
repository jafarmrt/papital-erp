import { vi } from 'vitest';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { appQueryClient } from './queryWrapper';

/**
 * 10.3 (ARCH review finding 3, part 15): the server the invoice print and approval inbox tests talk to (`fetchJson`,
 * mocked over `../../api` by each test file). One read can be held (`reads.hold`, by path) or refused once (`reads.fail`).
 */
export type Opts = { method?: string; signal?: AbortSignal };

const initial = () => ({
  publicSettings: { companyName: 'workshop', companyLogo: '', currency: 'IRR', settings: [] as unknown[] } as Record<string, unknown>,
  settings: [{ key: 'company_phone', value: '02112345678' }] as Array<{ key: string; value: string }>,
  signatures: [{ name: 'fresh signer', roleTitle: 'manager', date: '2026-10-06' }],
  document: { id: 21, refNumber: 'F-21', buyer_name: 'buyer', currency: 'IRR', items: [] } as Record<string, unknown>,
  lineStock: [{ itemId: 3, warehouse: 'main', sellable: 4 }] as unknown[],
  requisition: { id: 31, code: 'PR-31', status: 'pending' } as Record<string, unknown>,
});
export const server = initial();
export const reads = { hold: null as string | null, fail: null as string | null, held: [] as Array<(answer: unknown) => void> };

export function resetServer() {
  Object.assign(server, initial());
  Object.assign(reads, { hold: null, fail: null, held: [] });
}

export const fetchJson = vi.fn(async (url: string, _opts?: Opts): Promise<unknown> => {
  const path = url.split('?')[0] ?? '';
  if (reads.hold === path) { reads.hold = null; return new Promise(resolve => { reads.held.push(resolve); }); }
  if (reads.fail === path) { reads.fail = null; throw new Error('server refused the read'); }
  if (path === '/public-settings') return server.publicSettings;
  if (path === '/settings') return server.settings;
  if (path === '/accounting/doc-signatures') return { signatures: server.signatures };
  if (path === '/documents/21') return server.document;
  if (path === '/documents/21/line-stock') return { data: server.lineStock };
  if (path === '/api/procurement/requisitions/31') return { data: server.requisition };
  if (path === '/api/procurement/requisitions/32') return { data: { id: 32, code: 'PR-32', status: 'pending' } };
  return null;
});
export const toastError = vi.fn();

/** a client with the app's read defaults: what an earlier opening cached stays fresh unless the screen reads again */
export const newClient = appQueryClient;
export const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
/** the time an earlier opening read its data, well inside the app's five fresh minutes */
export const earlier = () => ({ updatedAt: Date.now() - 60_000 });
export const readsOf = (path: string) => fetchJson.mock.calls.filter(([u]) => u.split('?')[0] === path).length;
