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

// v10.0.102 (TD-1228): a refused or failed workflow read is not «not started»; the start button is not offered
const NOT_STARTED = 'چرخه گردش کار برای این سند فعال نشده است.';
const FORBIDDEN = 'شما اجازه دیدن گردش کار این سند را ندارید.';
const LOAD_FAILED = 'گردش کار این سند بارگذاری نشد.';
const START = 'آغاز گردش کار';

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkflowStepperWidget entityType="document" entityId={9} workflowCode="DOC_APPROVAL_WORKFLOW" />
    </QueryClientProvider>,
  );
}

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { status, code: status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR' });
}

describe('workflow stepper read errors (TD-1228)', () => {
  it('shows a no-access message on 403 and offers no start', async () => {
    fetchJson.mockRejectedValue(apiError(403, 'forbidden'));
    renderWidget();
    expect(await screen.findByText(FORBIDDEN)).toBeTruthy();
    expect(screen.queryByText(NOT_STARTED)).toBeNull();
    expect(screen.queryByText(START)).toBeNull();
  });

  it('shows a load error on another failure and offers no start', async () => {
    fetchJson.mockRejectedValue(apiError(500, 'boom'));
    renderWidget();
    expect(await screen.findByText(LOAD_FAILED)).toBeTruthy();
    expect(screen.queryByText(NOT_STARTED)).toBeNull();
    expect(screen.queryByText(START)).toBeNull();
  });
});
