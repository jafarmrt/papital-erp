import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  aggregateType, delivery, earlier, fetchJson, keysOf, newClient, reads, readsOf, renderIn, resetServer, server, timelineItem, type Opts,
} from './helpers/eventAdminServer';

/**
 * 10.3 (ARCH review finding 3, part 14, review fixes): every read of the event admin tabs (stats, deliveries, aggregate
 * types and search) counts only what this opening read; while it reads, or when it could not, the tab says so instead
 * of a count, a rate or an empty list it never read. A picked record's timeline is its own, a type change drops the pick,
 * and the payload and webhook saves refresh what they change.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  notRead: '—',
  fullRate: '۱۰۰٪',
  webhooksEmpty: /هنوز هیچ درگاه وب‌هوکی تعریف نشده است/,
  webhooksLoading: 'در حال دریافت درگاه‌های وب‌هوک…',
  deliveriesEmpty: 'هنوز تحویلی ثبت نشده است.',
  deliveriesLoading: 'در حال دریافت گزارش‌های تحویل…',
  deliveries: /^گزارش تحویل/,
  deliveriesRefresh: 'تازه‌سازی گزارش‌ها',
  webhookDelete: 'حذف درگاه',
  newWebhook: 'تعریف وب‌هوک جدید',
  webhookName: 'مثال: فروشگاه برخط ووکامرس',
  webhookUrl: 'https://your-domain.com/api/webhook/receiver',
  createWebhook: 'ایجاد و فعال‌سازی درگاه وب‌هوک',
  editPayload: 'اصلاح داده و بازپخش',
  savePayloadOnly: 'صرفاً ذخیره تغییرات',
  batch: /^بازپخش .* مورد$/,
  pickPrompt: /لطفاً از کادر بالا یک موجودیت را انتخاب کنید/,
  searching: 'در حال جست‌وجوی موجودیت‌ها…',
  searchNotRead: /فهرست موجودیت‌ها خوانده نشد/,
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

const stats = (quarantined: number) => ({ total: quarantined, quarantined, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} });
const webhookStats = (successRate: number) => ({ totalSubscriptions: 1, activeSubscriptions: 1, totalDeliveries: 3, successfulDeliveries: 3, failedDeliveries: 0, successRate });

describe('the dead letter stats count only what this opening read (10.3)', () => {
  it('never shows the counts an earlier opening left while they are read again', async () => {
    const client = newClient();
    client.setQueryData([...DLQ_KEY, 'stats'], stats(9), earlier());
    reads.hold = '/events/dlq/stats';
    renderIn(client, <DeadLetterQueueSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('۹')).toBeNull();
    expect(screen.getAllByText(SHOWN.notRead)).toHaveLength(4);
    await act(async () => { reads.held[0]?.({ success: true, stats: stats(7) }); });
    expect(await screen.findAllByText('۷')).toHaveLength(2);
  });

  it('a refused read shows the server reason and no count', async () => {
    reads.fail = '/events/dlq/stats';
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.getAllByText(SHOWN.notRead)).toHaveLength(4);
  });
});

describe('the webhooks tab shows only what this opening read (10.3)', () => {
  it('never shows the stats an earlier opening left while they are read again', async () => {
    const client = newClient();
    client.setQueryData([...WEBHOOKS_KEY, 'stats'], webhookStats(42), earlier());
    reads.hold = '/events/webhooks/stats';
    renderIn(client, <WebhookManagementSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('۴۲٪')).toBeNull();
    await act(async () => { reads.held[0]?.({ success: true, stats: webhookStats(88) }); });
    expect(await screen.findByText('۸۸٪')).toBeTruthy();
  });

  it('a refused stats read shows the server reason, not a 100% success rate', async () => {
    reads.fail = '/events/webhooks/stats';
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.fullRate)).toBeNull();
    expect(screen.getAllByText(SHOWN.notRead)).toHaveLength(4);
  });

  it('says it is reading the webhooks, not that none is defined, until they are read', async () => {
    reads.hold = '/events/webhooks';
    renderIn(newClient(), <WebhookManagementSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.getByText(SHOWN.webhooksLoading)).toBeTruthy();
    expect(screen.queryByText(SHOWN.webhooksEmpty)).toBeNull();
  });

  it('a refused webhooks read never says that none is defined', async () => {
    reads.fail = '/events/webhooks';
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(SHOWN.webhooksEmpty)).toBeNull();
    expect(screen.queryByText(SHOWN.webhooksLoading)).toBeNull();
  });

  it('never shows the deliveries an earlier opening left while they are read again', async () => {
    const client = newClient();
    client.setQueryData([...WEBHOOKS_KEY, 'deliveries', 'all'], [delivery(1, 'stale delivery')], earlier());
    reads.hold = '/events/webhooks/deliveries/list';
    renderIn(client, <WebhookManagementSubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale delivery')).toBeNull();
    expect(screen.getByText(SHOWN.deliveriesLoading)).toBeTruthy();
    await act(async () => { reads.held[0]?.({ success: true, data: [delivery(2, 'fresh delivery')] }); });
    expect(await screen.findByText('fresh delivery')).toBeTruthy();
  });

  it('a refused deliveries read shows the server reason, not «no delivery yet»', async () => {
    reads.fail = '/events/webhooks/deliveries/list';
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.deliveriesEmpty)).toBeNull();
  });

  it('removing the webhook whose deliveries are shown goes back to every delivery', async () => {
    renderIn(newClient(), <WebhookManagementSubTab />);
    expect(await screen.findByText('fresh hook')).toBeTruthy();
    fireEvent.click(screen.getByText(SHOWN.deliveries));
    await waitFor(() => expect(readsOf('/events/webhooks/deliveries/list').at(-1)?.get('subscriptionId')).toBe('1'));
    fireEvent.click(screen.getByTitle(SHOWN.webhookDelete));
    await waitFor(() => expect(readsOf('/events/webhooks/deliveries/list').at(-1)?.has('subscriptionId')).toBe(false));
  });

  it('its refresh button reads the deliveries again', async () => {
    renderIn(newClient(), <WebhookManagementSubTab />);
    await waitFor(() => expect(readsOf('/events/webhooks/deliveries/list')).toHaveLength(1));
    server.deliveries = [delivery(3, 'new delivery')];
    fireEvent.click(screen.getByText(SHOWN.deliveriesRefresh));
    expect(await screen.findByText('new delivery')).toBeTruthy();
  });

  it('a saved webhook refreshes the webhooks', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderIn(client, <WebhookManagementSubTab />);
    fireEvent.click(await screen.findByText(SHOWN.newWebhook));
    fireEvent.change(screen.getByPlaceholderText(SHOWN.webhookName), { target: { value: 'new partner' } });
    fireEvent.change(screen.getByPlaceholderText(SHOWN.webhookUrl), { target: { value: 'https://new.example.com/hook' } });
    fireEvent.click(screen.getByText(SHOWN.createWebhook).closest('button') as HTMLButtonElement);
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(WEBHOOKS_KEY)));
  });
});

describe('the dead letter writes and selection (10.3)', () => {
  it('a payload saved without a replay refreshes every event screen', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderIn(client, <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    fireEvent.click(screen.getByTitle(SHOWN.editPayload));
    fireEvent.click(screen.getByText(SHOWN.savePayloadOnly));
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.events.all)));
  });

  it('coming back to a filter never checks its rows again', async () => {
    renderIn(newClient(), <DeadLetterQueueSubTab />);
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    fireEvent.click(document.querySelector('tbody button') as HTMLElement);
    expect(screen.getByText(SHOWN.batch)).toBeTruthy();
    const status = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(status, { target: { value: 'quarantined' } });
    await waitFor(() => expect(readsOf('/events/dlq').some(q => q.get('status') === 'quarantined')).toBe(true));
    fireEvent.change(status, { target: { value: 'all' } });
    expect(await screen.findByText('fresh reason')).toBeTruthy();
    expect(screen.queryByText(SHOWN.batch)).toBeNull();
  });
});

describe('the event timeline tab shows only what this opening read (10.3)', () => {
  it('never shows the types an earlier opening left while they are read again', async () => {
    const client = newClient();
    client.setQueryData([...EVENT_SOURCING_KEY, 'types'], [aggregateType('document', 'staleType')], earlier());
    reads.hold = '/events/event-sourcing/types';
    renderIn(client, <EventSourcingReplaySubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('staleType')).toBeNull();
    await act(async () => { reads.held[0]?.({ success: true, types: [aggregateType('document', 'freshType')] }); });
    expect(await screen.findByText('freshType')).toBeTruthy();
  });

  it('a refused types read shows the server reason', async () => {
    reads.fail = '/events/event-sourcing/types';
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
  });

  it('never offers the records an earlier opening found while it searches again', async () => {
    const client = newClient();
    client.setQueryData([...EVENT_SOURCING_KEY, 'aggregates', 'document', ''], [{ id: '9', title: 'stale record' }], earlier());
    reads.hold = '/events/event-sourcing/aggregates';
    renderIn(client, <EventSourcingReplaySubTab />);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale record')).toBeNull();
    expect(screen.getByText(SHOWN.searching)).toBeTruthy();
    await act(async () => { reads.held[0]?.({ success: true, data: server.aggregates }); });
    expect(await screen.findByText('record five')).toBeTruthy();
  });

  it('a refused search shows the server reason, not «pick a record»', async () => {
    reads.fail = '/events/event-sourcing/aggregates';
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('server refused the read');
    expect(screen.queryByText(SHOWN.pickPrompt)).toBeNull();
    expect(screen.queryByText(SHOWN.searching)).toBeNull();
    expect(screen.getByText(SHOWN.searchNotRead)).toBeTruthy();
  });

  it('a record picked shows its own timeline in place of the first record\'s', async () => {
    server.aggregates = [{ id: '5', title: 'record five' }, { id: '6', title: 'record six' }];
    server.timelineOf = { 6: [timelineItem('step of six')] };
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect(await screen.findByText('fresh step')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('record five'), { target: { value: '6' } });
    expect(await screen.findByText('step of six')).toBeTruthy();
    expect(screen.queryByText('fresh step')).toBeNull();
  });

  it('another type drops the record picked and shows the first record of that type', async () => {
    server.types = [aggregateType('document', 'documents'), aggregateType('item', 'items')];
    server.aggregates = [{ id: '5', title: 'record five' }, { id: '6', title: 'record six' }];
    server.aggregatesOf = { item: [{ id: '7', title: 'record seven' }] };
    server.timelineOf = { 6: [timelineItem('step of six')], 7: [timelineItem('step of seven')] };
    renderIn(newClient(), <EventSourcingReplaySubTab />);
    expect(await screen.findByText('fresh step')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('record five'), { target: { value: '6' } });
    expect(await screen.findByText('step of six')).toBeTruthy();
    fireEvent.click(screen.getByText('items'));
    expect(await screen.findByText('step of seven')).toBeTruthy();
    expect((screen.getByDisplayValue('record seven') as HTMLSelectElement).value).toBe('7');
  });
});
