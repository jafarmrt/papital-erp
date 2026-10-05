import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useServerDraft } from '../../hooks/useServerDraft';
import { isEmptyInvoiceDraft } from '../../lib/invoices/invoiceForm';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

type Draft = { docType: string; buyerName: string; docItems: Array<{ id: number }>; crmLeadId: number | null };
const filled: Draft = { docType: 'invoice', buyerName: 'مشتری', docItems: [{ id: 1 }], crmLeadId: 5 };
const cleared: Draft = { docType: 'invoice', buyerName: '', docItems: [], crmLeadId: null };

const draftPosts = () => fetchJson.mock.calls.filter(([url, init]) => url === '/drafts' && (init as { method?: string })?.method === 'POST');

beforeEach(() => {
  vi.useFakeTimers();
  fetchJson.mockReset();
  fetchJson.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

// v8.0.111 (TD-388): پس از ثبت فاکتور و پاک شدن فرم، پیش‌نویس تازه ساخته نمی‌شود
describe('invoice server draft after a successful save (TD-388)', () => {
  it('does not recreate a draft for the form cleared after saving', async () => {
    const { result, rerender } = renderHook(({ data }) => useServerDraft(data, { entityType: 'invoice', draftKey: 'new_invoice', isEmpty: isEmptyInvoiceDraft }), {
      initialProps: { data: cleared },
    });
    rerender({ data: filled });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(draftPosts()).toHaveLength(1);

    // کاربر ردیفی را عوض کرد و پیش از ذخیره زمان‌بندی‌شده سند را ثبت کرد
    rerender({ data: { ...filled, docItems: [{ id: 1 }, { id: 2 }] } });
    await act(async () => { await result.current.discardDraft(); });
    rerender({ data: cleared });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(draftPosts()).toHaveLength(1);
  });

  it('treats only a form with lines or a buyer as a draft', () => {
    expect(isEmptyInvoiceDraft(cleared)).toBe(true);
    expect(isEmptyInvoiceDraft({ docItems: [], buyerName: 'مشتری' })).toBe(false);
    expect(isEmptyInvoiceDraft({ docItems: [{ id: 1 }], buyerName: '' })).toBe(false);
  });
});
