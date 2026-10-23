import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ownReads } from './helpers/ownReads';
import {
  deadLetter, earlier, fetchJson, firstPage, keysOf, newClient, reads, readsOf, renderIn, resetServer, server, timelineItem, webhook, type Opts,
} from './helpers/eventAdminServer';

/**
 * 10.3 (ARCH review finding 3, part 14): the dead letters, webhooks and event timeline tabs read through the shared cache,
 * again on each opening, never what an earlier opening left; a failed read shows the server's reason in place of the
 * list; every write refreshes what it changed; a selection holds only rows on screen and an emptied last page shows the
 * page before it.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  dlqLoading: /در حال بارگذاری صف خطا/,
  dlqEmpty: /هیچ رویدادی در صف قرنطینه وجود ندارد/,
  replay: 'بازپخش فوری رویداد',
  dismiss: 'صرف‌نظر و نادیده‌گرفتن',
  purge: 'پاکسازی ردیف‌های بازپخش‌شده یا صرف‌نظرشده',
  batch: /^بازپخش .* مورد$/,
  dlqRefresh: 'به‌روزرسانی جدول',
  dlqSearch: 'جست‌وجو در شناسه، نوع رویداد یا متن خطا…',
  webhookToggle: 'فعال',
  webhookDelete: 'حذف درگاه',
  deliveries: /^گزارش تحویل/,
  timelineLoading: /در حال بازخوانی خط زمان رویدادهای موجودیت/,
  pickPrompt: /لطفاً از کادر بالا یک موجودیت را انتخاب کنید/,
  pickNone: '-- یک نمونه را انتخاب کنید --',
} as const;

vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/eventAdminServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: Opts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => true }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import { DeadLetterQueueSubTab } from '../../components/settings/DeadLetterQueueSubTab';
import { WebhookManagementSubTab } from '../../components/settings/WebhookManagementSubTab';
import { EventSourcingReplaySubTab } from '../../components/settings/EventSourcingReplaySubTab';
import { DLQ_KEY, EVENT_SOURCING_KEY, WEBHOOKS_KEY } from '../../hooks/queries/useEventAdminQueries';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  resetServer();
});

describe('the dead letters tab reads through the shared cache (10.3)', () => {
  it('never shows the page an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData([...DLQ_KEY, 'page', firstPage], { rows: [deadLetter(1, 'stale reason')], total: 1 }, earlier());
    reads.hold = '/events/dlq';
    renderIn(client, <DeadLetterQueueSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale reason')).toBeNull();
    expect(screen.getByText(SHOWN.dlqLoading)).toBeTruthy();
    await act(async () => { reads.held[0]?.({ success: true, data: server.dlq, total: 1 }); });
    expect(await screen.findByText('fresh reason')).toBeTruthy();
  });

  it('a refused read shows the server reason instead of «nothing in the queue»', async () => {
    reads.fail = '/events/dlq';
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.dlqEmpty)).toBeNull();
  });

  it.each([
    ['a replay', () => fireEvent.click(screen.getByTitle(SHOWN.replay))],
    ['a dismissal', () => fireEvent.click(screen.getByTitle(SHOWN.dismiss))],
    ['a purge', () => fireEvent.click(screen.getByTitle(SHOWN.purge))],
    ['a batch replay', () => { fireEvent.click(document.querySelector('tbody button') as HTMLElement); fireEvent.click(screen.getByText(SHOWN.batch)); }],
  ])('%s refreshes every event screen and reads the list again', async (_name, act) => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderIn(client, <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    server.dlq = [deadLetter(2, 'after the write')];
    act();
    expect(await screen.findByText('after the write')).toBeTruthy();
    expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.events.all));
  });

  it('a selection holds only the rows on screen', async () => {
    const client = newClient();
    renderIn(client, <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    fireEvent.click(document.querySelector('tbody button') as HTMLElement);
    expect(screen.getByText(SHOWN.batch)).toBeTruthy();
    server.dlq = [deadLetter(2, 'another row')];
    await act(async () => { await client.invalidateQueries({ queryKey: DLQ_KEY }); });
    expect(await screen.findByText('another row')).toBeTruthy();
    expect(screen.queryByText(SHOWN.batch)).toBeNull();
  });

  it('a filter change clears the selection, even when the new list holds the same rows', async () => {
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    fireEvent.click(document.querySelector('tbody button') as HTMLElement);
    expect(screen.getByText(SHOWN.batch)).toBeTruthy();
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'quarantined' } });
    await waitFor(() => expect(readsOf('/events/dlq').some(q => q.get('status') === 'quarantined')).toBe(true));
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    expect(screen.queryByText(SHOWN.batch)).toBeNull();
  });

  it('a write that empties the last page shows the page before it', async () => {
    server.dlqTotal = 51;
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('صفحه بعد'));
    await waitFor(() => expect(readsOf('/events/dlq').some(q => q.get('page') === '2')).toBe(true));
    await waitFor(() => expect((screen.getByTitle(SHOWN.dlqRefresh) as HTMLButtonElement).disabled).toBe(false));
    server.dlq = [];
    server.dlqTotal = 50;
    fireEvent.click(screen.getByTitle(SHOWN.dlqRefresh));
    await waitFor(() => expect(readsOf('/events/dlq').filter(q => q.get('page') === '1').length).toBeGreaterThan(1));
  });

  it('submitting the same search again reads the list again', async () => {
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    const form = screen.getByPlaceholderText(SHOWN.dlqSearch).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(readsOf('/events/dlq')).toHaveLength(2));
  });
});

describe('the webhooks tab reads through the shared cache (10.3)', () => {
  it('never shows the webhooks an earlier opening left while it reads again', async () => {
    const client = newClient();
    client.setQueryData([...WEBHOOKS_KEY, 'subscriptions'], [webhook(1, 'stale hook')], earlier());
    reads.hold = '/events/webhooks';
    renderIn(client, <WebhookManagementSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale hook')).toBeNull();
    await act(async () => { reads.held[0]?.({ success: true, data: server.webhooks }); });
    expect(await screen.findByText('fresh hook')).toBeTruthy();
  });

  it('a refused read shows the server reason', async () => {
    reads.fail = '/events/webhooks';
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
  });

  it.each([
    ['a toggle', () => fireEvent.click(screen.getByText(SHOWN.webhookToggle))],
    ['a removal', () => fireEvent.click(screen.getByTitle(SHOWN.webhookDelete))],
  ])('%s refreshes the webhooks and reads the list again', async (_name, act) => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderIn(client, <WebhookManagementSubTab />);
    expect(await screen.findByText('fresh hook')).toBeTruthy();
    server.webhooks = [webhook(2, 'after the write')];
    act();
    expect(await screen.findByText('after the write')).toBeTruthy();
    expect(keysOf(invalidated)).toContain(JSON.stringify(WEBHOOKS_KEY));
  });

  it('the delivery log of a webhook is read for that webhook', async () => {
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect(await screen.findByText('fresh hook')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.deliveries));
    await waitFor(() => expect(readsOf('/events/webhooks/deliveries/list').some(q => q.get('subscriptionId') === '1')).toBe(true));
  });
});

describe('the event timeline tab reads through the shared cache (10.3)', () => {
  it('shows the first record found, never the timeline an earlier opening left', async () => {
    const client = newClient();
    client.setQueryData([...EVENT_SOURCING_KEY, 'timeline', 'document', '5'], { timeline: [timelineItem('stale step')], auditIncluded: true }, earlier());
    reads.hold = '/events/event-sourcing/timeline';
    renderIn(client, <EventSourcingReplaySubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale step')).toBeNull();
    expect(screen.getByText(SHOWN.timelineLoading)).toBeTruthy();
    await act(async () => { reads.held[0]?.({ success: true, timeline: server.timeline, auditIncluded: true }); });
    expect(await screen.findByText('fresh step')).toBeTruthy();
  });

  it('a refused timeline read shows the server reason', async () => {
    reads.fail = '/events/event-sourcing/timeline';
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
  });

  it('picking no record asks the user to pick one', async () => {
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect(await screen.findByText('fresh step')).toBeTruthy();
    const select = screen.getByDisplayValue('record five') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '' } });
    expect(await screen.findByText(SHOWN.pickPrompt)).toBeTruthy();
    expect(select.value).toBe('');
    expect(screen.getByText(SHOWN.pickNone)).toBeTruthy();
  });
});

describe('the event admin tabs make no read of their own (10.3)', () => {
  it.each([
    'components/settings/DeadLetterQueueSubTab.tsx',
    'components/settings/WebhookManagementSubTab.tsx',
    'components/settings/EventSourcingReplaySubTab.tsx',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });
});
