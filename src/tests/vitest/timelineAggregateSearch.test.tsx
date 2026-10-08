/**
 * v9.0.395 (TD-731, B15-29 / FE-21): the timeline tab's aggregate search waits for the user to stop typing and asks the
 * server once for the settled keyword, and a newer keyword aborts the older request, so a late answer for an older keyword
 * never overwrites the list of a newer one. On v9.0.394 every keystroke sent a request and the last answer to arrive won:
 * the answer for «ف» arriving after the answer for «فا» replaced its list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchJson } from '../../api';
import { EventSourcingReplaySubTab } from '../../components/settings/EventSourcingReplaySubTab';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

type Answer = (value: unknown) => void;

/** Aggregate searches with a keyword stay pending until the test answers them; everything else answers at once. */
function mockServer() {
  const pending: Record<string, Answer> = {};
  const searches: string[] = [];
  vi.mocked(fetchJson).mockImplementation((url: string) => {
    if (url.startsWith('/events/event-sourcing/types')) return Promise.resolve({ success: true, types: [] });
    if (url.startsWith('/events/event-sourcing/aggregates')) {
      const search = new URLSearchParams(url.split('?')[1]).get('search') || '';
      if (search === '') return Promise.resolve({ success: true, data: [] });
      searches.push(search);
      return new Promise(resolve => { pending[search] = resolve; });
    }
    return Promise.resolve({ success: true, timeline: [] });
  });
  return { pending, searches };
}

const optionTexts = () => Array.from(document.querySelectorAll('option')).map(o => o.textContent);

describe('TD-731 timeline aggregate search', () => {
  it('typing two letters quickly asks the server once, for the settled keyword', async () => {
    const { searches } = mockServer();
    render(<EventSourcingReplaySubTab />);
    const input = screen.getByPlaceholderText(/جستجو با کد یا عنوان/);
    fireEvent.change(input, { target: { value: 'ف' } });
    fireEvent.change(input, { target: { value: 'فا' } });
    expect(searches).toEqual([]);
    await waitFor(() => expect(searches).toEqual(['فا']));
  });

  it('a late answer for an older keyword does not overwrite the list of the newer keyword', async () => {
    const { pending, searches } = mockServer();
    render(<EventSourcingReplaySubTab />);
    const input = screen.getByPlaceholderText(/جستجو با کد یا عنوان/);
    fireEvent.change(input, { target: { value: 'ف' } });
    await waitFor(() => expect(searches).toEqual(['ف']));
    fireEvent.change(input, { target: { value: 'فا' } });
    await waitFor(() => expect(searches).toEqual(['ف', 'فا']));
    await act(async () => { pending['فا']({ success: true, data: [{ id: '2', title: 'فاکتور ۲' }] }); });
    await act(async () => { pending['ف']({ success: true, data: [{ id: '1', title: 'فرم ۱' }] }); });
    expect(optionTexts()).toContain('فاکتور ۲');
    expect(optionTexts()).not.toContain('فرم ۱');
  });
});
