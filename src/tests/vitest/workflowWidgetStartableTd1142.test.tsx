import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowStepperWidget } from '../../components/workflow/WorkflowStepperWidget';
import { WORKFLOW_ENTITY_READ_PERMISSIONS, READ_PERMISSIONS } from '../../lib/recordReadPermissions';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => { cleanup(); fetchJson.mockReset(); });

function renderWidget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowStepperWidget entityType="project" entityId={7} title="گردش کار پروژه" />
    </QueryClientProvider>,
  );
}

// v10.0.65 (TD-1142): the project window offered «آغاز گردش کار» for PROJECT_WORKFLOW, which no install defines
describe('workflow widget without a definition to start (TD-1142)', () => {
  it('shows nothing when the entity has no instance and no active definition', async () => {
    fetchJson.mockResolvedValue({ instance: null, startable: false });
    const { container } = renderWidget();
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workflow/instance/project/7'));
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(screen.queryByText('آغاز گردش کار')).toBeNull();
    expect(container.textContent).toBe('');
  });

  // v10.1.8 (TD-1263, OWN-04, decision ت۷): the browser never starts a workflow, even when an active definition exists
  it('offers no start even when an active definition exists', async () => {
    fetchJson.mockResolvedValue({ instance: null, startable: true });
    const { container } = renderWidget();
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(screen.queryByText('آغاز گردش کار')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('reads a project workflow only with the project read keys', () => {
    expect(WORKFLOW_ENTITY_READ_PERMISSIONS.project).toEqual(READ_PERMISSIONS.projectRecord);
  });
});
