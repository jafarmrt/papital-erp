/**
 * v9.0.214 (TD-537, B02-22): the audit log page shows a Persian error for a refused (403) request instead of "no record
 * found", sends the search only after typing pauses, and starts again from page 1 when the search changes. Typing «علی»
 * on page 2 used to send three requests (page=2, «ع», «عل», «علی»).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ActivityLogsPage from '../../pages/ActivityLogsPage';
import { SearchProvider } from '../../SearchContext';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const logRow = (id: number) => ({
  id, username: 'ali', userFullName: 'علی', action: 'UPDATE', entity: 'کالا', entityId: '1', description: `رویداد ${id}`,
  ipAddress: '', timestamp: '2026-10-06T10:00:00Z', details: {},
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchProvider>
        <ActivityLogsPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

/** the server's own 403 text (test data); the page shows its own sentence instead */
const SERVER_FORBIDDEN_MESSAGE = 'شما مجوز لازم (audit_logs.view) برای انجام این کار را ندارید';

const listCalls = () => fetchJson.mock.calls.map(c => String(c[0])).filter(url => url.startsWith('/activity-logs?'));

describe('audit log page (TD-537)', () => {
  it('shows a Persian permission error for a 403 instead of an empty result', async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/activity-logs?')) {
        throw Object.assign(new Error(SERVER_FORBIDDEN_MESSAGE), { status: 403, code: 'FORBIDDEN' });
      }
      return { users: [], actions: [], entities: [] };
    });
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('برای دیدن سجل رویدادها مجوز «مشاهده دفترچه سوابق تغییرات» لازم است');
    expect(screen.queryByText(/هیچ رکوردی مطابق/)).toBeNull();
  });

  it('sends one request after typing pauses, from page 1', async () => {
    fetchJson.mockImplementation(async (url: string) => (url.startsWith('/activity-logs?')
      ? { data: [logRow(1), logRow(2)], total: 75, totalPages: 3 }
      : { users: [], actions: [], entities: [] }));
    renderPage();
    await screen.findByText('رویداد 1');

    const next = document.querySelector('button:has(svg.lucide-chevron-left)') as HTMLButtonElement;
    fireEvent.click(next);
    await waitFor(() => expect(listCalls().some(url => url.includes('page=2'))).toBe(true));

    const input = screen.getByPlaceholderText(/جستجو در شرح رویداد/);
    for (const text of ['ع', 'عل', 'علی']) fireEvent.change(input, { target: { value: text } });
    const typed = encodeURIComponent('علی');
    await waitFor(() => expect(listCalls().some(url => url.includes(`search=${typed}`))).toBe(true));
    const searched = listCalls().filter(url => url.includes('search='));
    expect(searched).toHaveLength(1);
    expect(searched[0]).toContain('page=1');
  });
});
