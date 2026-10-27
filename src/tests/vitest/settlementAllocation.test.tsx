import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { SettlementAllocationField, type SettlementFieldState } from '../../components/accounting/treasury/SettlementAllocationField';
import {
  canAllocateCheque, fillOldestFirst, settlementPartsFor, settlementPartsProblem, type OpenSettlementDocument,
} from '../../lib/treasury/settlementAllocation';
import { renderWithQuery } from './helpers/queryWrapper';

// v11 phase 6.1t (M11 / U2, decision ت۵۲-۵): the browser half of putting a receipt or cheque on the party's invoices: the
// default split (oldest first), the user's own split, what the form refuses before sending, and the field of the forms.

// Persian text the form shows
const DRAFT_NOTE = 'پیش‌نویس است';

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const doc = (id: number, remaining: number, allocatedHere = 0): OpenSettlementDocument => ({
  id, refNumber: String(1000 + id), type: 'invoice', status: 'final', date: `2026-10-0${id}`, currency: 'IRR',
  payable: remaining, settled: 0, remaining, allocatedHere,
});

describe('the default split puts the amount on the oldest documents first', () => {
  it('fills each document up to what it has left and keeps the rest on account', () => {
    expect(fillOldestFirst([doc(1, 300), doc(2, 500), doc(3, 200)], 600)).toEqual([{ documentId: 1, amount: 300 }, { documentId: 2, amount: 300 }]);
    expect(fillOldestFirst([doc(1, 300)], 1_000)).toEqual([{ documentId: 1, amount: 300 }]);
  });

  it('counts what this receipt already puts on a document as room on it', () => {
    expect(fillOldestFirst([doc(1, 0, 250), doc(2, 100)], 300)).toEqual([{ documentId: 1, amount: 250 }, { documentId: 2, amount: 50 }]);
  });

  it('fills a remaining of more than four decimals at the four decimals the server stores and compares', () => {
    expect(fillOldestFirst([doc(1, 1500.00015)], 2_000)).toEqual([{ documentId: 1, amount: 1500.0002 }]);
    expect(settlementPartsProblem([{ documentId: 1, amount: 1500.0002 }], 2_000, [doc(1, 1500.00015)])).toBeNull();
  });

  it('keeps decimals exact', () => {
    expect(fillOldestFirst([doc(1, 0.1), doc(2, 0.2)], 0.3)).toEqual([{ documentId: 1, amount: 0.1 }, { documentId: 2, amount: 0.2 }]);
  });
});

describe('the parts the form sends in each mode', () => {
  const docs = [doc(1, 300), doc(2, 500)];
  it('sends nothing with everything on account, the default split by default, and the user\'s own parts by hand', () => {
    expect(settlementPartsFor('none', docs, 600, [])).toEqual([]);
    expect(settlementPartsFor('oldest', docs, 600, [])).toEqual([{ documentId: 1, amount: 300 }, { documentId: 2, amount: 300 }]);
    expect(settlementPartsFor('manual', docs, 600, [{ documentId: 2, amount: 100 }, { documentId: 9, amount: 50 }, { documentId: 1, amount: 0 }]))
      .toEqual([{ documentId: 2, amount: 100 }]);
  });

  it('refuses more than the amount, or more than a document has left', () => {
    expect(settlementPartsProblem([{ documentId: 1, amount: 300 }, { documentId: 2, amount: 400 }], 600, docs)).toContain('از مبلغ بیشتر است');
    expect(settlementPartsProblem([{ documentId: 1, amount: 301 }], 600, docs)).toContain('۱۰۰۱');
    expect(settlementPartsProblem([{ documentId: 1, amount: 300 }], 600, docs)).toBeNull();
  });

  it('keeps or lowers the part on a draft this receipt already settles, but never raises it (second review of M11)', () => {
    const draft = { ...doc(3, 700, 300), status: 'draft' };
    expect(fillOldestFirst([draft, doc(4, 500)], 1_000)).toEqual([{ documentId: 3, amount: 300 }, { documentId: 4, amount: 500 }]);
    expect(settlementPartsProblem([{ documentId: 3, amount: 300 }], 1_000, [draft])).toBeNull();
    expect(settlementPartsProblem([{ documentId: 3, amount: 200 }], 1_000, [draft])).toBeNull();
    expect(settlementPartsProblem([{ documentId: 3, amount: 301 }], 1_000, [draft])).toContain(DRAFT_NOTE);
  });

  it('offers a cheque that has not come back, from a customer or to a supplier', () => {
    expect(canAllocateCheque({ type: 'received', partyType: 'customer', status: 'received' })).toBe(true);
    expect(canAllocateCheque({ type: 'paid', partyType: 'supplier', status: 'passed' })).toBe(true);
    expect(canAllocateCheque({ type: 'received', partyType: 'customer', status: 'bounced' })).toBe(false);
    expect(canAllocateCheque({ type: 'received', partyType: 'other', status: 'received' })).toBe(false);
  });
});

describe('the field of the receipt and cheque forms', () => {
  const query = { direction: 'receipt' as const, partyType: 'customer', partyId: 7, partyName: 'Rose', currency: 'IRR' };

  it('holds the form back while the list loads, then reports the oldest-first parts', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchJson.mockImplementation(() => new Promise(r => { resolve = r; }));
    const states: SettlementFieldState[] = [];
    renderWithQuery(<SettlementAllocationField query={query} amount={600} currency="IRR" appCurrency="IRR" partyLabel="مشتری" onChange={s => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.problem).toContain('هنوز خوانده می‌شود'));
    expect(String(fetchJson.mock.calls[0]?.[0])).toContain('partyId=7');
    resolve({ success: true, data: [doc(1, 300), doc(2, 500)] });
    await waitFor(() => expect(states.at(-1)).toEqual({ parts: [{ documentId: 1, amount: 300 }, { documentId: 2, amount: 300 }], problem: null }));
  });

  it('puts everything on account when the user asks, and lets the user pick documents', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [doc(1, 300), doc(2, 500)] });
    const states: SettlementFieldState[] = [];
    renderWithQuery(<SettlementAllocationField query={query} amount={600} currency="IRR" appCurrency="IRR" partyLabel="مشتری" onChange={s => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.parts.length).toBe(2));
    fireEvent.click(screen.getByRole('radio', { name: 'همه علی‌الحساب' }));
    await waitFor(() => expect(states.at(-1)).toEqual({ parts: [], problem: null }));
    fireEvent.click(screen.getByRole('radio', { name: 'انتخاب سندها' }));
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[1]);
    await waitFor(() => expect(states.at(-1)).toEqual({ parts: [{ documentId: 2, amount: 500 }], problem: null }));
  });

  it('says so when the party has no open document', async () => {
    fetchJson.mockResolvedValue({ success: true, data: [] });
    const states: SettlementFieldState[] = [];
    renderWithQuery(<SettlementAllocationField query={query} amount={600} currency="IRR" appCurrency="IRR" partyLabel="مشتری" onChange={s => states.push(s)} />);
    await waitFor(() => expect(screen.getByText(/فاکتور بازی از این مشتری/)).toBeTruthy());
    expect(states.at(-1)).toEqual({ parts: [], problem: null });
  });
});
