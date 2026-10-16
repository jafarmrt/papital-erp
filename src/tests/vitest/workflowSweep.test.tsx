import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import type { WorkflowPreset } from '../../constants/presets';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t, toast: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1 }, userPermissions: { isAdmin: true } }),
  useHasPermission: () => true,
  useHasAnyPermission: () => true,
}));
const fetchJson = vi.fn();
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

import { useMyTasksQuery, useTaskStatsQuery } from '../../hooks/queries/useWorkflowQueries';
import { WorkflowCreateModal } from '../../components/workflow/WorkflowCreateModal';
import { WorkflowDelegationTab } from '../../components/workflow/WorkflowDelegationTab';
import { WorkflowPresetsTab } from '../../components/settings/WorkflowPresetsTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); fetchJson.mockReset(); });

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const withClient = (client: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const BLANK_MODE = 'طرح خالی';
const TITLE_LABEL = /عنوان گردش کار/;
const CODE_LABEL = /کد یکتا/;
const CREATE_BUTTON = 'ساخت و ورود به طراح';
const REVOKE_TITLE = 'لغو تفویض اختیار';
const ARCHIVE_TITLE = 'انتقال به آرشیو (عدم نمایش در کنترل پروژه)';
const PRESET_TITLE = 'الگوی آزمون';
const STAGE_TITLE = 'برش';

describe('OBS-R2-70 the inbox polls once a minute, only while the tab is visible, and asks at most 100 rows', () => {
  it('my tasks and task stats poll every 60 s without background polling', async () => {
    fetchJson.mockResolvedValue({ data: [], total: 0 });
    const client = newClient();
    renderHook(() => { useMyTasksQuery('pending', 1, 1000); useTaskStatsQuery(); }, { wrapper: withClient(client) });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    const queries = client.getQueryCache().findAll({ queryKey: ['workflow', 'tasks'] });
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      const options = query.observers[0]?.options as { refetchInterval?: number; refetchIntervalInBackground?: boolean };
      expect(options.refetchInterval).toBeGreaterThanOrEqual(60_000);
      expect(options.refetchIntervalInBackground).toBe(false);
    }
    const inboxUrl = String(fetchJson.mock.calls.map(c => c[0]).find(url => String(url).includes('my-tasks')));
    expect(inboxUrl).toContain('limit=100');
  });
});

describe('OBS-R2-77 workflow screens show one message, catch a refused revoke and never write state in place', () => {
  it('a blank workflow saved inactive shows exactly one message', async () => {
    fetchJson.mockResolvedValue({ success: true, data: { id: 5, isActive: 0 } });
    render(<WorkflowCreateModal onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: withClient(newClient()) });
    fireEvent.click(screen.getByText(BLANK_MODE));
    fireEvent.change(screen.getByLabelText(TITLE_LABEL), { target: { value: 'sweep' } });
    fireEvent.change(screen.getByLabelText(CODE_LABEL), { target: { value: 'SWEEP_WF' } });
    fireEvent.click(screen.getByText(CREATE_BUTTON));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    const shown = vi.mocked(toast).mock.calls.length + vi.mocked(toast.success).mock.calls.length + vi.mocked(toast.error).mock.calls.length;
    expect(shown).toBe(1);
  });

  it('a refused delegation revoke leaves no unhandled rejection', async () => {
    fetchJson.mockImplementation(async (url: string, opts?: RequestInit) => {
      if ((opts?.method || 'GET') === 'POST') throw new Error('refused by the server');
      if (url === '/workflow/delegations') {
        return { data: [{ id: 3, fromUserId: 1, fromUserName: 'a', toUserName: 'b', scope: 'ALL', status: 'active', startDate: '2026-10-01', endDate: '2026-10-30', reason: '' }] };
      }
      return { data: [] };
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      render(<WorkflowDelegationTab />, { wrapper: withClient(newClient()) });
      fireEvent.click(await screen.findByTitle(REVOKE_TITLE));
      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  function presetsHarness(initial: WorkflowPreset[]) {
    let latest: WorkflowPreset[] = initial;
    function Harness() {
      const [presets, setPresets] = useState<WorkflowPreset[]>(initial);
      latest = presets;
      return <WorkflowPresetsTab workflowPresets={presets} setWorkflowPresets={setPresets} isSaving={false} onSave={vi.fn()} />;
    }
    render(<StrictMode><Harness /></StrictMode>, { wrapper: withClient(newClient()) });
    return () => latest;
  }

  it('editing a preset and its stage builds new objects; the objects held before stay unchanged', async () => {
    fetchJson.mockResolvedValue([]);
    const stage = { title: STAGE_TITLE, isOptionalPerProduct: false, defaultTasks: [] };
    const original: WorkflowPreset = { id: 'p1', title: PRESET_TITLE, description: '', stages: [stage] };
    const current = presetsHarness([original]);
    fireEvent.change(screen.getByDisplayValue(PRESET_TITLE), { target: { value: 'changed preset' } });
    fireEvent.change(screen.getByDisplayValue(STAGE_TITLE), { target: { value: 'changed stage' } });
    await waitFor(() => expect(current()[0].title).toBe('changed preset'));
    expect(original.title).toBe(PRESET_TITLE);
    expect(stage.title).toBe(STAGE_TITLE);
    expect(original.stages[0]).toBe(stage);
    expect((current()[0].stages[0] as { title: string }).title).toBe('changed stage');
  });

  it('archiving a preset shows its message once, even when React runs the state updater twice', async () => {
    fetchJson.mockResolvedValue([]);
    const current = presetsHarness([{ id: 'p2', title: PRESET_TITLE, description: '', stages: [] }]);
    fireEvent.click(screen.getByTitle(ARCHIVE_TITLE));
    await waitFor(() => expect(current()[0].isArchived).toBe(true));
    expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1);
  });
});
