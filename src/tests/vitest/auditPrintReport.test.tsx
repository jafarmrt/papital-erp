/**
 * v9.0.215 (TD-527, B02-12): the official audit print and the Excel export come from one unpaginated server request
 * (capped at MAX_PAGE_LIMIT rows) with every filter of the page, the search text included. The print header shows the
 * server's total, prints the entity filter and the search text, and says when only the first rows are on the sheet.
 * They used to hold only the 25 rows of the current page, with "total records: 25", and drop the entity filter and the
 * search. Opera was reported as Chrome.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ActivityLogsPage from '../../pages/ActivityLogsPage';
import { SearchProvider } from '../../SearchContext';
import { parseUserAgent } from '../../utils/userAgentParser';
import { MAX_PAGE_LIMIT } from '../../lib/pagination';
import { formatPersianNumber } from '../../utils';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const jsonToSheet = vi.fn((rows: unknown[]) => ({ rows }));
const writeFile = vi.fn();
vi.mock('xlsx', () => ({
  utils: { json_to_sheet: (rows: unknown[]) => jsonToSheet(rows), book_new: () => ({}), book_append_sheet: () => undefined },
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  jsonToSheet.mockClear();
  writeFile.mockClear();
});

const ENTITY = 'سند حسابداری';
const logRow = (id: number) => ({
  id, username: 'ali', userFullName: 'علی', action: 'UPDATE', entity: ENTITY, entityId: String(id), description: `رویداد ${id}`,
  ipAddress: '', timestamp: '2026-10-06T10:00:00Z', details: {},
});
const rows = (count: number, from = 1) => Array.from({ length: count }, (_, i) => logRow(from + i));

function mockServer() {
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/activity-logs/filters') return { users: [], actions: [], entities: [ENTITY] };
    const params = new URLSearchParams(url.split('?')[1]);
    const limit = Number(params.get('limit'));
    // the filter matches 1500 events; the report request gets the first 40 here, the page request 25
    return { data: rows(limit === 25 ? 25 : 40), total: 1500, totalPages: 60 };
  });
}

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

async function filterPage() {
  renderPage();
  await screen.findByText('رویداد 1');
  fireEvent.change(screen.getByDisplayValue('همه بخش‌ها / موجودیت‌ها'), { target: { value: ENTITY } });
  fireEvent.change(screen.getByPlaceholderText(/جستجو در شرح رویداد/), { target: { value: 'تسویه' } });
  await waitFor(() => expect(fetchJson.mock.calls.some(c => String(c[0]).includes(`search=${encodeURIComponent('تسویه')}`))).toBe(true));
}

const reportCalls = () => fetchJson.mock.calls.map(c => String(c[0])).filter(url => url.includes(`limit=${MAX_PAGE_LIMIT}`));

describe('audit print and Excel report (TD-527)', () => {
  it('prints the server total, every filter and the search text, from one capped request', async () => {
    mockServer();
    await filterPage();

    fireEvent.click(screen.getByRole('button', { name: /پیش‌نمایش چاپ امنیتی/ }));
    const total = (await screen.findByText('تعداد کل رکوردها:')).parentElement as HTMLElement;
    expect(total.textContent).toContain(`${formatPersianNumber(1500)} مورد`);

    expect(reportCalls()).toHaveLength(1);
    const params = new URLSearchParams(reportCalls()[0].split('?')[1]);
    expect(params.get('page')).toBe('1');
    expect(params.get('entity')).toBe(ENTITY);
    expect(params.get('search')).toBe('تسویه');

    const filters = screen.getByTestId('audit-print-filters');
    expect(filters.textContent).toContain(ENTITY);
    expect(filters.textContent).toContain('«تسویه»');
    expect(screen.getByRole('note').textContent).toContain(`فقط ${formatPersianNumber(40)} ردیف اول از ${formatPersianNumber(1500)} ردیف`);
    // the sheet holds the report rows, not the 25 rows of the page
    const sheet = total.closest('.doc-print-area') as HTMLElement;
    expect(within(sheet).getByText('رویداد 40')).toBeTruthy();
  });

  it('exports the report rows to Excel, not the rows of the current page', async () => {
    mockServer();
    await filterPage();

    fireEvent.click(screen.getByRole('button', { name: /خروجی اکسل/ }));
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(reportCalls()).toHaveLength(1);
    expect(jsonToSheet.mock.calls[0][0]).toHaveLength(40);
  });

  it('reports Opera as Opera, not Chrome', () => {
    const opera = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0';
    expect(parseUserAgent(opera).browser).toBe('Opera');
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(parseUserAgent(chrome).browser).toBe('Chrome');
  });
});
