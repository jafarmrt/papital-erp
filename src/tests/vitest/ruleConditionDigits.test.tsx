/**
 * v9.0.384 (TD-727, B15-25 / FE-23): a rule condition value typed with Persian digits or thousands separators matches. The
 * engine compared with `Number(value)`, so for an amount of 50,000,000 the conditions `gt "۱۰۰۰۰۰۰"`, `gt "1,000,000"` and
 * `gt "۱٬۰۰۰٬۰۰۰"` (and their `lt`) were all false and the rule never ran. The rule editor now saves a numeric comparison
 * as a number and refuses a value that is not a number.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RuleEngineService } from '../../services/ruleEngine.service';
import { RuleEditorModal, type RuleFormData } from '../../components/settings/RuleEditorModal';

vi.mock('../../api', () => ({ fetchJson: vi.fn() }));
afterEach(() => cleanup());

// one million in Latin, Persian and Arabic digits, with and without thousands separators
const ONE_MILLION_FORMS = ['1000000', '۱۰۰۰۰۰۰', '1,000,000', '۱٬۰۰۰٬۰۰۰', '١٬٠٠٠٬٠٠٠'];
const event = { payload: { totalAmount: 50_000_000, refNumber: 'INV-001' } };
const passes = (operator: string, value: unknown, field = 'payload.totalAmount') =>
  RuleEngineService.evaluateSingleRule({ field, operator, value }, event).passed;

describe('TD-727 the rule engine reads Persian digits and thousands separators', () => {
  it.each(ONE_MILLION_FORMS)('50,000,000 is greater than the value of case %# and not less', value => {
    expect(passes('gt', value)).toBe(true);
    expect(passes('gte', value)).toBe(true);
    expect(passes('lt', value)).toBe(false);
    expect(passes('lte', value)).toBe(false);
  });

  it('a number equals the same amount typed in Persian, and text keeps its exact comparison', () => {
    expect(passes('eq', '۵۰٬۰۰۰٬۰۰۰')).toBe(true);
    expect(passes('neq', '۵۰٬۰۰۰٬۰۰۰')).toBe(false);
    expect(passes('eq', '50,000,001')).toBe(false);
    expect(passes('eq', 'INV-001', 'payload.refNumber')).toBe(true);
    expect(passes('eq', 'inv-001', 'payload.refNumber')).toBe(false);
  });

  it('a value that is not a number never passes a comparison', () => {
    expect(passes('gt', 'abc')).toBe(false);
    expect(passes('lt', 'abc')).toBe(false);
  });
});

function editor(value: string, onSave = vi.fn().mockResolvedValue(undefined)) {
  const rule: RuleFormData = {
    id: 3, name: 'فاکتورهای بزرگ', description: '', eventType: 'InvoiceApproved',
    conditionsJson: [{ field: 'payload.totalAmount', operator: 'gt', value }], actionType: 'audit_log', actionConfigJson: {}, isActive: 1,
  };
  render(<RuleEditorModal isOpen onClose={() => undefined} onSave={onSave} initialRule={rule} />);
  return onSave;
}

describe('TD-727 the rule editor saves a numeric comparison as a number', () => {
  it('a Persian amount with separators is saved as a Latin number', async () => {
    const onSave = editor('۱٬۰۰۰٬۰۰۰');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('ذخیره قانون خودکار'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as RuleFormData).conditionsJson[0].value).toBe(1_000_000);
  });

  it('a value that is not a number is refused with a Persian message and nothing is saved', () => {
    const onSave = editor('یک میلیون');
    expect(screen.getByRole('alert').textContent).toContain('باید عدد باشد');
    const submit = screen.getByText('ذخیره قانون خودکار').closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSave).not.toHaveBeenCalled();
  });
});
