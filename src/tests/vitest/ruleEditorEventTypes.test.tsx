import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RuleEditorModal, type RuleFormData } from '../../components/settings/RuleEditorModal';
import { ALL_EVENTS_PATTERN, PUBLISHED_EVENT_TYPES } from '../../lib/events/eventTypeCatalog';

// v9.0.381 (TD-726, B15-24 / FE-16, decision t3 a): the rule editor offers only «همه رویدادها» and the event types the
// server publishes, with Persian labels; it used to offer InvoiceCancelled, ChequeStatusChanged, ProjectStageCompleted and
// CustomerCreated, which nothing publishes. A stored rule of such a type shows the type and says it never runs.
vi.mock('../../api', () => ({ fetchJson: vi.fn() }));

function renderEditor(initial: RuleFormData | null) {
  return render(<RuleEditorModal isOpen onClose={() => undefined} onSave={vi.fn().mockResolvedValue(undefined)} initialRule={initial} />);
}

function eventSelect(container: HTMLElement): HTMLSelectElement {
  const select = [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'InvoiceApproved'));
  if (!select) throw new Error('event type select not found');
  return select;
}

afterEach(() => cleanup());

describe('RuleEditorModal — trigger event types (TD-726)', () => {
  it('offers exactly the all-events option and the published event types, with Persian labels', () => {
    const { container } = renderEditor(null);
    const options = [...eventSelect(container).options];
    expect(options.map(o => o.value).sort()).toEqual([ALL_EVENTS_PATTERN, ...PUBLISHED_EVENT_TYPES.map(t => t.value)].sort());
    for (const unpublished of ['InvoiceCancelled', 'ChequeStatusChanged', 'ProjectStageCompleted', 'CustomerCreated']) {
      expect(options.some(o => o.value === unpublished)).toBe(false);
    }
    for (const option of options) expect(option.textContent).toMatch(/[؀-ۿ]/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a stored rule of an unpublished type and says it never runs', () => {
    const { container } = renderEditor({ id: 9, name: 'قانون قدیمی', description: '', eventType: 'InvoiceCancelled', conditionsJson: [], actionType: 'audit_log', actionConfigJson: {}, isActive: 0 });
    expect(eventSelect(container).value).toBe('InvoiceCancelled');
    expect(screen.getByRole('alert').textContent).toContain('هرگز اجرا نمی‌شود');
  });
});
