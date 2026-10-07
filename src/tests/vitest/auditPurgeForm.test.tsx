/**
 * v9.0.154 (TD-522, B02-07, owner decision t4 A): the audit purge form has no switch that turns the protection off, names
 * the sections the purge deletes (from the server's list) and sends only the retention period.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemOperationsTab } from '../../components/settings/SystemOperationsTab';
import { PURGEABLE_AUDIT_ENTITY_LABELS } from '../../lib/audit/auditRetention';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemOperationsTab onOpenClearModal={() => {}} />
    </QueryClientProvider>,
  );
}

describe('audit purge form (TD-522)', () => {
  it('offers no protection switch, names the purgeable sections and sends only the retention period', async () => {
    fetchJson.mockImplementation(async (url: string) => (url === '/activity-logs/purge'
      ? { success: true, message: 'ok' }
      : { healthy: true, totalLogs: 10, criticalLogsCount: 8, earliestTimestamp: null, latestTimestamp: null, minRetentionDays: 90 }));
    renderTab();

    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByText(/حفاظت کامل/)).toBeNull();
    const intro = screen.getByText(/پاکسازی فقط سوابق این بخش‌ها را پاک می‌کند/);
    for (const label of Object.values(PURGEABLE_AUDIT_ENTITY_LABELS)) expect(intro.textContent).toContain(label);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '365' } });
    fireEvent.click(screen.getByRole('button', { name: /اجرای پاکسازی ایمن ممیزی/ }));
    fireEvent.click(screen.getByRole('button', { name: 'تایید و اجرا' }));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/activity-logs/purge', expect.anything()));
    const call = fetchJson.mock.calls.find(c => c[0] === '/activity-logs/purge');
    expect(JSON.parse(String((call?.[1] as { body?: unknown })?.body))).toEqual({ retentionDays: 365 });
  });
});
