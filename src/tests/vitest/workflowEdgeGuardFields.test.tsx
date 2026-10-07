import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkflowEdgeGuardFields, type WorkflowEdgeGuard } from '../../components/workflow/WorkflowEdgeGuardFields';
import { workflowDesignErrors } from '../../lib/workflow/workflowDesignRules';

// v9.0.111 (TD-542): مجوز اقدام از فهرست مشترک مجوزها و نقش فقط از نقش‌های تعریف‌شده؛ بی پنج کد نقش ثابت طراح
const roles = [{ code: 'branch_accountant', name: 'حسابدار شعبه' }];

function renderFields(value: Partial<WorkflowEdgeGuard>) {
  const onChange = vi.fn();
  render(<WorkflowEdgeGuardFields value={{ requiredRole: '', requiredPermission: '', isInitiatorExcluded: 0, ...value }} onChange={onChange} roles={roles} />);
  return onChange;
}

afterEach(() => cleanup());

describe('WorkflowEdgeGuardFields — step guard by permission and an existing role (TD-542)', () => {
  it('offers catalog permissions and only the defined roles', () => {
    renderFields({ requiredPermission: 'accounting.vouchers' });
    const permission = screen.getByLabelText('مجوز لازم') as HTMLSelectElement;
    expect(permission.tagName).toBe('SELECT');
    expect(permission.value).toBe('accounting.vouchers');
    const role = screen.getByLabelText('نقش مشخص (اختیاری)') as HTMLSelectElement;
    const roleValues = within(role).getAllByRole('option').map(o => (o as HTMLOptionElement).value);
    expect(roleValues).toEqual(['', 'branch_accountant']);
    expect(screen.queryByRole('option', { name: 'انباردار' })).toBeNull();
  });

  it('keeps a stored role that is no longer defined, labelled as such', () => {
    renderFields({ requiredRole: 'warehouse_keeper' });
    const role = screen.getByLabelText('نقش مشخص (اختیاری)') as HTMLSelectElement;
    expect(role.value).toBe('warehouse_keeper');
    expect(screen.getByRole('option', { name: 'نقشی که دیگر تعریف نشده است («warehouse_keeper»)' })).toBeTruthy();
  });

  it('reports the chosen permission and role', () => {
    const onChange = renderFields({});
    fireEvent.change(screen.getByLabelText('مجوز لازم'), { target: { value: 'warehouse.out' } });
    expect(onChange).toHaveBeenCalledWith({ requiredPermission: 'warehouse.out' });
    fireEvent.change(screen.getByLabelText('نقش مشخص (اختیاری)'), { target: { value: 'branch_accountant' } });
    expect(onChange).toHaveBeenCalledWith({ requiredRole: 'branch_accountant' });
  });
});

describe('workflowDesignErrors — transition permission and role (TD-542)', () => {
  const states = [
    { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
    { stateKey: 'done', title: 'پایان', stateType: 'terminal' },
  ];
  const action = (guard: Record<string, string>) => [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تأیید', ...guard }];

  it('accepts a catalog permission and an empty one', () => {
    expect(workflowDesignErrors(states, action({ requiredPermission: 'accounting.vouchers' }))).toEqual([]);
    expect(workflowDesignErrors(states, action({ requiredPermission: '' }))).toEqual([]);
  });

  it('refuses a permission outside the catalog and a role that is a permission key', () => {
    expect(workflowDesignErrors(states, action({ requiredPermission: 'accounting.no_such_key' }))[0]).toContain('در فهرست مجوزها نیست');
    expect(workflowDesignErrors(states, action({ requiredRole: 'warehouse.out' }))[0]).toContain('کلید مجوز است');
  });
});
