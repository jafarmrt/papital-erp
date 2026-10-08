/**
 * v9.0.430 (TD-708, B15-06 / FE-09, decision t5 a): the rule test, the event simulation and the timeline replay have no
 * effect. On v9.0.429 the timeline offered «بازپخش زنده رویداد» (dryRun false, no confirmation, repeatable), the events tab
 * published a made-up «SimulatedTestEvent» to the live handlers, and the rule test reported the real action's status.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchJson } from '../../api';
import { EventSourcingReplaySubTab } from '../../components/settings/EventSourcingReplaySubTab';
import { EventSimulationPanel } from '../../components/settings/EventSimulationPanel';
import { AutoActionsSubTab } from '../../components/settings/AutoActionsSubTab';

// v9.0.435 (TD-722): the change buttons show only for holders of events.manage
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const withQuery = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
};
const posts = () => vi.mocked(fetchJson).mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === 'POST');

const LIVE_REPLAY = 'بازپخش زنده رویداد';
const DRY_REPLAY = 'شبیه‌سازی بی‌اثر';
const OPEN_REPLAY = 'شبیه‌سازی و بازپخش رویداد';
const SIMULATION_MESSAGE = 'شبیه‌سازی «صدور قطعی فاکتور فروش» بی‌اثر انجام شد';
const AUDIT_PREVIEW = 'متن ممیزی: فاکتور FAKE-1 به مبلغ ۹۸۷';
const WEBHOOK_LINE = /اشتراک «شریک بیرونی» آن را به/;
const RULE_TEST_MESSAGE = 'قانون «اعلان فاکتور» معتبر است و شرط‌هایش برقرار است. اقدام اجرا نشد.';
const RULE_TEST_PREVIEW = 'شمار گیرندگان اعلان: ۲';
const TEST_BUTTON = 'آزمایش';

describe('TD-708 the timeline replay is only a simulation', () => {
  it('offers no live replay and sends dryRun true', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
      if ((opts?.method || 'GET') === 'POST') return { success: true, dryRun: true, message: 'ok', evaluatedRulesCount: 0, matchedRulesCount: 0, rulesBreakdown: [] };
      if (url.startsWith('/events/event-sourcing/types')) return { success: true, types: [{ type: 'document', title: 'document', description: '', icon: '' }] };
      if (url.startsWith('/events/event-sourcing/aggregates')) return { success: true, data: [{ id: '42', title: '42' }] };
      return { success: true, timeline: [{ id: 'o1', eventId: 'evt-1', eventType: 'InvoiceApproved', occurredAt: '2026-10-06 10:00:00', source: 'outbox', actor: 'admin', title: 'x', description: '', status: 'completed', payload: { documentId: 42 }, metadata: {} }] };
    });
    render(<EventSourcingReplaySubTab />);
    fireEvent.click(await screen.findByTitle(OPEN_REPLAY));
    expect(screen.queryByText(LIVE_REPLAY)).toBeNull();
    fireEvent.click(screen.getByText(DRY_REPLAY));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body)).dryRun).toBe(true);
  });
});

describe('TD-708 the events tab simulates a published event type with no effect', () => {
  it('posts the chosen published type and shows the matching rule and webhook', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      success: true, simulated: true, message: `${SIMULATION_MESSAGE}: ...`,
      event: { eventId: 'simulated_1', eventType: 'InvoiceApproved', aggregateType: 'document', aggregateId: '1', payload: {} },
      rules: [
        { ruleId: 1, ruleName: 'audit rule', actionType: 'audit_log', matched: true, preview: { actionType: 'audit_log', description: 'فاکتور FAKE-1 به مبلغ ۹۸۷' }, problem: null },
        { ruleId: 2, ruleName: 'skipped rule', actionType: 'webhook', matched: false, preview: null, problem: null },
      ],
      webhooks: [{ subscriptionId: 5, name: 'شریک بیرونی', targetUrl: 'https://partner.example.com/hooks' }],
    });
    render(withQuery(<EventSimulationPanel />));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).not.toContain('SimulatedTestEvent');
    fireEvent.change(select, { target: { value: 'InvoiceApproved' } });
    fireEvent.click(screen.getByText(DRY_REPLAY));
    await screen.findByText(new RegExp(SIMULATION_MESSAGE));
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe('/events/domain-events/simulate');
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({ eventType: 'InvoiceApproved' });
    expect(screen.getByText('audit rule')).toBeTruthy();
    expect(screen.queryByText('skipped rule')).toBeNull();
    expect(screen.getByText(AUDIT_PREVIEW)).toBeTruthy();
    expect(screen.getByText(WEBHOOK_LINE)).toBeTruthy();
  });
});

describe('TD-708 the rule test shows what the action would do', () => {
  it('shows the server message and the preview, never a run status', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
      if ((opts?.method || 'GET') === 'POST') return { success: true, executed: false, conditionMatches: true, message: RULE_TEST_MESSAGE, preview: { actionType: 'in_app_notification', recipientCount: 2 } };
      if (url.startsWith('/events/action-rules/stats')) return { success: true, stats: null };
      if (url.startsWith('/events/action-logs')) return { success: true, data: [], total: 0 };
      return { success: true, data: [{ id: 3, name: 'rule', description: '', eventType: 'InvoiceApproved', conditionsJson: [], actionType: 'in_app_notification', actionConfigJson: {}, isActive: 1, executionCount: 0, createdAt: '', updatedAt: '' }] };
    });
    render(withQuery(<AutoActionsSubTab />));
    fireEvent.click(await screen.findByText(TEST_BUTTON));
    await screen.findByText(new RegExp(RULE_TEST_PREVIEW));
    expect(screen.getByText(new RegExp(RULE_TEST_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(posts().map(([url]) => url)).toEqual(['/events/action-rules/3/test']);
  });
});
