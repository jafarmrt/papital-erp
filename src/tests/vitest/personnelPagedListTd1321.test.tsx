import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePersonnel } from '../../hooks/usePersonnel';
import {
  PERSONNEL_ACTIVE_PICK_URL, PERSONNEL_PICK_CAP_NOTICE, PERSONNEL_PICK_CAP_TOAST_ID, PERSONNEL_PICK_LIMIT, PERSONNEL_PICK_URL,
  personnelPageUrl, resetPersonnelPickNotice, takePersonnelPick,
} from '../../lib/personnel/personnelList';
import { parsePagination, parsePickListLimit } from '../../lib/pagination';
import { compactSearchText } from '../../lib/search/searchText';
import { useCRMData } from '../../hooks/useCRMData';
import { VoucherDetailedPicker, type VoucherDetailedValue } from '../../components/accounting/VoucherDetailedPicker';
import { PersonnelExcelModal } from '../../components/personnel/PersonnelExcelModal';
import { useAccountingPersonnelQuery } from '../../hooks/accounting/useAccountingParties';

// OBS-R2-57 (TD-1321): the personnel page reads one page from the server and every personnel only while the form or the
// Excel window is open; the earlier hook read the whole list on open and searched and paged it in the browser
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
const toastFn = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: toastFn, default: toastFn }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

const stats = { total: 40, active: 30, terminated: 6, onLeave: 4, usersCount: 12 };
const row = (id: number) => ({ id, fullName: `پرسنل ${id}`, employmentStatus: 'فعال' });

function answer(url: string) {
  if (url.startsWith('/personnel?') && url.includes('page=')) {
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const page = Number(params.get('page'));
    return Promise.resolve({ data: [row(page * 100 + 1), row(page * 100 + 2)], total: 40, page, limit: Number(params.get('limit')), stats });
  }
  if (url === '/personnel') return Promise.resolve([row(1), row(2), row(3)]);
  return Promise.resolve([]);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => { cleanup(); fetchJson.mockReset(); toastFn.mockReset(); resetPersonnelPickNotice(); });

describe('personnel page list (OBS-R2-57)', () => {
  it('builds the page address with search and status, and leaves out an empty search or «all»', () => {
    expect(personnelPageUrl({ page: 2, limit: 15, search: '  علی ', status: 'فعال' }))
      .toBe(`/personnel?page=2&limit=15&search=${encodeURIComponent('علی')}&status=${encodeURIComponent('فعال')}`);
    expect(personnelPageUrl({ page: 1, limit: 15, search: '', status: 'all' })).toBe('/personnel?page=1&limit=15');
  });

  it('reads one page with the cards from the server and every personnel only while the form is open', async () => {
    fetchJson.mockImplementation((url: string) => answer(url));
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    await waitFor(() => expect(result.current.paginatedPersonnel).toHaveLength(2));
    const urls = () => fetchJson.mock.calls.map(c => String(c[0]));
    expect(urls()).toContain('/personnel?page=1&limit=15');
    expect(urls()).not.toContain('/personnel');
    expect(result.current.stats).toEqual(stats);
    expect(result.current.totalFilteredCount).toBe(40);
    expect(result.current.totalAllCount).toBe(40);
    expect(result.current.totalPages).toBe(3);

    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.paginatedPersonnel[0]?.id).toBe(201));
    expect(result.current.startIndex).toBe(15);

    act(() => result.current.handleOpenAddModal());
    await waitFor(() => expect(result.current.personnelList).toHaveLength(3));
    expect(urls()).toContain('/personnel');
  });

  it('keeps the shown rows\' own range while the next page loads', async () => {
    let release: (() => void) | undefined;
    fetchJson.mockImplementation((url: string) => {
      if (url.includes('page=2')) return new Promise(resolve => { release = () => resolve(answer(url)); });
      return answer(url);
    });
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    await waitFor(() => expect(result.current.paginatedPersonnel).toHaveLength(2));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(release).toBeDefined());
    expect(result.current.paginatedPersonnel[0]?.id).toBe(101);
    expect(result.current.startIndex).toBe(0);
    await act(async () => { release?.(); });
    await waitFor(() => expect(result.current.paginatedPersonnel[0]?.id).toBe(201));
    expect(result.current.startIndex).toBe(15);
  });

  it('says the form and Excel windows wait for every personnel before checking against them', async () => {
    let release: (() => void) | undefined;
    fetchJson.mockImplementation((url: string) => {
      if (url === '/personnel') return new Promise(resolve => { release = () => resolve([row(1)]); });
      return answer(url);
    });
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    act(() => result.current.handleOpenAddModal());
    await waitFor(() => expect(release).toBeDefined());
    expect(result.current.fullListReady).toBe(false);
    await act(async () => { release?.(); });
    await waitFor(() => expect(result.current.fullListReady).toBe(true));
  });

  it('a failed background read keeps a full list that already arrived usable', async () => {
    let failing = false;
    fetchJson.mockImplementation((url: string) => {
      if (url === '/personnel') return failing ? Promise.reject(new Error('offline')) : Promise.resolve([row(1)]);
      return answer(url);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const own = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePersonnel(), { wrapper: own });
    act(() => result.current.handleOpenAddModal());
    await waitFor(() => expect(result.current.fullListReady).toBe(true));
    failing = true;
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(fetchJson.mock.calls.filter(c => c[0] === '/personnel')).toHaveLength(2));
    expect(result.current.fullListFailed).toBe(false);
    expect(result.current.fullListReady).toBe(true);
  });

  it('the Excel window reads no file until the existing personnel arrived', () => {
    render(<PersonnelExcelModal isOpen onClose={() => {}} onSuccess={() => {}} existingPersonnel={[]} existingState="loading" />);
    expect((document.getElementById('personnel-excel-file-input') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('در حال خواندن فهرست پرسنل');
  });

  it('sends the search to the server after the typing pause and goes back to page 1', async () => {
    fetchJson.mockImplementation((url: string) => answer(url));
    const { result } = renderHook(() => usePersonnel(), { wrapper });
    await waitFor(() => expect(result.current.paginatedPersonnel).toHaveLength(2));
    act(() => result.current.setCurrentPage(3));
    act(() => result.current.setSearchQuery('رضا'));
    await waitFor(() => expect(fetchJson.mock.calls.map(c => String(c[0])))
      .toContain(`/personnel?page=1&limit=15&search=${encodeURIComponent('رضا')}`));
    expect(result.current.currentPage).toBe(1);
  });
});

describe('personnel pick list cap (OBS-R1-69)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

  it('asks one row above the cap and keeps the cap', () => {
    expect(PERSONNEL_PICK_LIMIT).toBe(5000);
    expect(PERSONNEL_PICK_URL).toBe('/personnel?limit=5001');
    expect(PERSONNEL_ACTIVE_PICK_URL).toBe('/personnel?limit=5001&activeOnly=1');
    expect(PERSONNEL_PICK_CAP_NOTICE).toContain('۵٬۰۰۰');
  });

  // 10.3 package 6 (TD-1362): the picker of a cut list searches on the server, so the notice points to its search
  it('the notice says who is missing and that the picker\'s own search finds them, never the personnel page', () => {
    expect(PERSONNEL_PICK_CAP_NOTICE).toBe('فهرست انتخاب فقط ۵٬۰۰۰ پرسنلِ آخرِ ثبت‌شده را نشان می‌دهد؛ پرسنل قدیمی‌تر را با نوشتن نامشان در جست‌وجوی انتخابگر پیدا کنید.');
  });

  it('shows the notice only when the server had more rows than the cap, and once per session', () => {
    expect(takePersonnelPick(many(5000))).toEqual({ rows: many(5000), notice: null });
    const cut = takePersonnelPick(many(5001));
    expect(cut.rows).toHaveLength(5000);
    expect(cut.notice).toBe(PERSONNEL_PICK_CAP_NOTICE);
    expect(takePersonnelPick(many(5001)).notice).toBeNull();
  });

  it('the accounting party picker keeps the cap and shows the notice when the server had more', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === PERSONNEL_PICK_URL ? many(5001) : []));
    const { result } = renderHook(() => useAccountingPersonnelQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(5000));
    expect(fetchJson.mock.calls.map(c => String(c[0]))).toEqual([PERSONNEL_PICK_URL]);
    expect(toastFn).toHaveBeenCalledWith(PERSONNEL_PICK_CAP_NOTICE, { id: PERSONNEL_PICK_CAP_TOAST_ID, duration: 8000 });
  });

  it('a list that only reached the cap shows no notice', async () => {
    fetchJson.mockImplementation(() => Promise.resolve(many(5000)));
    const { result } = renderHook(() => useAccountingPersonnelQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(5000));
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('the sales seller picker asks for personnel who have not left and shows the notice above the cap', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === PERSONNEL_ACTIVE_PICK_URL ? many(5001) : []));
    renderHook(() => useCRMData({ id: 1, username: 'u' }), { wrapper });
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(PERSONNEL_PICK_CAP_NOTICE, { id: PERSONNEL_PICK_CAP_TOAST_ID, duration: 8000 }));
    const urls = fetchJson.mock.calls.map(c => String(c[0]));
    expect(urls).toContain(PERSONNEL_ACTIVE_PICK_URL);
    expect(urls).not.toContain(PERSONNEL_PICK_URL);
  });
});

describe('personnel list limits and search text (TD-1321)', () => {
  it('a pick list without a valid limit stays uncapped; a limit is capped by the caller\'s maximum', () => {
    expect(parsePickListLimit(undefined)).toBeUndefined();
    expect(parsePickListLimit('')).toBeUndefined();
    expect(parsePickListLimit('0')).toBeUndefined();
    expect(parsePickListLimit('-3')).toBeUndefined();
    expect(parsePickListLimit('abc')).toBeUndefined();
    expect(parsePickListLimit('20')).toBe(20);
    expect(parsePickListLimit('999999')).toBe(5000);
    expect(parsePickListLimit('999999', 5001)).toBe(5001);
  });

  it('a page request reads a whole page above zero and a limit at most 1000', () => {
    expect(parsePagination({ page: '0', limit: '0' }, { limit: 15 })).toEqual({ page: 1, limit: 15, offset: 0 });
    expect(parsePagination({ page: '-2', limit: 'x' }, { limit: 15 })).toEqual({ page: 1, limit: 15, offset: 0 });
    expect(parsePagination({ page: '3', limit: '20' }, { limit: 15 })).toEqual({ page: 3, limit: 20, offset: 40 });
    expect(parsePagination({ page: '2', limit: '50000' }, { limit: 15 })).toEqual({ page: 2, limit: 1000, offset: 1000 });
  });

  it('folds spaces, zero-width marks, dash, underscore, ta marbuta and heh with yeh like the page did in the browser', () => {
    expect(compactSearchText('علی زاده')).toBe('علیزاده');
    expect(compactSearchText('علی\u200cزاده')).toBe('علیزاده');
    expect(compactSearchText(' علي_زاده-ك ')).toBe('علیزادهک');
    expect(compactSearchText('فاطمة')).toBe('فاطمه');
    expect(compactSearchText('خانۀ')).toBe('خانه');
  });

  it('drops a NUL character, which PostgreSQL text cannot hold', () => {
    expect(compactSearchText('علی\u0000زاده')).toBe('علیزاده');
    expect(compactSearchText('\u0000')).toBe('');
  });
});

describe('a saved personnel outside the pick list (TD-1321)', () => {
  const people = [{ id: 1, fullName: 'پرسنل یک' }];

  function renderPicker(value: VoucherDetailedValue, onChange = vi.fn()) {
    render(<VoucherDetailedPicker value={value} onChange={onChange} customers={[]} personnelList={people} />, { wrapper });
    return { onChange, select: screen.getByLabelText('انتخاب پرسنل') as HTMLSelectElement };
  }

  it('keeps the row\'s own personnel with its stored name and never reads it again', async () => {
    const { select, onChange } = renderPicker({ detailedType: 'personnel', detailedId: 77, detailedName: 'پرسنل قدیمی' });
    expect(select.value).toBe('77');
    expect(select.selectedOptions[0]?.textContent).toBe('پرسنل قدیمی');
    fireEvent.change(select, { target: { value: '77' } });
    expect(onChange).toHaveBeenLastCalledWith({ detailedType: 'personnel', detailedId: 77, detailedName: 'پرسنل قدیمی' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('reads the name by id when the row stored none', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url === '/personnel/77' ? { id: 77, fullName: 'مریم دور' } : []));
    const { select } = renderPicker({ detailedType: 'personnel', detailedId: 77, detailedName: '' });
    expect(select.value).toBe('77');
    await waitFor(() => expect(select.selectedOptions[0]?.textContent).toBe('مریم دور'));
  });

  it('adds nothing when the list holds the row\'s personnel', () => {
    const { select } = renderPicker({ detailedType: 'personnel', detailedId: 1, detailedName: 'پرسنل یک' });
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', '1']);
  });
});
