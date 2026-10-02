import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowStepperWidget } from '../../components/workflow/WorkflowStepperWidget';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// شکل پاسخ GET /workflow/instance/:entityType/:entityId از v7.0.88
const instanceResponse = {
  instance: { id: 5, workflowDefinitionId: 2, definitionVersion: 3, entityType: 'document', entityId: '9', currentStateId: 11, status: 'IN_PROGRESS' },
  definition: { id: 2, code: 'DOC', title: 'تایید سه‌مرحله‌ای', entityType: 'document', version: 3 },
  currentState: { id: 11, stateKey: 'finance', title: 'تایید مالی', stateType: 'normal', color: 'amber', stepOrder: 2 },
  allStates: [
    { id: 10, stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial', color: 'gray', stepOrder: 1 },
    { id: 11, stateKey: 'finance', title: 'تایید مالی', stateType: 'normal', color: 'amber', stepOrder: 2 },
    { id: 12, stateKey: 'done', title: 'تایید شده', stateType: 'terminal', color: 'emerald', stepOrder: 3 },
  ],
  availableTransitions: [{ id: 21, fromStateId: 11, toStateId: 12, actionKey: 'approve', title: 'تایید مالی نهایی', approvalRuleType: 'AND_ALL' }],
  history: [],
  approvalProgress: { 21: { approvalRuleType: 'AND_ALL', requiredCount: 3, signatures: [{ userId: 1, userName: 'مدیر مالی', signedAt: '2026-10-02T10:00:00Z' }], status: 'PENDING' } },
  entityContext: {},
};

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowStepperWidget entityType="document" entityId={9} workflowCode="DOC" />
    </QueryClientProvider>,
  );
}

describe('WorkflowStepperWidget (TD-085)', () => {
  it('shows the running workflow with its steps and current action instead of the start button', async () => {
    fetchJson.mockResolvedValue(instanceResponse);
    renderWidget();
    expect(await screen.findByText('تایید شده')).toBeTruthy();
    expect(screen.queryByText('شروع چرخه ورکفلو')).toBeNull();
    expect(screen.getByText('تایید مالی نهایی')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/workflow/instance/document/9');
  });

  it('shows signature progress against the required count recorded by the server', async () => {
    fetchJson.mockResolvedValue(instanceResponse);
    renderWidget();
    expect(await screen.findByText(/امضاهای ثبت‌شده \(1 از 3\)/)).toBeTruthy();
    expect(screen.getByText('1/3 امضا')).toBeTruthy();
  });

  it('offers to start the workflow when the document has none', async () => {
    fetchJson.mockResolvedValue({ instance: null });
    renderWidget();
    expect(await screen.findByText('شروع چرخه ورکفلو')).toBeTruthy();
  });
});
