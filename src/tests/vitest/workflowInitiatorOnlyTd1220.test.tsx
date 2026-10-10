import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkflowEdgeGuardFields, type WorkflowEdgeGuard } from '../../components/workflow/WorkflowEdgeGuardFields';
import { workflowDesignErrors } from '../../lib/workflow/workflowDesignRules';

// v10.0.120 (TD-1220): the designer sets «فقط آغازکننده اجرا کند» per action and never together with «آغازکننده تأیید نکند»
function renderFields(value: Partial<WorkflowEdgeGuard>) {
  const onChange = vi.fn();
  render(<WorkflowEdgeGuardFields value={{ requiredRole: '', requiredPermission: '', isInitiatorExcluded: 0, isInitiatorOnly: 0, ...value }} onChange={onChange} roles={[]} />);
  return onChange;
}

afterEach(() => cleanup());

const states = [{ stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' }, { stateKey: 'done', title: 'پایان', stateType: 'terminal' }];

describe('initiator-only action flag (TD-1220)', () => {
  it('shows the flag and clears the opposite flag when it is ticked', () => {
    const onChange = renderFields({ isInitiatorExcluded: 1 });
    fireEvent.click(screen.getByLabelText(/فقط آغازکننده اجرا کند/));
    expect(onChange).toHaveBeenCalledWith({ isInitiatorOnly: 1, isInitiatorExcluded: 0 });
  });

  it('ticking the exclusion clears the initiator-only flag', () => {
    const onChange = renderFields({ isInitiatorOnly: 1 });
    expect((screen.getByLabelText(/فقط آغازکننده اجرا کند/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/آغازکننده تأیید نکند/));
    expect(onChange).toHaveBeenCalledWith({ isInitiatorExcluded: 1, isInitiatorOnly: 0 });
  });

  it('refuses a design with both flags on one action', () => {
    const both = [{ from: 'draft', to: 'done', actionKey: 'send', title: 'ارسال', isInitiatorOnly: 1, isInitiatorExcluded: true }];
    expect(workflowDesignErrors(states, both).some(e => e.includes('فقط آغازکننده اجرا کند'))).toBe(true);
    expect(workflowDesignErrors(states, [{ ...both[0], isInitiatorExcluded: 0 }])).toEqual([]);
  });
});
