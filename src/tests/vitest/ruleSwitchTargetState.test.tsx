/**
 * v9.0.418 (TD-729, B15-27 / FE-10): a rule's switch sends the state it shows the user will get (`{ active }`) and waits
 * for its answer, and so does the rule test button. On v9.0.417 the switch sent an empty two-way toggle and neither button
 * waited, so a double click flipped the rule twice and ran the test twice.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { AutoActionsSubTab } from '../../components/settings/AutoActionsSubTab';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const rule = {
  id: 3, name: 'اعلان فاکتور', description: '', eventType: 'InvoiceApproved', conditionsJson: [], actionType: 'audit_log',
  actionConfigJson: {}, isActive: 1, executionCount: 0, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z',
};

function serve() {
  const writes: Array<{ url: string; body: unknown }> = [];
  const answers: Array<(value: unknown) => void> = [];
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((opts?.method || 'GET') === 'POST') {
      writes.push({ url, body: opts?.body ? JSON.parse(String(opts.body)) : undefined });
      return new Promise(resolve => { answers.push(resolve); });
    }
    if (url.startsWith('/events/action-rules/stats')) return { success: true, stats: null };
    if (url.startsWith('/events/action-logs')) return { success: true, data: [], total: 0 };
    return { success: true, data: [rule] };
  });
  return { writes, answerAll: (value: unknown) => answers.splice(0).forEach(a => a(value)) };
}

const withQuery = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
};

describe('TD-729 the rule switch sends a target state and waits', () => {
  it('a double click on the switch of an active rule sends one request with active false', async () => {
    const server = serve();
    render(withQuery(<AutoActionsSubTab />));
    const toggle = (await screen.findByTitle('غیرفعال‌سازی')) as HTMLButtonElement;
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0]).toEqual({ url: '/events/action-rules/3/toggle', body: { active: false } });
    expect(toggle.disabled).toBe(true);
    await act(async () => { server.answerAll({ success: true, changed: true, message: 'غیرفعال شد' }); });
    expect(server.writes).toHaveLength(1);
  });

  it('a double click on the test button runs one test', async () => {
    const server = serve();
    render(withQuery(<AutoActionsSubTab />));
    const test = (await screen.findByText('آزمایش')).closest('button') as HTMLButtonElement;
    fireEvent.click(test);
    fireEvent.click(test);
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0].url).toBe('/events/action-rules/3/test');
    expect(test.disabled).toBe(true);
    await act(async () => { server.answerAll({ success: true, conditionMatches: false, message: 'شرط برقرار نیست' }); });
  });
});
