import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { ownReads } from './helpers/ownReads';
import { earlier, fetchJson, newClient, reads, readsOf, resetServer, server, toastError, wrapperOf, type Opts } from './helpers/printInboxServer';

/**
 * 10.3 (ARCH review finding 3, part 15): the invoice print reads the company's settings and the document's signatures
 * through the shared cache, again on every opening and never printing what an earlier opening read; a settings save or an
 * approval refreshes an open print.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = { defaultName: 'سامانه جامع مدیریت کارگاه پاپیتال' } as const;

vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/printInboxServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: Opts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('react-hot-toast', async () => {
  const { toastError: error } = await import('./helpers/printInboxServer');
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => error(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import InvoicePrintView from '../../components/InvoicePrintView';
import { QUERY_KEYS, settingsKeys } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  resetServer();
});

const DOC = { id: 21, ref_number: 'F-21', type: 'invoice', date: '2026-10-01 10:00:00', status: 'final', currency: 'IRR', buyer_name: 'buyer', items: [] };
const printIn = (client: QueryClient) => render(<InvoicePrintView printedDoc={DOC} />, { wrapper: wrapperOf(client) });

describe('the invoice print reads through the shared cache (10.3)', () => {
  it('never prints the signatures an earlier opening left while they are read again', async () => {
    const client = newClient();
    client.setQueryData([...QUERY_KEYS.documents.detail(21), 'signatures'], [{ name: 'stale signer', roleTitle: 'r', date: '2026-10-01' }], earlier());
    reads.hold = '/accounting/doc-signatures';
    printIn(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale signer')).toBeNull();
    await act(async () => { reads.held[0]?.({ signatures: server.signatures }); });
    expect(await screen.findByText('fresh signer')).toBeTruthy();
  });

  it('an approval while the print is open adds its signature', async () => {
    const client = newClient();
    printIn(client);
    expect(await screen.findByText('fresh signer')).toBeTruthy();
    server.signatures = [...server.signatures, { name: 'second signer', roleTitle: 'director', date: '2026-10-07' }];
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.documents.all }); });
    expect(await screen.findByText('second signer')).toBeTruthy();
  });

  it('never prints the seller phone an earlier opening read while it reads the settings again', async () => {
    const client = newClient();
    client.setQueryData(settingsKeys.all, [{ key: 'company_phone', value: '02199999999' }], earlier());
    reads.hold = '/settings';
    printIn(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText(/۰۲۱۹۹۹۹۹۹۹۹/)).toBeNull();
    await act(async () => { reads.held[0]?.(server.settings); });
    expect(await screen.findByText(/۰۲۱۱۲۳۴۵۶۷۸/)).toBeTruthy();
    expect(readsOf('/settings')).toBe(1);
  });

  it('never prints the company name an earlier opening read; the default name until this opening\'s answer', async () => {
    const client = newClient();
    client.setQueryData([...settingsKeys.all, 'public'], { companyName: 'stale workshop', settings: [] }, earlier());
    reads.hold = '/public-settings';
    printIn(client);
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(screen.queryByText('stale workshop')).toBeNull();
    expect(screen.getAllByText(SHOWN.defaultName).length).toBeGreaterThan(0);
    await act(async () => { reads.held[0]?.(server.publicSettings); });
    expect((await screen.findAllByText('workshop')).length).toBeGreaterThan(0);
  });

  it('a settings save refreshes the seller phone and the company name of an open print', async () => {
    const client = newClient();
    printIn(client);
    expect(await screen.findByText(/۰۲۱۱۲۳۴۵۶۷۸/)).toBeTruthy();
    server.settings = [{ key: 'company_phone', value: '02187654321' }];
    server.publicSettings = { ...server.publicSettings, companyName: 'renamed workshop' };
    await act(async () => { await client.invalidateQueries({ queryKey: settingsKeys.all }); });
    expect(await screen.findByText(/۰۲۱۸۷۶۵۴۳۲۱/)).toBeTruthy();
    expect((await screen.findAllByText('renamed workshop')).length).toBeGreaterThan(0);
  });

  it('a failed settings list still prints the public company name', async () => {
    reads.fail = '/settings';
    printIn(newClient());
    expect((await screen.findAllByText('workshop')).length).toBeGreaterThan(0);
  });

  it('a print view that stays mounted reads nothing while it shows no document, and reads when one arrives', async () => {
    const client = newClient();
    const { rerender } = render(<InvoicePrintView printedDoc={null} />, { wrapper: wrapperOf(client) });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(readsOf('/settings') + readsOf('/public-settings')).toBe(0);
    rerender(<InvoicePrintView printedDoc={DOC} />);
    expect((await screen.findAllByText('workshop')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/۰۲۱۱۲۳۴۵۶۷۸/)).toBeTruthy();
  });

  it('makes no read of its own', () => {
    expect(ownReads('components/InvoicePrintView.tsx')).toEqual([]);
  });
});
