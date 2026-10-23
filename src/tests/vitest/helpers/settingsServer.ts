import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { getTodayJalaliDate } from '../../../utils';
import { toLatinDigits } from '../../../lib/numericInput';

/**
 * 10.3 (ARCH review finding 3, part 13): the server the settings screen tests talk to (`fetchJson`, mocked over
 * `../../api` by each test file). Reads answer from `server`; one read can be held (`reads.holdNext`) or failed once
 * (`reads.failNext`). Writes answer as the real routes do: a rates save stores its year's row with the next version and
 * answers with it, refusing a stale version (OCC); a mappings save stores what was sent.
 */
export type FetchOpts = { method?: string; body?: string; signal?: AbortSignal };
type YearRow = { jalaliYear: number; version: number } & Record<string, unknown>;

export const thisYear = Number(toLatinDigits(getTodayJalaliDate()).slice(0, 4));
export const ratesRow = (jalaliYear: number, employee: string, version = 1): YearRow => ({
  jalaliYear, employeeInsurancePercent: employee, employerInsurancePercent: '23', insuranceWageCap: '0',
  taxBrackets: [{ from: '0', to: null, rate: '10' }], deductInsuranceFromTax: false, version,
});
export const eidiRow = (jalaliYear: number, percent: string, version = 1): YearRow => ({
  jalaliYear, method: 'percent_of_work', percent, yearlyCap: '5000000', laborDays: '0', laborCapDays: '0', minDailyWage: '0', fixedAmount: '0', version,
});

const initial = () => ({
  rates: [] as YearRow[],
  eidi: [] as YearRow[],
  tasks: [{ id: 1, code: 'T1', title: 'cutting', category: 'wood', defaultRate: 10, unit: 'piece' }] as Array<Record<string, unknown>>,
  categories: [{ id: 1, name: 'wood' }] as Array<Record<string, unknown>>,
  mappings: { raw_materials: '1401', disabled: [] as string[], accountsCount: 3 } as Record<string, unknown>,
  env: { db: 'set', nodeEnv: 'production', nodeVersion: 'v24', flags: { JWT_SECRET: 'set' } } as unknown,
  constraints: [] as unknown[],
  orderLogs: [] as unknown[],
});
export const server = initial();
export const reads = { holdNext: null as string | null, failNext: null as string | null, held: [] as Array<(answer: unknown) => void> };

export function resetServer() {
  Object.assign(server, initial());
  reads.holdNext = null;
  reads.failNext = null;
  reads.held.length = 0;
}

/** PUT /piecework/{statutory,eidi}-rates/:year: the saved row with its next version, or a conflict on a stale version */
function saveYear(rows: YearRow[], url: string, body: string | undefined): { rows: YearRow[]; row: YearRow } {
  const jalaliYear = Number(url.split('/').pop());
  const sent = JSON.parse(body ?? '{}') as Record<string, unknown> & { version?: number };
  const before = rows.find(r => r.jalaliYear === jalaliYear);
  if (before && sent.version !== before.version) throw new Error('conflict');
  const row = { ...sent, jalaliYear, version: (before?.version ?? 0) + 1 };
  return { rows: [...rows.filter(r => r.jalaliYear !== jalaliYear), row], row };
}

async function write(url: string, opts: FetchOpts): Promise<unknown> {
  const body = JSON.parse(opts.body ?? '{}') as Record<string, unknown>;
  if (opts.method === 'PUT' && url.startsWith('/piecework/statutory-rates/')) {
    const saved = saveYear(server.rates, url, opts.body);
    server.rates = saved.rows;
    return saved.row;
  }
  if (opts.method === 'PUT' && url.startsWith('/piecework/eidi-rates/')) {
    const saved = saveYear(server.eidi, url, opts.body);
    server.eidi = saved.rows;
    return saved.row;
  }
  if (url === '/accounting/mappings') {
    const { disabled, ...codes } = body;
    server.mappings = { ...server.mappings, ...codes, disabled };
    return { message: 'saved', data: codes, disabled };
  }
  if (url === '/accounting/accounts/seed-default') {
    server.mappings = { ...server.mappings, accountsCount: 5 };
    return { message: 'seeded' };
  }
  if (url === '/system/conditional-constraints/build') {
    if (body.apply) server.constraints = [];
    return { applied: !!body.apply, missing: [], built: ['fk_ready'], blocked: [], failed: [], message: 'built' };
  }
  return { success: true };
}

function read(url: string): unknown {
  if (url === '/piecework/statutory-rates') return { data: server.rates };
  if (url === '/piecework/eidi-rates') return { data: server.eidi };
  if (url.startsWith('/piecework/tasks')) return server.tasks;
  if (url === '/piecework/categories') return server.categories;
  if (url === '/accounting/mappings') return server.mappings;
  if (url === '/system/env') return server.env;
  if (url === '/system/conditional-constraints') return { missing: server.constraints };
  if (url === '/woocommerce/order-logs') return server.orderLogs;
  return [];
}

export const fetchJson = vi.fn(async (url: string, opts?: FetchOpts): Promise<unknown> => {
  if (opts?.method) return write(url, opts);
  if (reads.holdNext === url) {
    reads.holdNext = null;
    return new Promise(resolve => { reads.held.push(resolve); });
  }
  if (reads.failNext === url) {
    reads.failNext = null;
    throw new Error('read failed');
  }
  return read(url);
});

export const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
export const wrapperOf = (client: QueryClient) => ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
export const invalidate = (client: QueryClient, queryKey: readonly unknown[]) => act(async () => { await client.invalidateQueries({ queryKey }); });
export const keysOf = (spy: { mock: { calls: Array<[{ queryKey?: unknown }?, ...unknown[]]> } }) => spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
/** the time an earlier opening of a screen read its data */
export const earlier = () => ({ updatedAt: Date.now() - 60_000 });
export const writesTo = (url: string, method: string) => fetchJson.mock.calls.filter(([u, o]) => u === url && o?.method === method);
export const sentBody = (url: string, method: string, index: number) => JSON.parse(String(writesTo(url, method)[index]?.[1]?.body)) as Record<string, unknown>;
/** let the answers of the reads already started land */
export const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
