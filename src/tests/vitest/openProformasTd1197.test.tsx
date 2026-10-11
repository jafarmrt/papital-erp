import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenProformasPanel } from '../../components/invoices/create/OpenProformasPanel';
import { openProformaBadge, openProformasUrl } from '../../lib/invoices/openProformas';

vi.mock('../../components/workflow/WorkflowStepperWidget', () => ({ WorkflowStepperWidget: () => null }));

// v10.0.103 (TD-1197): a rejected sales proforma is a draft (TD-1137) and stays in the open proformas box, marked, with edit
const REJECTED_BADGE = 'ردشده؛ اصلاح و ارسال دوباره';
const DRAFT_BADGE = 'پیش‌نویس';

describe('open proformas box keeps rejected proformas (TD-1197)', () => {
  it('asks for sales proformas and sales drafts', () => {
    expect(openProformasUrl(2)).toBe('/documents?statuses=proforma,draft&types=invoice,proforma&page=2&limit=20');
  });

  it('marks a rejected draft and a plain draft, never a proforma', () => {
    expect(openProformaBadge({ status: 'draft', workflowRejected: true })).toBe(REJECTED_BADGE);
    expect(openProformaBadge({ status: 'draft' })).toBe(DRAFT_BADGE);
    expect(openProformaBadge({ status: 'proforma' })).toBe('');
  });

  it('shows the rejected draft with its badge and an edit button', () => {
    const onEdit = vi.fn();
    const rejected = { id: 7, type: 'invoice', status: 'draft', workflowRejected: true, ref_number: 'P-4', date: '2026-10-08', buyer_name: 'بوتیک' };
    render(
      <OpenProformasPanel proformas={[rejected]} total={1} page={1} onPageChange={() => undefined} editingDocId={null}
        onPrint={() => undefined} onEdit={onEdit} onWorkflowStateChange={() => undefined} />,
    );
    expect(screen.getByText(REJECTED_BADGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /ویرایش/ }));
    expect(onEdit).toHaveBeenCalledWith(rejected);
  });
});
