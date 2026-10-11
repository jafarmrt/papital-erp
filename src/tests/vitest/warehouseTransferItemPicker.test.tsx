import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import WarehouseTransferModal from '../../components/WarehouseTransferModal';

// Package 6 ledger (OBS-R1-86): the warehouse transfer window picks its item through the item pick list's server
// search. On v10.0.25 it loaded GET /items/options without a search or limit, so every item of the catalog came down
// before the window opened.
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('warehouse transfer item picker (OBS-R1-86)', () => {
  it('asks the item pick list with a limit and never loads the whole catalog', async () => {
    fetchJson.mockImplementation(async (url: string) => {
      if (url === '/warehouses') return [{ code: 'A', name: 'انبار الف' }, { code: 'B', name: 'انبار ب' }];
      if (url.startsWith('/documents/next-ref')) return { nextRef: '5' };
      return { data: [] };
    });
    render(<WarehouseTransferModal isOpen onClose={() => undefined} onSuccess={() => undefined} />);
    await waitFor(() => expect(fetchJson.mock.calls.some(([url]) => String(url).startsWith('/items/options'))).toBe(true), { timeout: 3000 });
    const itemCalls = fetchJson.mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('/items/options'));
    for (const url of itemCalls) {
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      expect(Number(params.get('limit'))).toBeGreaterThan(0);
    }
  });
});
