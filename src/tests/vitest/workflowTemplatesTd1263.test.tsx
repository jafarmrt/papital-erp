import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowCreateModal } from '../../components/workflow/WorkflowCreateModal';
import { VoucherPrimaryActionCell } from '../../components/accounting/vouchers/VoucherPrimaryActionCell';
import { voucherPrimaryAction, voucherRowActions } from '../../lib/accounting/voucherRowActions';
import { WORKFLOW_ENTITY_TYPES } from '../../lib/workflow/workflowEntityLabels';
import { WORKFLOW_TEMPLATES } from '../../lib/workflow/workflowTemplates';
import { isCatalogPermission } from '../../lib/permissions/permissionCatalog';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

afterEach(() => { cleanup(); fetchJson.mockReset(); });

function renderModal(onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkflowCreateModal onClose={() => undefined} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

// v10.1.10 (TD-1263, D-06 part B, decisions ت۴ / ت۵): four ready-made templates, guarded by permissions only
describe('workflow templates (TD-1263)', () => {
  it('has the four templates, each with one start step and only catalog permission guards', () => {
    expect(WORKFLOW_TEMPLATES.map(t => t.entityType)).toEqual(['item', 'bank_account', 'purchase_requisition', 'journal_voucher']);
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.states.filter(s => s.stateType === 'initial')).toHaveLength(1);
      expect(WORKFLOW_ENTITY_TYPES.some(t => t.id === template.entityType)).toBe(true);
      for (const action of template.transitions) {
        expect(action.requiredRole).toBe('');
        if (action.requiredPermission) expect(isCatalogPermission(action.requiredPermission)).toBe(true);
      }
    }
  });

  it('makes a definition from the chosen template and opens it', async () => {
    fetchJson.mockResolvedValue({ success: true, data: { id: 41, isActive: 0 } });
    const onCreated = renderModal();
    fireEvent.click(screen.getByRole('radio', { name: /حساب بانکی/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ساخت از الگو و ورود به طراح' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
    expect(fetchJson).toHaveBeenCalledWith('/workflow/definitions/from-template', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ templateId: 'bank_account' }),
    }));
  });

  // OBS-R2-76: the blank form offered «پروژه» and «مواد اولیه», on which no workflow starts
  it('offers only the record types a workflow starts on in the blank form', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'طرح خالی' }));
    const options = Array.from((screen.getByLabelText('نوع پرونده') as HTMLSelectElement).options).map(o => o.value);
    expect(options).toEqual(WORKFLOW_ENTITY_TYPES.map(t => t.id));
    expect(options).not.toContain('project');
    expect(options).not.toContain('raw_material');
  });
});

// v10.1.10 (TD-1263, decision ت۶): a voucher in its workflow is approved there, not from the voucher page
describe('voucher in its workflow (TD-1263)', () => {
  it('offers the workflow instead of approve, finalize and revert', () => {
    expect(voucherPrimaryAction('draft', { canApprove: true, canFinalize: true }, true)).toBe('in_workflow');
    expect(voucherPrimaryAction('approved', { canApprove: true, canFinalize: true }, true)).toBe('in_workflow');
    expect(voucherPrimaryAction('draft', { canApprove: true, canFinalize: true }, false)).toBe('approve');
    expect(voucherRowActions({ status: 'approved', inWorkflow: true })).not.toContain('revert_to_draft');
    expect(voucherRowActions({ status: 'approved' })).toContain('revert_to_draft');
  });

  it('shows a workflow button that opens the voucher workflow', () => {
    const onOpenWorkflow = vi.fn();
    render(<VoucherPrimaryActionCell status="draft" inWorkflow onApprove={() => undefined} onOpenWorkflow={onOpenWorkflow} />);
    expect(screen.queryByText('تایید سند')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'در گردش کار' }));
    expect(onOpenWorkflow).toHaveBeenCalled();
  });
});
