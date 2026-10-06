import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowStepperWidget } from '../../components/workflow/WorkflowStepperWidget';
import { formatPersianPrice } from '../../utils';

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
  availableTransitions: [{ id: 21, fromStateId: 11, toStateId: 12, actionKey: 'approve', title: 'تایید مالی نهایی', approvalRuleType: 'AND_ALL', conditions: ['ارز برابر IRR باشد'], conditionsMatch: 'AND' }],
  blockedTransitions: [{ id: 22, title: 'تایید کلان', actionKey: 'approve_big', conditions: ['مبلغ کل بیشتر از ۱۰۰ باشد'], conditionsMatch: 'AND', unmetConditions: ['مبلغ کل بیشتر از ۱۰۰ باشد (مقدار فعلی: ۵۰)'] }],
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
    expect(screen.queryByText('آغاز گردش کار')).toBeNull();
    expect(screen.getByText('تایید مالی نهایی')).toBeTruthy();
    expect(fetchJson).toHaveBeenCalledWith('/workflow/instance/document/9');
  });

  it('shows signature progress against the required count recorded by the server', async () => {
    fetchJson.mockResolvedValue(instanceResponse);
    renderWidget();
    expect(await screen.findByText(/امضاهای ثبت‌شده \(۱ از ۳\)/)).toBeTruthy();
    expect(screen.getByText('۱ از ۳ امضا')).toBeTruthy();
  });

  it('shows why an action is blocked and the conditions of the chosen action (TD-085 part 1)', async () => {
    fetchJson.mockResolvedValue(instanceResponse);
    renderWidget();
    expect(await screen.findByText('مبلغ کل بیشتر از ۱۰۰ باشد (مقدار فعلی: ۵۰)')).toBeTruthy();
    expect(screen.getByText(/«تایید کلان» فعلاً ممکن نیست/)).toBeTruthy();
    fireEvent.click(screen.getByText('تایید مالی نهایی'));
    expect(screen.getByText('شرط‌های این اقدام برقرار است:')).toBeTruthy();
    expect(screen.getByText('ارز برابر IRR باشد')).toBeTruthy();
  });

  it('offers to start the workflow when the document has none', async () => {
    fetchJson.mockResolvedValue({ instance: null });
    renderWidget();
    expect(await screen.findByText('آغاز گردش کار')).toBeTruthy();
  });
});

describe('TD-466 the stepper shows the document amount in rials', () => {
  it('a foreign document shows its rial amount as IRR and its own amount in its currency', async () => {
    // 100 USD at 600,000 IRR: entityContext.amount is the rial amount (workflowDocumentAmount)
    fetchJson.mockResolvedValue({
      ...instanceResponse,
      entityContext: { amount: 60_000_000, amountInCurrency: 100, exchangeRate: 600_000, currency: 'USD', refNumber: 'INV-9', buyerName: 'مشتری' },
    });
    renderWidget();
    fireEvent.click(await screen.findByText('تایید مالی نهایی'));
    expect(screen.queryByText(formatPersianPrice(60_000_000, 'USD'))).toBeNull();
    expect(screen.getByText(formatPersianPrice(60_000_000, 'IRR'))).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(100, 'USD'))).toBeTruthy();
  });

  it('a rial document shows one rial amount', async () => {
    fetchJson.mockResolvedValue({
      ...instanceResponse,
      entityContext: { amount: 5_000_000, amountInCurrency: 5_000_000, exchangeRate: 1, currency: 'IRR', refNumber: 'INV-9', buyerName: 'مشتری' },
    });
    renderWidget();
    fireEvent.click(await screen.findByText('تایید مالی نهایی'));
    expect(screen.getAllByText(formatPersianPrice(5_000_000, 'IRR'))).toHaveLength(1);
  });
});
