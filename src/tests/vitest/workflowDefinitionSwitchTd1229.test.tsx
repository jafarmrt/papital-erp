import fs from 'fs';
import path from 'path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t, toast: t };
});
const confirmAction = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...args: unknown[]) => confirmAction(...(args as [])) }));
const holdsSwitch = { value: true };
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: () => holdsSwitch.value }));
const fetchJson = vi.fn();
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api')>()), fetchJson: (...args: unknown[]) => fetchJson(...args) }));

import { ApiError } from '../../api';
import { toast } from 'react-hot-toast';
import { WorkflowDefinitionCard } from '../../components/workflow/WorkflowDefinitionCard';
import { WorkflowDefinitionList } from '../../components/workflow/WorkflowDefinitionList';
import { WorkflowEntityTypeField } from '../../components/workflow/WorkflowEntityTypeField';
import { workflowDeactivationRefusal, workflowEntityTypeChangeRefusal } from '../../lib/workflow/workflowLifecycle';
import type { WorkflowDefinitionSummary } from '../../hooks/queries/useWorkflowLifecycle';

// TD-1229 (D-06 part A): the workflow page had no way to turn a workflow on or off or to archive it, and the designer
// never sent the record type it showed.

afterEach(() => cleanup());
beforeEach(() => {
  confirmAction.mockClear();
  fetchJson.mockReset();
  holdsSwitch.value = true;
});

const def = (over: Partial<WorkflowDefinitionSummary> = {}): WorkflowDefinitionSummary => ({
  id: 7, code: 'WF_X', title: 'گردش کار آزمون', entityType: 'document', version: 2, isActive: 1, isArchived: 0, ...over,
});
const noActions = { activate: vi.fn(), deactivate: vi.fn(), archive: vi.fn(), restore: vi.fn(), pending: false };

const withQuery = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe('workflow definition card (TD-1229)', () => {
  it('shows the switch buttons that fit the state, only to a holder of workflow.admin', () => {
    const { rerender } = render(<WorkflowDefinitionCard def={def()} canSwitch actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('غیرفعال کردن')).toBeTruthy();
    expect(screen.queryByText('بایگانی')).toBeNull();
    expect(screen.getByText('نوع پرونده: فاکتور / سند انبار')).toBeTruthy();
    rerender(<WorkflowDefinitionCard def={def({ isActive: 0 })} canSwitch actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('فعال کردن')).toBeTruthy();
    expect(screen.getByText('بایگانی')).toBeTruthy();
    rerender(<WorkflowDefinitionCard def={def({ isActive: 0, isArchived: 1 })} canSwitch actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('بازگرداندن از بایگانی')).toBeTruthy();
    rerender(<WorkflowDefinitionCard def={def({ isActive: 0 })} canSwitch={false} actions={noActions} onHistory={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByText('فعال کردن')).toBeNull();
    expect(screen.queryByText('بایگانی')).toBeNull();
  });
});

describe('workflow definition list (TD-1229)', () => {
  it('keeps archived workflows out of the main list and shows them under «بایگانی»', () => {
    render(withQuery(<WorkflowDefinitionList isLoading={false} onCreate={vi.fn()} onEdit={vi.fn()} onHistory={vi.fn()}
      definitions={[def({ id: 1, title: 'گردش جاری' }), def({ id: 2, title: 'کنارگذاشته', isActive: 0, isArchived: 1 })]} />));
    expect(screen.getByText('گردش جاری')).toBeTruthy();
    expect(screen.queryByText('کنارگذاشته')).toBeNull();
    fireEvent.click(screen.getByText('بایگانی (۱)'));
    expect(screen.getByText('کنارگذاشته')).toBeTruthy();
    expect(screen.queryByText('گردش جاری')).toBeNull();
  });

  it('asks before replacing the active workflow of the type and then sends replaceActive', async () => {
    fetchJson
      .mockRejectedValueOnce(new ApiError('گردش کار «قدیمی» برای «فاکتور و سند» فعال است؛ با فعال کردن این گردش کار، آن یکی غیرفعال می‌شود.', 'WF_ACTIVE_DEFINITION_EXISTS', 409))
      .mockResolvedValueOnce({ success: true, data: { changed: true, replaced: { id: 1, title: 'قدیمی' } } });
    render(withQuery(<WorkflowDefinitionList isLoading={false} onCreate={vi.fn()} onEdit={vi.fn()} onHistory={vi.fn()}
      definitions={[def({ id: 9, title: 'تازه', isActive: 0 })]} />));
    fireEvent.click(screen.getByText('فعال کردن'));
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toBe('/workflow/definitions/9/activate');
    expect(JSON.parse(String((fetchJson.mock.calls[0][1] as RequestInit).body))).toEqual({});
    expect(JSON.parse(String((fetchJson.mock.calls[1][1] as RequestInit).body))).toEqual({ replaceActive: true });
  });

  it('refuses to turn off the purchase requisition workflow without calling the server', async () => {
    render(withQuery(<WorkflowDefinitionList isLoading={false} onCreate={vi.fn()} onEdit={vi.fn()} onHistory={vi.fn()}
      definitions={[def({ entityType: 'purchase_requisition' })]} />));
    fireEvent.click(screen.getByText('غیرفعال کردن'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(workflowDeactivationRefusal('purchase_requisition')));
    expect(fetchJson).not.toHaveBeenCalled();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('hides every switch button from a user without workflow.admin', () => {
    holdsSwitch.value = false;
    render(withQuery(<WorkflowDefinitionList isLoading={false} onCreate={vi.fn()} onEdit={vi.fn()} onHistory={vi.fn()}
      definitions={[def(), def({ id: 3, isActive: 0 })]} />));
    expect(screen.queryByText('غیرفعال کردن')).toBeNull();
    expect(screen.queryByText('فعال کردن')).toBeNull();
  });
});

describe('designer record type field (TD-1229, OBS-PR-15)', () => {
  it('lets only an inactive, never used workflow change its record type and says why otherwise', () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkflowEntityTypeField value="document" onChange={onChange} isActive={0} startedCount={0} />);
    const select = screen.getByLabelText('نوع پرونده') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'item' } });
    expect(onChange).toHaveBeenCalledWith('item');
    rerender(<WorkflowEntityTypeField value="document" onChange={onChange} isActive={1} startedCount={0} />);
    expect((screen.getByLabelText('نوع پرونده') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(String(workflowEntityTypeChangeRefusal({ isActive: 1, startedCount: 0 })))).toBeTruthy();
    rerender(<WorkflowEntityTypeField value="document" onChange={onChange} isActive={0} startedCount={3} />);
    expect(screen.getByText(String(workflowEntityTypeChangeRefusal({ isActive: 0, startedCount: 3 })))).toBeTruthy();
  });

  it('the designer sends the record type it shows', () => {
    const canvas = fs.readFileSync(path.resolve(__dirname, '../../components/workflow/WorkflowDesignerCanvas.tsx'), 'utf8');
    expect(canvas).toContain('<WorkflowEntityTypeField');
    expect(canvas).toMatch(/entityType: defEntityType/);
  });
});

describe('dead workflow code is gone (TD-1229, OBS-R2-65)', () => {
  it('the facade no longer binds the unused definition writers, the task delegation or the event publisher', () => {
    const root = path.resolve(__dirname, '../../services/workflow');
    expect(fs.existsSync(path.join(root, 'workflowEventPublisher.ts'))).toBe(false);
    const facade = fs.readFileSync(path.join(root, 'workflowEngineService.ts'), 'utf8');
    for (const name of ['createDefinition', 'updateDefinition', 'addState', 'addTransition', 'delegateTask', 'WorkflowEventPublisher']) {
      expect(facade).not.toContain(name);
    }
    const definitions = fs.readFileSync(path.join(root, 'workflowDefinitionService.ts'), 'utf8');
    expect(definitions).not.toMatch(/static async (createDefinition|updateDefinition|addState|addTransition)\b/);
  });
});
