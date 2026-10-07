import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RuleEditorModal, type RuleFormData } from '../../components/settings/RuleEditorModal';

// v9.0.127 (TD-883): گیرنده اعلان قاعده «دارندگان یک مجوز» از کاتالوگ است، نه فهرست ثابت چهار کد نقش
vi.mock('../../api', () => ({ fetchJson: vi.fn() }));

const rule = (actionConfigJson: Record<string, unknown>): RuleFormData => ({
  id: 9, name: 'اعلان کسری موجودی', description: '', eventType: 'InventoryReorderAlert', conditionsJson: [],
  actionType: 'in_app_notification', isActive: 1,
  actionConfigJson: { titleTemplate: 'هشدار', messageTemplate: 'متن', ...actionConfigJson },
});

function renderEditor(initial: RuleFormData) {
  const onSave = vi.fn<(r: RuleFormData) => Promise<void>>().mockResolvedValue(undefined);
  render(<RuleEditorModal isOpen onClose={() => undefined} onSave={onSave} initialRule={initial} />);
  return onSave;
}

afterEach(() => cleanup());

describe('RuleEditorModal — notification recipients by permission (TD-883)', () => {
  it('shows a permission target and offers catalog permissions, not fixed role codes', () => {
    renderEditor(rule({ targetPermission: 'warehouse.view' }));
    expect((screen.getByLabelText('گیرندگان اعلان') as HTMLSelectElement).value).toBe('permission');
    expect((screen.getByLabelText('مجوز') as HTMLSelectElement).value).toBe('warehouse.view');
    expect(screen.queryByRole('option', { name: 'انباردار' })).toBeNull();
  });

  it('saves the chosen permission and drops a role target', async () => {
    const onSave = renderEditor(rule({ targetRole: 'accountant' }));
    expect((screen.getByLabelText('گیرندگان اعلان') as HTMLSelectElement).value).toBe('role');
    fireEvent.change(screen.getByLabelText('گیرندگان اعلان'), { target: { value: 'permission' } });
    fireEvent.change(screen.getByLabelText('مجوز'), { target: { value: 'crm.manage' } });
    fireEvent.submit(screen.getByLabelText('مجوز').closest('form') as HTMLFormElement);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0].actionConfigJson as Record<string, unknown>;
    expect(saved.targetPermission).toBe('crm.manage');
    expect(saved).not.toHaveProperty('targetRole');
  });
});
