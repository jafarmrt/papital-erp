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
      <WorkflowStepperWidget entityType="project" entityId={7} workflowCode="PROJECT_WORKFLOW" title="گردش کار پروژه" />
    </QueryClientProvider>,
  );
}

// v10.0.40 (TD-1142): the project window offered «آغاز گردش کار» for PROJECT_WORKFLOW, which no install defines
describe('workflow widget without a definition to start (TD-1142)', () => {
  it('shows nothing when the entity has no instance and no active definition', async () => {
    fetchJson.mockResolvedValue({ instance: null, startable: false });
    const { container } = renderWidget();
    await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/workflow/instance/project/7'));
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(screen.queryByText('آغاز گردش کار')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('still offers the start when an active definition exists', async () => {
    fetchJson.mockResolvedValue({ instance: null, startable: true });
    renderWidget();
    expect(await screen.findByText('آغاز گردش کار')).toBeTruthy();
  });

  it('reads a project workflow only with the project read keys', () => {
    expect(WORKFLOW_ENTITY_READ_PERMISSIONS.project).toEqual(READ_PERMISSIONS.projectRecord);
  });
});
