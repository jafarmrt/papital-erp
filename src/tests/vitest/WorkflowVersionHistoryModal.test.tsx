import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowVersionHistoryModal } from '../../components/workflow/WorkflowVersionHistoryModal';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

const versions = [
  {
    id: 12, definitionId: 7, version: 2, title: 'تایید فاکتور', description: 'ذخیره تغییرات طرح فرآیند', createdAt: '2026-10-02T10:00:00Z',
    dslJson: {
      states: [{ id: 21, stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' }, { id: 22, stateKey: 'ok', title: 'تایید شده', stateType: 'terminal' }, { id: 23, stateKey: 'no', title: 'رد شده', stateType: 'terminal' }],
      transitions: [{ id: 31, fromStateId: 21, toStateId: 22, title: 'تایید' }, { id: 32, fromStateId: 21, toStateId: 23, title: 'رد', requiredRole: 'manager' }],
    },
  },
  {
    id: 11, definitionId: 7, version: 1, title: 'تایید فاکتور', description: 'ایجاد فرآیند', createdAt: '2026-10-01T10:00:00Z',
    dslJson: {
      states: [{ id: 1, stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' }, { id: 2, stateKey: 'ok', title: 'تایید شده', stateType: 'terminal' }],
      transitions: [{ id: 3, fromStateId: 1, toStateId: 2, title: 'تایید' }],
    },
  },
];

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowVersionHistoryModal definitionId={7} title="تایید فاکتور" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('WorkflowVersionHistoryModal (TD-112)', () => {
  it('lists the versions of the definition and shows the newest one first', async () => {
    fetchJson.mockResolvedValue(versions);
    renderModal();
    expect(await screen.findByText('نسخه ۲')).toBeTruthy();
    expect(screen.getByText('نسخه ۱')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/workflow/definitions/7/versions');
    expect(screen.getByText('وضعیت‌ها (۳)')).toBeTruthy();
    expect(screen.getByText('رد شده (پایان)')).toBeTruthy();
  });

  it('shows the states and transitions of the version the user selects', async () => {
    fetchJson.mockResolvedValue(versions);
    renderModal();
    fireEvent.click(await screen.findByText('نسخه ۱'));
    expect(screen.getByText('وضعیت‌ها (۲)')).toBeTruthy();
    expect(screen.getByText('انتقال‌ها (۱)')).toBeTruthy();
    expect(screen.queryByText('رد شده (پایان)')).toBeNull();
  });

  it('offers no publish or rollback action', async () => {
    fetchJson.mockResolvedValue(versions);
    renderModal();
    await screen.findByText('نسخه ۲');
    expect(screen.queryByText(/بازگردانی|انتشار/)).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['', expect.stringContaining('نسخه ۲'), expect.stringContaining('نسخه ۱')]);
  });
});
