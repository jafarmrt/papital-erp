import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERSONNEL_PICK_LIMIT, personnelServerSearchUrl } from '../../lib/personnel/personnelList';

// 10.3 package 6 (TD-1362): a personnel picker whose list was cut at the cap also searches on the server, so an older
// personnel is found by name; a list under the cap searches in the browser and asks the server nothing
const requested: string[] = [];
const older = { id: 9, fullName: 'رضا قدیمی', jobTitle: 'زرگر' };
const defaultAnswer = async (): Promise<unknown> => [older, { id: 1, fullName: 'رضا تازه' }];
let answer = defaultAnswer;
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  fetchJson: vi.fn(async (url: string) => {
    requested.push(url);
    return answer();
  }),
}));

const { SearchableSelect } = await import('../../components/SearchableSelect');
const { VoucherDetailedPicker } = await import('../../components/accounting/VoucherDetailedPicker');
afterEach(() => { cleanup(); requested.length = 0; answer = defaultAnswer; });

const option = (p: { id: number; fullName?: string }) => ({ value: String(p.id), label: p.fullName ?? '' });
const local = [{ id: 1, fullName: 'رضا تازه' }, { id: 2, fullName: 'مینا' }];
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 100_000 - i, fullName: `پرسنل ${i}` }));

async function typeSearch(text: string) {
  fireEvent.click(screen.getByRole('button'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
}

describe('TD-1362: the server search of a cut personnel list', () => {
  it('asks the server only for a list at the cap, with activeOnly for the sales seller', () => {
    expect(personnelServerSearchUrl(many(PERSONNEL_PICK_LIMIT - 1))).toBeUndefined();
    expect(personnelServerSearchUrl(many(PERSONNEL_PICK_LIMIT))).toBe('/personnel');
    expect(personnelServerSearchUrl(many(PERSONNEL_PICK_LIMIT), { activeOnly: true })).toBe('/personnel?activeOnly=1');
  });

  it('lists the server matches the cut options lack after their own, once each, and hands the chosen row back', async () => {
    const onChange = vi.fn();
    const picker = (value: string) => <SearchableSelect value={value} onChange={onChange} options={local.map(option)} serverSearchUrl="/personnel" mapResultToOption={option} />;
    const { rerender } = render(picker(''));
    await typeSearch('رضا');
    expect(requested.map(u => decodeURIComponent(u))).toEqual(['/personnel?search=رضا&limit=50']);
    await waitFor(() => expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['-- انتخاب کنید... --', 'رضا تازه', 'رضا قدیمی']));
    fireEvent.click(screen.getByText('رضا قدیمی'));
    expect(onChange).toHaveBeenCalledWith('9', older);
    rerender(picker('9'));
    expect(screen.getByRole('button').textContent).toBe('رضا قدیمی');
  });

  it('asks the server nothing without the url or before anything is typed', async () => {
    render(<SearchableSelect value="" onChange={() => undefined} options={local.map(option)} />);
    await typeSearch('رضا');
    cleanup();
    render(<SearchableSelect value="" onChange={() => undefined} options={local.map(option)} serverSearchUrl="/personnel" mapResultToOption={option} />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    expect(requested).toEqual([]);
  });

  it('gives the voucher row picker of a cut list the server search, and keeps the plain list under the cap', async () => {
    const onChange = vi.fn();
    const value = { detailedType: 'personnel' as const, detailedId: null, detailedName: '' };
    render(<VoucherDetailedPicker value={value} onChange={onChange} customers={[]} personnelList={many(PERSONNEL_PICK_LIMIT)} />, { wrapper });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('combobox', { name: 'جست‌وجو در فهرست' }), { target: { value: 'قدیمی' } });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    await waitFor(() => expect(screen.getByText('رضا قدیمی')).toBeTruthy());
    fireEvent.click(screen.getByText('رضا قدیمی'));
    expect(onChange).toHaveBeenCalledWith({ detailedType: 'personnel', detailedId: 9, detailedName: 'رضا قدیمی' });
    cleanup();
    render(<VoucherDetailedPicker value={value} onChange={() => undefined} customers={[]} personnelList={local} />, { wrapper });
    expect(screen.getByRole('combobox', { name: 'انتخاب پرسنل' }).tagName).toBe('SELECT');
    expect(screen.queryByRole('button')).toBeNull();
  });

  // review of #380
  it('lists a row of the list the server finds by a field its label lacks, such as the personnel code', async () => {
    answer = async () => [{ id: 1, fullName: 'رضا تازه' }, older];
    render(<SearchableSelect value="" onChange={() => undefined} options={local.map(option)} serverSearchUrl="/personnel" mapResultToOption={option} />);
    await typeSearch('EMP-7');
    await waitFor(() => expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['-- انتخاب کنید... --', 'رضا تازه', 'رضا قدیمی']));
  });

  it('says it is searching from the keystroke, and says when the server search failed', async () => {
    answer = async () => { throw new Error('network'); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<SearchableSelect value="" onChange={() => undefined} options={local.map(option)} serverSearchUrl="/personnel" mapResultToOption={option} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'قدیمی' } });
    expect(screen.getByText('در حال جست‌وجو...')).toBeTruthy();
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    await waitFor(() => expect(screen.getByText('جست‌وجو در سرور انجام نشد؛ دوباره بنویسید.')).toBeTruthy());
    error.mockRestore();
  });

  it('moves the voucher row on with Enter on the closed picker of a cut list, as the plain list does, and names it', () => {
    const onAdvance = vi.fn();
    const value = { detailedType: 'personnel' as const, detailedId: null, detailedName: '' };
    render(<VoucherDetailedPicker value={value} onChange={() => undefined} onAdvance={onAdvance} customers={[]} personnelList={many(PERSONNEL_PICK_LIMIT)} />, { wrapper });
    const button = screen.getByRole('button', { name: 'انتخاب پرسنل' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('wires the server search into every picker fed by a capped personnel list', () => {
    const files = [
      'src/components/accounting/treasury/TreasuryTransactionModal.tsx', 'src/components/accounting/ChequesTab.tsx',
      'src/components/accounting/AccountExplorerTab.tsx', 'src/components/accounting/VoucherDetailedPicker.tsx',
      'src/components/crm/CRMLeadModal.tsx', 'src/components/crm/CRMInteractionModal.tsx', 'src/components/crm/CRMFollowupsPanel.tsx',
      'src/components/crm/CRMFunnelReport.tsx', 'src/pages/CRMPage.tsx',
    ];
    for (const file of files) expect(readFileSync(file, 'utf8'), file).toContain('personnelServerSearchUrl(');
  });
});
