import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RuleEditorModal, type RuleFormData } from '../../components/settings/RuleEditorModal';
import { eventFieldOptions } from '../../lib/eventPayloadFields';

vi.mock('../../api', () => ({ fetchJson: vi.fn() }));

afterEach(cleanup);

const rule: RuleFormData = {
  name: 'اعلان فاکتور',
  description: '',
  eventType: 'InvoiceApproved',
  conditionsJson: [{ field: '', operator: 'gt', value: '' }],
  actionType: 'in_app_notification',
  actionConfigJson: { targetRole: 'admin', titleTemplate: 'فاکتور', messageTemplate: 'فاکتور' },
  isActive: 1,
};

describe('event field picker (TD-085 part 3)', () => {
  it('lists the payload fields of the event with Persian labels, then the common fields', () => {
    const fields = eventFieldOptions('InvoiceApproved');
    expect(fields).toContainEqual({ path: 'payload.totalAmount', label: 'مبلغ کل' });
    expect(fields.at(-1)).toEqual({ path: 'metadata.userName', label: 'کاربر انجام‌دهنده' });
    expect(eventFieldOptions('*').map((f) => f.path)).toEqual(['eventType', 'aggregateType', 'aggregateId', 'metadata.userName']);
  });

  it('offers the fields as suggestions for a condition and inserts a variable into the message on click', () => {
    const { container } = render(<RuleEditorModal isOpen onClose={() => {}} onSave={async () => {}} initialRule={rule} />);
    const field = screen.getByLabelText('فیلد شرط') as HTMLInputElement;
    expect(field.getAttribute('list')).toBe('rule-event-fields');
    const options = Array.from(container.querySelectorAll('#rule-event-fields option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('payload.buyerName');

    const chip = screen.getAllByTitle('افزودن به متن پیام').find((b) => b.textContent?.includes('مبلغ کل'));
    expect(chip).toBeTruthy();
    fireEvent.click(chip as HTMLElement);
    const message = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(message.value).toBe('فاکتور {{payload.totalAmount}}');
  });
});
