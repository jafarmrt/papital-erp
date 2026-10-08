/**
 * v9.0.417 (TD-728, B15-26 / FE-05): the webhook form is sent once. On v9.0.416 its submit button was never disabled, so a
 * double click sent two POSTs and made two subscriptions, and every event was then delivered twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchJson } from '../../api';
import { WebhookManagementSubTab } from '../../components/settings/WebhookManagementSubTab';

vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'events.manage' }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const CREATE = 'ایجاد و فعال‌سازی درگاه وب‌هوک';

describe('TD-728 the webhook form saves once', () => {
  it('a double click sends one POST and the button stays disabled until the answer', async () => {
    let answer: (value: unknown) => void = () => {};
    const posts: string[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
      if ((opts?.method || 'GET') === 'POST') {
        posts.push(url);
        return new Promise(resolve => { answer = resolve; });
      }
      if (url === '/events/webhooks') return { success: true, data: [] };
      return { success: true, data: [], stats: null };
    });
    render(<WebhookManagementSubTab />);
    fireEvent.click(await screen.findByText('تعریف وب‌هوک جدید'));
    fireEvent.change(screen.getByPlaceholderText('مثال: فروشگاه برخط ووکامرس'), { target: { value: 'شریک تازه' } });
    fireEvent.change(screen.getByPlaceholderText('https://your-domain.com/api/webhook/receiver'), { target: { value: 'https://new.example.com/hook' } });
    const submit = screen.getByText(CREATE).closest('button') as HTMLButtonElement;
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(posts).toEqual(['/events/webhooks']));
    expect(submit.disabled).toBe(true);
    await act(async () => { answer({ success: true, message: 'ذخیره شد', data: { name: 'شریک تازه' } }); });
    expect(posts).toHaveLength(1);
  });
});
