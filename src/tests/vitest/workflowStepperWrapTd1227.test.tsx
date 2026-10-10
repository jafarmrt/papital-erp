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

// v10.0.101 (TD-1227, fresh-eyes workmap B-09): the steps wrap onto a second line instead of being clipped in a narrow window
const states = [1, 2, 3, 4, 5].map(id => ({ id, stateKey: `s${id}`, title: `step ${id}`, stateType: id === 1 ? 'initial' : id > 3 ? 'terminal' : 'normal', color: 'gray', stepOrder: id }));
const response = {
  instance: { id: 7, workflowDefinitionId: 2, entityType: 'document', entityId: '9', currentStateId: 2, status: 'IN_PROGRESS' },
  definition: { id: 2, code: 'DOC_APPROVAL_WORKFLOW', title: 'x', entityType: 'document', version: 1 },
  currentState: states[1],
  allStates: states,
  availableTransitions: [],
  blockedTransitions: [],
  history: [{ id: 1, fromStateId: 1, toStateId: 2, actionKey: 'submit' }],
  approvalProgress: {},
  entityContext: {},
};

describe('workflow stepper layout (TD-1227)', () => {
  it('wraps the steps instead of clipping them', async () => {
    fetchJson.mockResolvedValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WorkflowStepperWidget entityType="document" entityId={9} workflowCode="DOC_APPROVAL_WORKFLOW" />
      </QueryClientProvider>,
    );
    const steps = (await screen.findByText('step 5')).closest('[data-stepper-steps]');
    expect(steps).toBeTruthy();
    const classes = steps?.getAttribute('class') ?? '';
    expect(classes).toContain('flex-wrap');
    expect(classes).not.toContain('justify-between');
  });
});
