/**
 * v10.1.51 closing sweep, daily log, gallery, customer, sales file and events observations (OBS-R2-62, OBS-R2-25,
 * OBS-R2-26, OBS-R2-87). Each case is red on v10.1.45.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, fetchJson } from '../../api';
import { renderWithQuery } from './helpers/queryWrapper';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, toast };
});
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const ROOT = path.resolve(__dirname, '../../..');
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** server messages the windows show as they are */
const STALE_VERSION_MESSAGE = 'نسخه کهنه است';
const DUPLICATE_RULE_MESSAGE = 'قانون تکراری است';

describe('OBS-R2-62 gallery and daily log', () => {
  it('the gallery reads one server page of items with a picture, never limit=0', async () => {
    const { galleryItemsUrl, GALLERY_PAGE_SIZE } = await import('../../lib/gallery/galleryItems');
    const url = new URL(galleryItemsUrl({ tab: 'product', page: 3, search: ' گردنبند ', category: 'انگشتر' }), 'http://x');
    expect(url.pathname).toBe('/items');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: 'product', image: '1', page: '3', limit: String(GALLERY_PAGE_SIZE), search: 'گردنبند', category: 'انگشتر',
    });
    expect(source('src/pages/GalleryPage.tsx')).not.toContain('limit=0');
  });

  it('the gallery shows a loading state until its page arrives, and the server page count', async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url === '/categories') return [];
      return new Promise(resolve => { answer = resolve; });
    });
    const { default: GalleryPage } = await import('../../pages/GalleryPage');
    renderWithQuery(<GalleryPage user={{ id: 1, username: 'u', role: 'admin' } as never} />);
    expect(screen.getByRole('status').textContent).toContain('در حال بارگذاری');
    expect(screen.queryByText(/موردی برای نمایش/)).toBeNull();
    await act(async () => {
      answer({ data: [{ id: 5, name: 'گردنبند ماه', code: 'P-5', image: '/a.png', current_stock: 2, unit: 'عدد' }], total: 120, totalPages: 3 });
    });
    // 10.3: the answer reaches the page through the shared cache, which tells its screens a moment later
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByText('گردنبند ماه')).toBeTruthy();
    expect(screen.getByText(/صفحه ۱ از ۳/)).toBeTruthy();
  });

  it('the daily log window has no dead mention toggle prop', () => {
    for (const file of ['src/components/daily-logs/DailyLogModal.tsx', 'src/pages/DailyLogsPage.tsx', 'src/hooks/useDailyLogs.ts']) {
      expect(source(file)).not.toMatch(/ToggleMentionUser/);
    }
  });
});

describe('OBS-R2-25 customer Excel window', () => {
  it('matches the file against every party (export=true), not the 50 rows of the list page', async () => {
    vi.mocked(fetchJson).mockResolvedValue([{ id: 1, name: 'الف' }, { id: 2, name: 'ب' }]);
    const { fetchAllCustomersForImport } = await import('../../components/customers/CustomerExcelModal');
    const all = await fetchAllCustomersForImport();
    expect(vi.mocked(fetchJson).mock.calls[0][0]).toBe('/customers?export=true');
    expect(all).toHaveLength(2);
    expect(source('src/pages/CustomersPage.tsx')).not.toContain('existingCustomers=');
  });

  it('numbers rows by their Excel row, sends it, lists every error and resets on close', () => {
    const modal = source('src/components/customers/CustomerExcelModal.tsx');
    expect(modal).toContain('index: idx + 2');
    expect(modal).toContain('sheetRow: r.index');
    expect(modal).not.toContain('errors.slice(0, 5)');
    expect(modal).toMatch(/max-h-48 overflow-y-auto/);
    expect(modal).toMatch(/const handleClose = \(\) => \{[\s\S]*?setStep\('upload'\);[\s\S]*?setImportResult\(null\);[\s\S]*?onClose\(\);/);
    expect(modal).not.toMatch(/onClick=\{onClose\}|DialogLayer onClose=\{onClose\}/);
  });
});

describe('OBS-R2-26 customer form and sales file', () => {
  it('a 409 on save reads the customer list again', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new ApiError(STALE_VERSION_MESSAGE, 'OCC_CONFLICT', 409));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { useSaveCustomerMutation } = await import('../../hooks/queries/useCustomerQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSaveCustomerMutation(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 4, payload: { name: 'x' } }).catch(() => undefined); });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('a probability of 0 stays 0, the amount reads Persian digits and the drawer reads no sale price', () => {
    const modal = source('src/components/crm/CRMLeadModal.tsx');
    expect(modal).not.toMatch(/probability: parseInt\(v\) \|\| 50/);
    expect(modal).not.toContain("toLocaleString('en-US')");
    expect(modal).toContain('normalizeDecimalString(e.target.value)');
    expect(source('src/hooks/useCRMData.ts')).not.toMatch(/probability \|\| 50/);
    expect(source('src/components/crm/CRMLeadDrawer.tsx')).not.toContain('sales_price');
  });
});

describe('OBS-R2-87 events and notification UI', () => {
  it('an empty or wrong webhook timeout or retry limit is an error, never the default', async () => {
    const { webhookFormLimits } = await import('../../lib/events/webhookTimeout');
    expect(webhookFormLimits({ retryLimit: '3', timeoutMs: '' }).ok).toBe(false);
    expect(webhookFormLimits({ retryLimit: '3', timeoutMs: '500' }).ok).toBe(false);
    expect(webhookFormLimits({ retryLimit: '', timeoutMs: '5000' }).ok).toBe(false);
    expect(webhookFormLimits({ retryLimit: '11', timeoutMs: '5000' }).ok).toBe(false);
    expect(webhookFormLimits({ retryLimit: '4', timeoutMs: '7000' })).toEqual({ ok: true, retryLimit: 4, timeoutMs: 7000 });
  });

  it('the webhook form refuses a cleared timeout and says why', async () => {
    const posts: string[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
      if ((opts?.method || 'GET') === 'POST') { posts.push(url); return { success: true }; }
      if (url === '/events/webhooks') return { success: true, data: [] };
      return { success: true, data: [], stats: null };
    });
    const { WebhookManagementSubTab } = await import('../../components/settings/WebhookManagementSubTab');
    renderWithQuery(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByText('تعریف وب‌هوک جدید'));
    fireEvent.change(screen.getByPlaceholderText('مثال: فروشگاه برخط ووکامرس'), { target: { value: 'شریک' } });
    fireEvent.change(screen.getByPlaceholderText('https://your-domain.com/api/webhook/receiver'), { target: { value: 'https://p.example.com/hook' } });
    fireEvent.change(screen.getByLabelText('مهلت پاسخ (میلی‌ثانیه):'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('مهلت پاسخ (میلی‌ثانیه):').closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes('مهلت پاسخ'))).toBe(true));
    expect(posts).toEqual([]);
  });

  it('the dead-letter selection is cleared by a filter change and rows show Persian event names', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.startsWith('/events/dlq/stats')) return { success: true, stats: { total: 1, quarantined: 1, replayed: 0, dismissed: 0, byEventType: {}, bySource: {} } };
      return { success: true, data: [{
        id: 1, originalEventId: 'evt-1-abcdefghijklmnop', eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '12',
        source: 'outbox', payload: {}, metadata: {}, failureReason: 'x', errorStack: '', retryCount: 5, status: 'quarantined', quarantinedAt: '2026-10-06 10:00:00',
      }] };
    });
    const { DeadLetterQueueSubTab } = await import('../../components/settings/DeadLetterQueueSubTab');
    const { container } = renderWithQuery(<DeadLetterQueueSubTab />);
    await screen.findByText('صدور قطعی فاکتور فروش');
    expect(screen.getByText(/سند #۱۲/)).toBeTruthy();
    expect(screen.queryByText('InvoiceApproved')).toBeNull();
    const rowCheckbox = container.querySelector('tbody button') as HTMLButtonElement;
    fireEvent.click(rowCheckbox);
    expect(screen.getByText(/بازپخش ۱ مورد/)).toBeTruthy();
    const statusSelect = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: 'replayed' } });
    await waitFor(() => expect(screen.queryByText(/بازپخش ۱ مورد/)).toBeNull());
  });

  it('the event tab shows Persian event and aggregate names, falling back to the code', async () => {
    const { eventAggregateLabel, eventTypeLabel } = await import('../../lib/events/eventTypeCatalog');
    expect(eventAggregateLabel('Treasury')).toBe('خزانه');
    expect(eventAggregateLabel('constructor')).toBe('constructor');
    expect(eventTypeLabel('UnknownThing')).toBe('UnknownThing');
    // 10.3 package 6: the outbox and live events lists moved out of the tab into their own sub-tabs
    for (const file of ['DomainEventsTab', 'OutboxSubTab', 'LiveEventsSubTab']) {
      const tab = source(`src/components/settings/${file}.tsx`);
      expect(tab, file).not.toMatch(/^\s*\{evt\.eventType\}$|\{evt\.aggregateType\}#/m);
    }
  });

  it('the rule window shows a save error and stays open', async () => {
    const { RuleEditorModal } = await import('../../components/settings/RuleEditorModal');
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error(DUPLICATE_RULE_MESSAGE));
    const { container } = render(<RuleEditorModal isOpen onClose={onClose} onSave={onSave} initialRule={{
      id: 3, name: 'قانون', description: '', eventType: 'InvoiceApproved', conditionsJson: [], actionType: 'audit_log', actionConfigJson: {}, isActive: 1,
    }} />);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent === 'قانون تکراری است')).toBe(true));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the notification buttons show on keyboard focus and carry Persian names', () => {
    const bell = source('src/components/NotificationBell.tsx');
    expect(bell).toContain('focus-within:opacity-100');
    expect(bell).toContain('aria-label="علامت خوانده شده"');
    expect(bell).toContain('aria-label="حذف اعلان"');
  });
});
