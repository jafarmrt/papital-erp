import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { ownReads } from './helpers/ownReads';
import { earlier, fetchJson, newClient, reads, readsOf, resetServer, server, toastError, wrapperOf, type Opts } from './helpers/printInboxServer';

/**
 * 10.3 (ARCH review finding 3, part 15): the approval inbox reads the task's document (with its lines' stock) or
 * requisition through the shared cache, under the record's own key, again whenever it shows a record and never what an
 * earlier showing read; a document or procurement change refreshes it.
 */
/** Persian words the tests compare with, kept apart from the assertions (AGENTS §6, terminal English) */
const SHOWN = { requisitionNotRead: 'درخواست خرید خوانده نشد؛ دوباره باز کنید.' } as const;

vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/printInboxServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: Opts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('react-hot-toast', async () => {
  const { toastError: error } = await import('./helpers/printInboxServer');
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: (m: string) => error(m), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

import { useApprovalTaskEntity, type ApprovalTaskEntityRef } from '../../hooks/useApprovalTaskEntity';
import { QUERY_KEYS } from '../../lib/queryKeys';

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  toastError.mockClear();
  resetServer();
});

const docTask = (id: number, row: Partial<ApprovalTaskEntityRef> = {}): ApprovalTaskEntityRef => ({ id, entityType: 'document', entityId: 21, ...row });
const requisitionTask = (id: number): ApprovalTaskEntityRef => ({ id, entityType: 'purchase_requisition', entityId: 31 });
const entityOf = (client: QueryClient, task: ApprovalTaskEntityRef | null) =>
  renderHook(({ t }) => useApprovalTaskEntity(t), { wrapper: wrapperOf(client), initialProps: { t: task } });

describe('the approval inbox reads the task\'s record through the shared cache (10.3)', () => {
  it('never shows the document an earlier opening left; the row\'s summary until this opening\'s answer', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.documents.detail(21), { id: 21, refNumber: 'F-21', buyer_name: 'stale buyer', items: [] }, earlier());
    reads.hold = '/documents/21';
    const { result } = entityOf(client, docTask(1, { buyerName: 'row buyer', refNumber: 'F-21' }));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    // the line stock has answered by now, so only the document's own read keeps the summary on screen
    await waitFor(() => expect(readsOf('/documents/21/line-stock')).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.docDetails?.buyer_name).toBe('row buyer');
    expect(result.current.isLoadingDoc).toBe(true);
    await act(async () => { reads.held[0]?.(server.document); });
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    expect(result.current.isLoadingDoc).toBe(false);
    expect(result.current.docDetails?.lineStock).toEqual(server.lineStock);
  });

  it('a document change refreshes the document of the open task', async () => {
    const client = newClient();
    const { result } = entityOf(client, docTask(1));
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    server.document = { ...server.document, buyer_name: 'changed buyer' };
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.documents.all }); });
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('changed buyer'));
  });

  it('shows the document with its lines\' stock, not before the stock is read', async () => {
    reads.hold = '/documents/21/line-stock';
    const { result } = entityOf(newClient(), docTask(1, { buyerName: 'row buyer' }));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    await waitFor(() => expect(readsOf('/documents/21')).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.docDetails?.buyer_name).toBe('row buyer');
    expect(result.current.isLoadingDoc).toBe(true);
    await act(async () => { reads.held[0]?.({ data: server.lineStock }); });
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    expect(result.current.docDetails?.lineStock).toEqual(server.lineStock);
  });

  it('a failed line stock read only hides the stock', async () => {
    reads.fail = '/documents/21/line-stock';
    const { result } = entityOf(newClient(), docTask(1));
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    expect(result.current.docDetails?.lineStock).toEqual([]);
  });

  it('a failed document read keeps the row\'s summary without a message, or says so when the row has none', async () => {
    reads.fail = '/documents/21';
    const withSummary = entityOf(newClient(), docTask(1, { buyerName: 'row buyer' }));
    await waitFor(() => expect(withSummary.result.current.isLoadingDoc).toBe(false));
    expect(withSummary.result.current.docDetails?.buyer_name).toBe('row buyer');
    expect(toastError).not.toHaveBeenCalled();
    reads.fail = '/documents/21';
    const bare = entityOf(newClient(), docTask(2));
    await waitFor(() => expect(bare.result.current.isLoadingDoc).toBe(false));
    expect(bare.result.current.docDetails).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('server refused the read');
  });

  it('a failed refresh keeps the document on screen without a message', async () => {
    const client = newClient();
    const { result } = entityOf(client, docTask(1));
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    reads.fail = '/documents/21';
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.documents.all }); });
    await waitFor(() => expect(readsOf('/documents/21')).toBe(2));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.docDetails?.buyer_name).toBe('buyer');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('another task of the requisition on screen keeps it there', async () => {
    const { result, rerender } = entityOf(newClient(), requisitionTask(1));
    await waitFor(() => expect(result.current.requisitionDetails?.status).toBe('pending'));
    rerender({ t: requisitionTask(2) });
    expect(result.current.requisitionDetails?.status).toBe('pending');
    expect(result.current.isLoadingRequisition).toBe(false);
  });

  it('another requisition is shown only once it is read for this showing', async () => {
    const client = newClient();
    const { result, rerender } = entityOf(client, requisitionTask(1));
    await waitFor(() => expect(result.current.requisitionDetails?.status).toBe('pending'));
    await new Promise(resolve => setTimeout(resolve, 5));
    // read elsewhere after this task opened, but before the inbox shows it
    client.setQueryData(QUERY_KEYS.procurement.requisition(32), { id: 32, code: 'PR-32', status: 'stale' });
    await new Promise(resolve => setTimeout(resolve, 5));
    reads.hold = '/api/procurement/requisitions/32';
    rerender({ t: { id: 2, entityType: 'purchase_requisition', entityId: 32 } });
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(result.current.requisitionDetails).toBeNull();
    await act(async () => { reads.held[0]?.({ data: { id: 32, code: 'PR-32', status: 'pending' } }); });
    await waitFor(() => expect(result.current.requisitionDetails?.code).toBe('PR-32'));
  });

  it('never shows the requisition an earlier opening left, and a procurement change refreshes it', async () => {
    const client = newClient();
    client.setQueryData(QUERY_KEYS.procurement.requisition(31), { id: 31, code: 'PR-31', status: 'stale' }, earlier());
    reads.hold = '/api/procurement/requisitions/31';
    const { result } = entityOf(client, requisitionTask(1));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    expect(result.current.requisitionDetails).toBeNull();
    expect(result.current.isLoadingRequisition).toBe(true);
    await act(async () => { reads.held[0]?.({ data: server.requisition }); });
    await waitFor(() => expect(result.current.requisitionDetails?.status).toBe('pending'));
    server.requisition = { ...server.requisition, status: 'approved' };
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.procurement.all }); });
    await waitFor(() => expect(result.current.requisitionDetails?.status).toBe('approved'));
  });

  it('a failed requisition read says why once and stops loading', async () => {
    reads.fail = '/api/procurement/requisitions/31';
    const { result } = entityOf(newClient(), requisitionTask(1));
    await waitFor(() => expect(result.current.isLoadingRequisition).toBe(false));
    expect(result.current.requisitionDetails).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('server refused the read');
  });

  it('opening the same task again reads its document again', async () => {
    const client = newClient();
    const { result, rerender } = entityOf(client, docTask(1));
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    rerender({ t: null });
    server.document = { ...server.document, buyer_name: 'later buyer' };
    rerender({ t: docTask(1) });
    expect(result.current.docDetails?.buyer_name).not.toBe('buyer');
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('later buyer'));
  });

  it('a failed refresh keeps the requisition on screen without a message', async () => {
    const client = newClient();
    const { result } = entityOf(client, requisitionTask(1));
    await waitFor(() => expect(result.current.requisitionDetails?.status).toBe('pending'));
    reads.fail = '/api/procurement/requisitions/31';
    await act(async () => { await client.invalidateQueries({ queryKey: QUERY_KEYS.procurement.all }); });
    await waitFor(() => expect(readsOf('/api/procurement/requisitions/31')).toBe(2));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.requisitionDetails?.status).toBe('pending');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('an answer for another requisition is refused, never shown', async () => {
    reads.hold = '/api/procurement/requisitions/31';
    const { result } = entityOf(newClient(), requisitionTask(1));
    await waitFor(() => expect(reads.held).toHaveLength(1));
    await act(async () => { reads.held[0]?.({ data: { id: 99, code: 'PR-99', status: 'pending' } }); });
    await waitFor(() => expect(result.current.isLoadingRequisition).toBe(false));
    expect(result.current.requisitionDetails).toBeNull();
    expect(toastError).toHaveBeenCalledWith(SHOWN.requisitionNotRead);
  });

  it('an answer that holds no document keeps the row\'s summary', async () => {
    server.document = { items: [] };
    const { result } = entityOf(newClient(), docTask(1, { buyerName: 'row buyer' }));
    await waitFor(() => expect(result.current.isLoadingDoc).toBe(false));
    expect(result.current.docDetails?.buyer_name).toBe('row buyer');
  });

  it('a task with no entity type reads its document', async () => {
    const { result } = entityOf(newClient(), { id: 1, entityId: 21 });
    await waitFor(() => expect(result.current.docDetails?.buyer_name).toBe('buyer'));
    expect(result.current.requisitionDetails).toBeNull();
  });

  it('the inbox makes no read of its own', () => {
    expect(ownReads('hooks/useApprovalTaskEntity.ts')).toEqual([]);
  });
});
