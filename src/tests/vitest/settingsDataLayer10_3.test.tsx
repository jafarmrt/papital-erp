import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ownReads } from './helpers/ownReads';
import {
  eidiRow, earlier, fetchJson, invalidate, keysOf, newClient, ratesRow, reads, resetServer, sentBody, server, settle, thisYear,
  wrapperOf, writesTo, type FetchOpts,
} from './helpers/settingsServer';

/**
 * 10.3 (ARCH review finding 3, part 13): the settings screens read through the shared cache. Each opening reads again and
 * never shows what an earlier opening left; a form follows a newer read until the user edits it, waits for its first
 * read, and is filled from the saved row after its own save (even when the refresh after it fails); a write refreshes
 * every screen that shows what it changed. The titles, accounting, system and shop screens are in the files beside this.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = {
  employeeInsurance: 'درصد بیمه سهم کارگر',
  saveRates: /^ذخیره نرخ‌های سال/,
  saveEidi: /ذخیره روش عیدی سال/,
  eidiPercent: 'درصد عیدی از کارکرد و حقوق ثابت هر فیش',
  year: 'سال جلالی',
} as const;

vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/settingsServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: FetchOpts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { toast } from 'react-hot-toast';
import { useSeededForm } from '../../hooks/useSeededForm';
import { PayrollStatutoryRatesTab } from '../../components/settings/PayrollStatutoryRatesTab';
import { PayrollEidiRatesSection } from '../../components/settings/PayrollEidiRatesSection';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { toLatinDigits } from '../../lib/numericInput';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  vi.mocked(toast.error).mockClear();
  resetServer();
});

const RATES = '/piecework/statutory-rates';
const EIDI = '/piecework/eidi-rates';
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
/** the number a rates field shows, in Latin digits (the shared number field shows Persian digits) */
const shown = (label: string) => toLatinDigits(field(label).value);
/** disabled itself or by its fieldset */
const locked = (el: Element) => el.matches(':disabled');
const saveRates = () => fireEvent.click(screen.getByText(SHOWN.saveRates));
const saveEidi = () => fireEvent.click(screen.getByRole('button', { name: SHOWN.saveEidi }));
const pickYear = (year: number) => fireEvent.change(screen.getAllByLabelText(SHOWN.year)[0] as HTMLSelectElement, { target: { value: String(year) } });

describe('a settings form filled from a shared read (10.3)', () => {
  const fill = (source: { value: string } | undefined) => source?.value ?? '';

  it('follows each newer read until edited, keeps the edit on a newer read, and refill fills it from the read as it is now', () => {
    const { result, rerender } = renderHook(({ source }: { source?: { value: string } }) => useSeededForm(source, fill), { initialProps: {} });
    expect(result.current.form).toBe('');
    rerender({ source: { value: 'a' } });
    expect(result.current.form).toBe('a');
    rerender({ source: { value: 'b' } });
    expect(result.current.form).toBe('b');

    act(() => { result.current.edit('typed'); });
    expect(result.current.edited).toBe(true);
    const newer = { value: 'c' };
    rerender({ source: newer });
    expect(result.current.form).toBe('typed');

    act(() => { result.current.refill(); });
    expect(result.current.form).toBe('c');
    expect(result.current.edited).toBe(false);
    rerender({ source: { value: 'd' } });
    expect(result.current.form).toBe('d');
  });

  it('an edit made from the form as it is (a function) builds on it', () => {
    const { result } = renderHook(() => useSeededForm({ value: 'a' }, fill));
    act(() => { result.current.edit(prev => `${prev}b`); });
    act(() => { result.current.edit(prev => `${prev}c`); });
    expect(result.current.form).toBe('abc');
  });
});

describe('the payroll rates read through the shared cache (10.3)', () => {
  it('never shows the rates an earlier opening left, and takes no typing until its read answers', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.statutoryRates(), [ratesRow(thisYear, '9')], earlier());
    server.rates = [ratesRow(thisYear, '7')];
    reads.holdNext = RATES;
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(shown(SHOWN.employeeInsurance)).toBe('');
    expect(locked(field(SHOWN.employeeInsurance))).toBe(true);
    expect(locked(screen.getByText(SHOWN.saveRates))).toBe(true);
    await act(async () => { reads.held[0]?.({ data: server.rates }); });
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('7'));
    expect(locked(field(SHOWN.employeeInsurance))).toBe(false);
  });

  it('follows a save made elsewhere until the user edits, then keeps what the user typed', async () => {
    const client = newClient();
    server.rates = [ratesRow(thisYear, '7')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('7'));
    server.rates = [ratesRow(thisYear, '8', 2)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('8'));

    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    server.rates = [ratesRow(thisYear, '5', 3)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    expect(shown(SHOWN.employeeInsurance)).toBe('6');
  });

  it('a save refreshes every payroll read and fills the form from the saved row, so the next save sends its new version', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    server.rates = [ratesRow(thisYear, '7')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('7'));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    saveRates();
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.piecework.all)));
    expect(sentBody(`${RATES}/${thisYear}`, 'PUT', 0).version).toBe(1);
    expect(shown(SHOWN.employeeInsurance)).toBe('6');

    // someone else's later save shows: the form follows reads again after its own save
    server.rates = [ratesRow(thisYear, '5', 3)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('5'));
    saveRates();
    await waitFor(() => expect(writesTo(`${RATES}/${thisYear}`, 'PUT')).toHaveLength(2));
    expect(sentBody(`${RATES}/${thisYear}`, 'PUT', 1).version).toBe(3);
  });

  it('a save whose refresh fails keeps the saved values, and the next save sends their new version', async () => {
    server.rates = [ratesRow(thisYear, '7')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('7'));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    reads.failNext = RATES;
    saveRates();
    await waitFor(() => expect(reads.failNext).toBeNull());
    await settle();
    expect(shown(SHOWN.employeeInsurance)).toBe('6');
    saveRates();
    await waitFor(() => expect(writesTo(`${RATES}/${thisYear}`, 'PUT')).toHaveLength(2));
    expect(sentBody(`${RATES}/${thisYear}`, 'PUT', 1).version).toBe(2);
  });

  it('the first save of a year whose refresh fails keeps the saved values and their version', async () => {
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(locked(field(SHOWN.employeeInsurance))).toBe(false));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    reads.failNext = RATES;
    saveRates();
    await waitFor(() => expect(reads.failNext).toBeNull());
    await settle();
    expect(shown(SHOWN.employeeInsurance)).toBe('6');
    saveRates();
    await waitFor(() => expect(writesTo(`${RATES}/${thisYear}`, 'PUT')).toHaveLength(2));
    expect(sentBody(`${RATES}/${thisYear}`, 'PUT', 1).version).toBe(1);
  });

  it('a failed first read is said once and leaves the form open to fill', async () => {
    reads.failNext = RATES;
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(locked(field(SHOWN.employeeInsurance))).toBe(false);
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('picking another year fills the form from that year, an edit of the first year set aside', async () => {
    server.rates = [ratesRow(thisYear, '7'), ratesRow(thisYear - 1, '4')];
    render(<PayrollStatutoryRatesTab />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(shown(SHOWN.employeeInsurance)).toBe('7'));
    fireEvent.change(field(SHOWN.employeeInsurance), { target: { value: '6' } });
    pickYear(thisYear - 1);
    expect(shown(SHOWN.employeeInsurance)).toBe('4');
  });
});

describe('the eidi section reads through the shared cache (10.3)', () => {
  it('never shows the rows an earlier opening left, and takes no typing until its read answers', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.piecework.eidiRates(), [eidiRow(thisYear, '9')], earlier());
    server.eidi = [eidiRow(thisYear, '15')];
    reads.holdNext = EIDI;
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(shown(SHOWN.eidiPercent)).toBe('');
    expect(locked(field(SHOWN.eidiPercent))).toBe(true);
    await act(async () => { reads.held[0]?.({ data: server.eidi }); });
    await waitFor(() => expect(shown(SHOWN.eidiPercent)).toBe('15'));
    expect(locked(field(SHOWN.eidiPercent))).toBe(false);
  });

  it('follows a newer read; its save refreshes every payroll read and the next save sends the new version', async () => {
    const client = newClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    server.eidi = [eidiRow(thisYear, '15')];
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(client) });
    await waitFor(() => expect(shown(SHOWN.eidiPercent)).toBe('15'));
    server.eidi = [eidiRow(thisYear, '12', 2)];
    await invalidate(client, QUERY_KEYS.piecework.all);
    await waitFor(() => expect(shown(SHOWN.eidiPercent)).toBe('12'));
    fireEvent.change(field(SHOWN.eidiPercent), { target: { value: '14' } });
    invalidated.mockClear();
    saveEidi();
    await waitFor(() => expect(keysOf(invalidated)).toContain(JSON.stringify(QUERY_KEYS.piecework.all)));
    expect(shown(SHOWN.eidiPercent)).toBe('14');
    saveEidi();
    await waitFor(() => expect(writesTo(`${EIDI}/${thisYear}`, 'PUT')).toHaveLength(2));
    expect(sentBody(`${EIDI}/${thisYear}`, 'PUT', 1).version).toBe(3);
  });

  it('a save whose refresh fails keeps the saved values, and the next save sends their new version', async () => {
    server.eidi = [eidiRow(thisYear, '15')];
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(shown(SHOWN.eidiPercent)).toBe('15'));
    fireEvent.change(field(SHOWN.eidiPercent), { target: { value: '14' } });
    reads.failNext = EIDI;
    saveEidi();
    await waitFor(() => expect(reads.failNext).toBeNull());
    await settle();
    expect(shown(SHOWN.eidiPercent)).toBe('14');
    saveEidi();
    await waitFor(() => expect(writesTo(`${EIDI}/${thisYear}`, 'PUT')).toHaveLength(2));
    expect(sentBody(`${EIDI}/${thisYear}`, 'PUT', 1).version).toBe(2);
  });

  it('picking another year fills the form from that year, an edit of the first year set aside', async () => {
    server.eidi = [eidiRow(thisYear, '15'), eidiRow(thisYear - 1, '4')];
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(shown(SHOWN.eidiPercent)).toBe('15'));
    fireEvent.change(field(SHOWN.eidiPercent), { target: { value: '14' } });
    pickYear(thisYear - 1);
    expect(shown(SHOWN.eidiPercent)).toBe('4');
  });

  it('a failed first read is said once and leaves the form open to fill', async () => {
    reads.failNext = EIDI;
    render(<PayrollEidiRatesSection />, { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(locked(field(SHOWN.eidiPercent))).toBe(false);
    await settle();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('the settings screens make no read of their own (10.3)', () => {
  it.each([
    'components/settings/PayrollStatutoryRatesTab.tsx',
    'components/settings/PayrollEidiRatesSection.tsx',
    'components/settings/TaskTitlesSettingsTab.tsx',
    'components/settings/WorkflowPresetsTab.tsx',
    'components/settings/AccountingSettingsTab.tsx',
    'components/settings/SystemConfigTab.tsx',
    'components/settings/ConditionalConstraintsCard.tsx',
    'components/settings/WooCommerceTab.tsx',
    'components/settings/AutoActionsSubTab.tsx',
    'hooks/useSettings.ts',
    'pages/SettingsPage.tsx',
  ])('%s reads only through the shared cache', (file) => {
    expect(ownReads(file)).toEqual([]);
  });
});
