import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveLeadStageStatus, statusOfStage } from '../../services/crm/crmLeadOutcome';
import { spreadOrderedQuantity } from '../../services/procurement/requisitionOrder';
import { CRM_BOARD_LEAD_CAP, dashboardLeadCapNotice, isOpenLead } from '../../lib/crm/crmListPages';

/**
 * v11 phase 6.4: the pure rules of the sales and CRM package. The database scenarios are in
 * src/tests/regression/salesCrmV11Tests.ts.
 */

const errorCode = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (err) { return String((err as { code?: string }).code ?? 'NO_CODE'); }
};

describe('a lead status follows its stage (C4)', () => {
  const lead = { existingStage: 'lead', existingStatus: 'active' };

  it('derives the status of every stage', () => {
    expect(['lead', 'qualified', 'proposal', 'won', 'lost'].map(statusOfStage)).toEqual(['active', 'active', 'active', 'won', 'lost']);
  });

  it('moves the stage when won or lost is sent alone', () => {
    expect(resolveLeadStageStatus({ ...lead, requestedStatus: 'lost' })).toEqual({ stage: 'lost', status: 'lost' });
    expect(resolveLeadStageStatus({ ...lead, requestedStatus: 'won' })).toEqual({ stage: 'won', status: 'won' });
    expect(resolveLeadStageStatus({ existingStage: 'lost', existingStatus: 'lost', requestedStatus: 'lost' })).toEqual({ stage: undefined, status: 'lost' });
  });

  it('takes the status of a sent stage, archived aside, and refuses a stage and status that disagree', () => {
    expect(resolveLeadStageStatus({ ...lead, requestedStage: 'qualified' })).toEqual({ stage: 'qualified', status: 'active' });
    expect(resolveLeadStageStatus({ existingStage: 'won', existingStatus: 'won', requestedStage: 'proposal' })).toEqual({ stage: 'proposal', status: 'active' });
    expect(resolveLeadStageStatus({ ...lead, requestedStage: 'qualified', requestedStatus: 'archived' })).toEqual({ stage: 'qualified', status: 'archived' });
    expect(resolveLeadStageStatus({ ...lead, requestedStage: 'lost', requestedStatus: 'lost' })).toEqual({ stage: 'lost', status: 'lost' });
    expect(errorCode(() => resolveLeadStageStatus({ ...lead, requestedStage: 'qualified', requestedStatus: 'won' }))).toBe('CRM_LEAD_STATUS_STAGE_MISMATCH');
    expect(errorCode(() => resolveLeadStageStatus({ ...lead, requestedStage: 'won', requestedStatus: 'active' }))).toBe('CRM_LEAD_STATUS_STAGE_MISMATCH');
  });

  it('archives and unarchives an open lead without moving it, and reopens a closed one only through its stage', () => {
    expect(resolveLeadStageStatus({ ...lead, requestedStatus: 'archived' })).toEqual({ stage: undefined, status: 'archived' });
    expect(resolveLeadStageStatus({ existingStage: 'qualified', existingStatus: 'archived', requestedStatus: 'active' })).toEqual({ stage: undefined, status: 'active' });
    expect(errorCode(() => resolveLeadStageStatus({ existingStage: 'won', existingStatus: 'won', requestedStatus: 'active' }))).toBe('CRM_LEAD_STATUS_STAGE_MISMATCH');
  });

  it('keeps the stored status when neither is sent', () => {
    expect(resolveLeadStageStatus({ existingStage: 'qualified', existingStatus: 'archived' })).toEqual({ stage: undefined, status: 'archived' });
    expect(resolveLeadStageStatus({ existingStage: null, existingStatus: null })).toEqual({ stage: undefined, status: 'active' });
  });
});

describe('an order spreads over the requisition rows of one item (C9)', () => {
  const rows = () => [{ requestedQty: 5, orderedQty: 0 }, { requestedQty: 5, orderedQty: 0 }];
  const added = (r: ReturnType<typeof rows>, quantity: number | string) => spreadOrderedQuantity(r, quantity).map(x => [r.indexOf(x.row), x.added]);

  it('fills each row in order and puts the excess on the last one', () => {
    expect(added(rows(), 10)).toEqual([[0, 5], [1, 5]]);
    expect(added(rows(), 7)).toEqual([[0, 5], [1, 2]]);
    expect(added(rows(), 3)).toEqual([[0, 3]]);
    expect(added(rows(), 12)).toEqual([[0, 5], [1, 7]]);
    expect(added([{ requestedQty: 5, orderedQty: 5 }, { requestedQty: 5, orderedQty: 2 }], 3)).toEqual([[1, 3]]);
    expect(added([{ requestedQty: 5, orderedQty: 6 }, { requestedQty: 5, orderedQty: 0 }], 2)).toEqual([[1, 2]]);
  });

  it('keeps decimals exact and gives a single row everything', () => {
    expect(added([{ requestedQty: 0.3, orderedQty: 0.1 }, { requestedQty: 1, orderedQty: 0 }], '0.5')).toEqual([[0, 0.2], [1, 0.3]]);
    expect(added([{ requestedQty: 5, orderedQty: 5 }], 4)).toEqual([[0, 4]]);
    expect(spreadOrderedQuantity([], 4)).toEqual([]);
  });
});

describe('the dashboard calendar says when the open leads fill its list (C6)', () => {
  it('speaks only when the open files reach the cap', () => {
    expect(dashboardLeadCapNotice(CRM_BOARD_LEAD_CAP - 1)).toBeNull();
    expect(dashboardLeadCapNotice(CRM_BOARD_LEAD_CAP)).toContain('۵۰۰');
    expect([{ status: 'active' }, { status: '' }, { status: 'won' }, { status: 'archived' }].map(isOpenLead)).toEqual([true, true, false, false]);
  });
});

describe('npm run lint and lint:eslint have the heap they need (C14)', () => {
  it('runs the type check and the ESLint ratchet with a larger heap, on every platform', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.lint).toMatch(/^node --max-old-space-size=\d{4,} node_modules\/typescript\/bin\/tsc --noEmit$/);
    expect(pkg.scripts['lint:eslint']).toMatch(/^node --max-old-space-size=\d{4,} --import tsx scripts\/eslint-ratchet\.ts$/);
    for (const script of [pkg.scripts.lint, pkg.scripts['lint:eslint']]) {
      expect(Number(/--max-old-space-size=(\d+)/.exec(script)?.[1])).toBeGreaterThanOrEqual(4096);
    }
  });
});
