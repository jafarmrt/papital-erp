import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { MessageDetail, MessageList } from '../../lib/storefront/storefrontMessageContracts';

/**
 * v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت» in the ERP: the list filtered by
 * state on the server, one message with every answer as plain text, a new message becoming «دیده‌شده» when a handler
 * opens it, the states and the removal under the message's version, and the screen for a holder of the view key alone.
 */
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ API_URL: '/api', fetchJson: (...args: unknown[]) => fetchJson(...(args as [])), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const permissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock('../../contexts/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/AuthContext')>('../../contexts/AuthContext');
  return { ...actual, useHasPermission: (key: string) => permissions.current.includes(key) };
});

const StorefrontMessagesPage = (await import('../../pages/StorefrontMessagesPage')).default;

const MARKUP = '<img src=x onerror=alert(1)>';
const detailOf = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  id: 12, formId: 3, formTitle: 'تماس با ما', status: 'new', createdAt: '2026-11-24T08:30:00.000Z', version: 1, statusBy: '', statusAt: '', leadId: null,
  answers: [
    { label: 'نام', kind: 'shortText', value: 'علی رضایی' }, { label: 'همراه', kind: 'mobile', value: '09123456789' }, { label: 'ایمیل', kind: 'email', value: '' },
    { label: 'روز', kind: 'date', value: '2026-11-24' }, { label: 'پیام', kind: 'longText', value: `سلام\n${MARKUP}` },
  ],
  ...over,
});
const LIST: MessageList = {
  data: [
    { id: 12, formId: 3, formTitle: 'تماس با ما', status: 'new', preview: 'علی رضایی · 09123456789', createdAt: '2026-11-24T08:30:00.000Z', version: 1 },
    { id: 9, formId: 3, formTitle: 'همکاری', status: 'answered', preview: 'شرکت نمونه', createdAt: '2026-11-20T08:30:00.000Z', version: 3 },
  ],
  total: 2, page: 1, pageSize: 30, counts: { new: 1, seen: 0, answered: 1 },
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  permissions.current = [];
});

type Call = [string, { method?: string; body?: string } | undefined];
const calls = (method?: string) => (fetchJson.mock.calls as Call[]).filter(([, init]) => init?.method === method).map(([url, init]) => ({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null }));

function open(at: string, detail: MessageDetail = detailOf()) {
  let current = detail;
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.startsWith('/storefront/messages?') && !init) return LIST;
    if (url === `/storefront/messages/${detail.id}` && !init) return { data: current };
    if (url === `/storefront/messages/${detail.id}/status` && init?.method === 'PUT') {
      const status = body.status as MessageDetail['status'];
      current = { ...current, status, version: Number(body.version) + 1, statusBy: status === 'new' ? '' : 'handler', statusAt: status === 'new' ? '' : '2026-11-24T09:00:00.000Z' };
      return { data: current };
    }
    if (url.startsWith(`/storefront/messages/${detail.id}?version=`) && init?.method === 'DELETE') return { success: true };
    throw new Error(`unexpected call ${init?.method ?? 'GET'} ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[at]}><StorefrontMessagesPage /></MemoryRouter></QueryClientProvider>);
}

describe('the screen of the messages of the site', () => {
  it('lists the messages with their state and asks the server for one state', async () => {
    permissions.current = [];
    open('/site-messages');
    const list = await screen.findByRole('list', { name: 'پیام‌ها' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('علی رضایی · 09123456789')).toBeTruthy();
    const states = screen.getByRole('navigation', { name: 'وضعیت پیام‌ها' });
    expect(within(states).getAllByRole('button').map(button => button.textContent)).toEqual(['همه (۲)', 'تازه (۱)', 'دیده‌شده (۰)', 'پاسخ داده شد (۱)']);
    expect(calls().map(call => call.url)).toEqual(['/storefront/messages?page=1']);
    fireEvent.click(within(states).getByRole('button', { name: 'تازه (۱)' }));
    await waitFor(() => expect(calls().map(call => call.url)).toContain('/storefront/messages?page=1&status=new'));
    expect(within(states).getByRole('button', { name: 'تازه (۱)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows every answer as plain text, and marks a new message as seen when a handler opens it', async () => {
    permissions.current = ['site_messages.manage'];
    open('/site-messages?message=12');
    const answers = await screen.findByLabelText('پاسخ‌های فرم');
    expect(within(answers).getByText('علی رضایی')).toBeTruthy();
    expect(within(answers).getByText('۰۹۱۲۳۴۵۶۷۸۹')).toBeTruthy();
    expect(within(answers).getByText('نوشته نشده')).toBeTruthy();
    expect(within(answers).getByText('۱۴۰۵/۰۹/۰۳')).toBeTruthy();
    // markup a visitor wrote is drawn as the text it is
    expect(within(answers).getByText(new RegExp('onerror=alert'))).toBeTruthy();
    expect(answers.querySelector('img')).toBeNull();
    await waitFor(() => expect(calls('PUT')).toEqual([{ url: '/storefront/messages/12/status', body: { status: 'seen', version: 1 } }]));
    await screen.findByText(/آخرین رسیدگی: handler/);
    // the next state goes under the version the first change returned, and the seen mark is not sent twice
    fireEvent.click(screen.getByRole('button', { name: 'پاسخ داده شد' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(2));
    expect(calls('PUT')[1]).toEqual({ url: '/storefront/messages/12/status', body: { status: 'answered', version: 2 } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'پاسخ داده شد' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('offers the way to the sales file a message opened only to who can open it (review of #505)', async () => {
    permissions.current = ['site_messages.manage'];
    open('/site-messages?message=12', detailOf({ leadId: 44, status: 'seen', statusBy: 'handler', statusAt: '2026-11-24T09:00:00.000Z' }));
    await screen.findByText(/این پیام یک پروندهٔ فروش هم ساخته است/);
    expect(screen.queryByRole('link', { name: 'دیدن پروندهٔ فروش' })).toBeNull();
    cleanup();
    permissions.current = ['site_messages.manage', 'crm.view'];
    open('/site-messages?message=12', detailOf({ leadId: 44, status: 'seen', statusBy: 'handler', statusAt: '2026-11-24T09:00:00.000Z' }));
    expect((await screen.findByRole('link', { name: 'دیدن پروندهٔ فروش' })).getAttribute('href')).toBe('/crm?leadId=44');
  });

  it('asks before a removal and sends it under the version', async () => {
    permissions.current = ['site_messages.manage', 'crm.view'];
    open('/site-messages?message=12', detailOf({ status: 'seen', version: 4, statusBy: 'handler', statusAt: '2026-11-24T09:00:00.000Z', leadId: 31 }));
    await screen.findByLabelText('پاسخ‌های فرم');
    expect((screen.getByRole('link', { name: 'دیدن پروندهٔ فروش' }) as HTMLAnchorElement).getAttribute('href')).toBe('/crm?leadId=31');
    fireEvent.click(screen.getByRole('button', { name: 'حذف پیام' }));
    expect(calls('DELETE')).toHaveLength(0);
    const confirm = screen.getByRole('group', { name: 'تأیید حذف پیام' });
    expect(confirm.textContent).toContain('پروندهٔ فروشی که ساخته است می‌ماند');
    fireEvent.click(within(confirm).getByRole('button', { name: 'بله، حذف شود' }));
    await waitFor(() => expect(calls('DELETE').map(call => call.url)).toEqual(['/storefront/messages/12?version=4']));
    // a message that was already seen is not marked again
    expect(calls('PUT')).toHaveLength(0);
  });

  it('shows a holder of the view key the message, with nothing to change it by', async () => {
    permissions.current = [];
    open('/site-messages?message=12');
    await screen.findByLabelText('پاسخ‌های فرم');
    for (const name of ['پاسخ داده شد', 'دیده‌شده', 'برگرداندن به تازه', 'حذف پیام']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(calls('PUT')).toHaveLength(0);
    expect(screen.getByText('تازه')).toBeTruthy();
  });
});
