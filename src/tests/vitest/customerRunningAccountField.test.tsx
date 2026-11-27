import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// v12 colleague sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md §4.1): the party form links a party to a colleague
// or a partner of the personnel; choosing «طرف حساب عادی» drops the person, so a plain party never keeps a stale link.
vi.mock('../../hooks/queries/usePersonnelQueries', () => ({
  usePersonnelListQuery: () => ({ data: [{ id: 7, fullName: 'colleague seven' }, { id: 9, fullName: 'partner nine' }] }),
}));

import { CustomerRunningAccountField, RUNNING_ACCOUNT_FIELD_TEXT } from '../../components/customers/CustomerRunningAccountField';

afterEach(() => cleanup());

describe('v12 colleague sales: the party form running-account field', () => {
  it('asks for no person while the party is ordinary', () => {
    render(<CustomerRunningAccountField personnelId="" runningAccount="" onChange={vi.fn()} />);
    expect(screen.getByLabelText(RUNNING_ACCOUNT_FIELD_TEXT.account)).toHaveProperty('value', '');
    expect(screen.queryByLabelText(new RegExp(RUNNING_ACCOUNT_FIELD_TEXT.personnel))).toBeNull();
  });

  it('picks the colleague account, then the person, from the personnel list', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CustomerRunningAccountField personnelId="" runningAccount="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(RUNNING_ACCOUNT_FIELD_TEXT.account), { target: { value: 'colleague' } });
    expect(onChange).toHaveBeenLastCalledWith({ runningAccount: 'colleague', personnelId: '' });
    rerender(<CustomerRunningAccountField personnelId="" runningAccount="colleague" onChange={onChange} />);
    const person = screen.getByLabelText(new RegExp(RUNNING_ACCOUNT_FIELD_TEXT.personnel));
    expect(person).toHaveProperty('required', true);
    fireEvent.change(person, { target: { value: '9' } });
    expect(onChange).toHaveBeenLastCalledWith({ runningAccount: 'colleague', personnelId: 9 });
    expect(screen.getByText(RUNNING_ACCOUNT_FIELD_TEXT.hint)).toBeTruthy();
  });

  it('drops the person when the party goes back to ordinary', () => {
    const onChange = vi.fn();
    render(<CustomerRunningAccountField personnelId={7} runningAccount="partner" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(RUNNING_ACCOUNT_FIELD_TEXT.account), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ runningAccount: '', personnelId: '' });
  });
});
