import { describe, expect, it } from 'vitest';
import { renameDesignStateKey, workflowDesignErrors } from '../../lib/workflow/workflowDesignRules';

// v9.0.45 (TD-452): قواعد ساختاری طرح گردش کار، مشترک طراح و سرور
const states = [
  { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
  { stateKey: 'review', title: 'بررسی', stateType: 'intermediate' },
  { stateKey: 'done', title: 'تأیید', stateType: 'terminal' },
  { stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' },
];
const edges = [
  { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
  { fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تأیید' },
  { fromStateKey: 'review', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
  { fromStateKey: 'rejected', toStateKey: 'draft', actionKey: 'reopen', title: 'بازگشایی' },
];

describe('workflowDesignErrors', () => {
  it('accepts a design with one initial step, a terminal step and a reopen from the rejected step', () => {
    expect(workflowDesignErrors(states, edges)).toEqual([]);
  });

  it('rejects a missing or second initial step, a missing terminal step and duplicate keys', () => {
    expect(workflowDesignErrors(states.map(s => ({ ...s, stateType: s.stateType === 'initial' ? 'intermediate' : s.stateType })), [])).toHaveLength(1);
    expect(workflowDesignErrors(states.map(s => ({ ...s, stateType: s.stateKey === 'review' ? 'initial' : s.stateType })), [])).toHaveLength(1);
    expect(workflowDesignErrors(states.map(s => ({ ...s, stateType: s.stateType === 'terminal' ? 'intermediate' : s.stateType })), [])).toHaveLength(1);
    expect(workflowDesignErrors([...states, { stateKey: 'review', title: 'دوم', stateType: 'intermediate' }], [])[0]).toContain('تکراری');
  });

  it('rejects an action leaving a completed step, an unknown endpoint and a zero signature count', () => {
    expect(workflowDesignErrors(states, [{ fromStateKey: 'done', toStateKey: 'review', actionKey: 'back' }])).toHaveLength(1);
    expect(workflowDesignErrors(states, [{ fromStateKey: 'review', toStateKey: 'lost', actionKey: 'lost' }])).toHaveLength(1);
    expect(workflowDesignErrors(states, [{ fromStateKey: 'draft', toStateKey: 'done', kValue: 0 }])).toHaveLength(1);
    expect(workflowDesignErrors('not-an-array', [])).toHaveLength(1);
  });
});

describe('renameDesignStateKey', () => {
  it('moves the step actions to the new key instead of leaving them on the old one', () => {
    const renamed = renameDesignStateKey(states, edges, 'review', 'warehouse_review');
    expect(renamed.nodes.map(n => n.stateKey)).toContain('warehouse_review');
    expect(renamed.edges.filter(e => e.fromStateKey === 'review' || e.toStateKey === 'review')).toHaveLength(0);
    expect(renamed.edges.filter(e => e.fromStateKey === 'warehouse_review' || e.toStateKey === 'warehouse_review')).toHaveLength(3);
    expect(workflowDesignErrors(renamed.nodes, renamed.edges)).toEqual([]);
  });
});
