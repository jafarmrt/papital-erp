/**
 * v9.0.387 (TD-716, B15-14 / FE-18): the dead-letter tab offers «اصلاح داده و بازپخش» only for a row that has not been
 * replayed. On v9.0.386 it was offered for every status, including a replayed event that already ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fetchJson } from '../../api';
import { DeadLetterQueueSubTab } from '../../components/settings/DeadLetterQueueSubTab';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const EDIT_TITLE = 'اصلاح داده و بازپخش';
const row = (id: number, status: string) => ({
  id, originalEventId: `evt-${id}`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: String(id),
  source: 'outbox', payload: { documentId: id }, metadata: {}, failureReason: 'timeout', errorStack: '', retryCount: 5,
  status, quarantinedAt: '2026-10-06 10:00:00',
});

describe('TD-716 a replayed dead-letter row offers no payload edit', () => {
  it('shows the edit action for the quarantined and dismissed rows only', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.startsWith('/events/dlq/stats')) return { success: true, stats: { total: 3, quarantined: 1, replayed: 1, dismissed: 1, byEventType: {}, bySource: {} } };
      return { success: true, data: [row(1, 'quarantined'), row(2, 'replayed'), row(3, 'dismissed')] };
    });
    render(<DeadLetterQueueSubTab />);
    await screen.findAllByText('InvoiceApproved');
    expect(screen.getAllByTitle(EDIT_TITLE)).toHaveLength(2);
  });
});
