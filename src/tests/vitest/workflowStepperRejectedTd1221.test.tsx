import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowStepperWidget } from '../../components/workflow/WorkflowStepperWidget';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

// v10.0.86 (TD-1221): a proforma the warehouse rejected; the seller is offered «بازگشایی مجدد جهت اصلاح»
const states = [
  { id: 1, stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial', color: 'gray', stepOrder: 1 },
  { id: 2, stateKey: 'warehouse_review', title: 'بررسی انبار', stateType: 'normal', color: 'amber', stepOrder: 2 },
  { id: 3, stateKey: 'accounting_review', title: 'بررسی و ثبت مالی', stateType: 'normal', color: 'sky', stepOrder: 3 },
  { id: 4, stateKey: 'approved', title: 'تایید نهایی', stateType: 'terminal', color: 'emerald', stepOrder: 4 },
  { id: 5, stateKey: 'rejected', title: 'رد شده', stateType: 'terminal', color: 'rose', stepOrder: 5 },
];
const rejectedResponse = {
  instance: { id: 7, workflowDefinitionId: 2, definitionVersion: 4, entityType: 'document', entityId: '9', currentStateId: 5, status: 'REJECTED' },
  definition: { id: 2, code: 'DOC_APPROVAL_WORKFLOW', title: 'تأیید اسناد', entityType: 'document', version: 4 },
  currentState: states[4],
  allStates: states,
  availableTransitions: [{ id: 31, fromStateId: 5, toStateId: 1, actionKey: 'reopen', title: 'بازگشایی مجدد جهت اصلاح', approvalRuleType: 'SINGLE', conditions: [], conditionsMatch: 'AND' }],
  blockedTransitions: [],
  history: [
    { id: 1, fromStateId: 1, toStateId: 2, actionKey: 'submit_to_warehouse' },
    { id: 2, fromStateId: 2, toStateId: 5, actionKey: 'reject' },
  ],
  approvalProgress: {},
  entityContext: {},
};

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowStepperWidget entityType="document" entityId={9} workflowCode="DOC_APPROVAL_WORKFLOW" />
    </QueryClientProvider>,
  );
}

const stepBadge = (title: string) => screen.getByText(title).closest('[data-step-key]') as HTMLElement;

describe('rejected workflow in the stepper (TD-1221)', () => {
  it('offers the reopen action of a rejected workflow', async () => {
    fetchJson.mockResolvedValue(rejectedResponse);
    renderWidget();
    expect(await screen.findByText('بازگشایی مجدد جهت اصلاح')).toBeTruthy();
  });

  it('marks the steps the document never reached as not reached, not passed', async () => {
    fetchJson.mockResolvedValue(rejectedResponse);
    renderWidget();
    await screen.findByText('بررسی و ثبت مالی');
    expect(screen.queryByText('عبورکرده')).toBeNull();
    for (const title of ['بررسی و ثبت مالی', 'تایید نهایی']) {
      expect(within(stepBadge(title)).getByText('نرسیده')).toBeTruthy();
    }
    for (const title of ['پیش‌نویس', 'بررسی انبار']) {
      expect(within(stepBadge(title)).getByText('تکمیل‌شده')).toBeTruthy();
    }
    expect(within(stepBadge('رد شده')).getByText('ردشده')).toBeTruthy();
  });
});
