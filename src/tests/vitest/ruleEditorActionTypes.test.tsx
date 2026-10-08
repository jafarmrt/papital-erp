import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchJson } from '../../api';
import { RuleEditorModal, type RuleFormData } from '../../components/settings/RuleEditorModal';

// v9.0.377 (TD-712, B15-10 / FE-24): the editor offers only live action types, says a stored rule's type was removed,
// and shows the server's own draft evaluation instead of a green «online test» result for any draft
vi.mock('../../api', () => ({ fetchJson: vi.fn() }));

function renderEditor(initial: RuleFormData | null) {
  render(<RuleEditorModal isOpen onClose={() => undefined} onSave={vi.fn().mockResolvedValue(undefined)} initialRule={initial} />);
}

afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

describe('RuleEditorModal — action types and draft evaluation (TD-712)', () => {
  it('offers only notification, webhook and audit-log actions', () => {
    renderEditor(null);
    expect(screen.queryByText('تحریک گردش کار')).toBeNull();
    expect(screen.queryByText('پیامک هوشمند')).toBeNull();
    expect(screen.getByText('اعلان درون‌برنامه')).toBeTruthy();
    expect(screen.getByText('ارسال وب‌هوک')).toBeTruthy();
    expect(screen.getByText('ثبت ممیزی ویژه')).toBeTruthy();
  });

  it('starts a webhook action with an empty address, not a public test service', () => {
    renderEditor(null);
    fireEvent.click(screen.getByText('ارسال وب‌هوک'));
    expect(screen.queryByDisplayValue(/httpbin/)).toBeNull();
  });

  it('says a stored rule of a removed action type must change its action', () => {
    renderEditor({ id: 4, name: 'قانون قدیمی', description: '', eventType: 'InvoiceApproved', conditionsJson: [], actionType: 'workflow_trigger', actionConfigJson: {}, isActive: 0 });
    expect(screen.getByRole('alert').textContent).toContain('از سامانه حذف شده است');
  });

  it('shows the server evaluation: a draft whose conditions do not match is not shown as a success', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ status: 'success', conditionMatches: false, message: 'شرط‌ها برقرار نیست' });
    renderEditor(null);
    fireEvent.click(screen.getByText('آزمایش قانون'));
    await waitFor(() => expect(screen.getByText('شرط‌ها برقرار نیست')).toBeTruthy());
    expect(screen.queryByText('اقدام با موفقیت شبیه‌سازی و اعتبارسنجی شد.')).toBeNull();
  });

  it('shows the server refusal of an invalid draft', async () => {
    const refusal = 'پیش‌نویس قانون پذیرفته نیست: نشانی وب‌هوک تعیین نشده است.'; // the server's message, shown in the UI
    vi.mocked(fetchJson).mockRejectedValue(new Error(refusal));
    renderEditor(null);
    fireEvent.click(screen.getByText('آزمایش قانون'));
    await waitFor(() => expect(screen.getByText(/پیش‌نویس قانون پذیرفته نیست/)).toBeTruthy());
  });
});
