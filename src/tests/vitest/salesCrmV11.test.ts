import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveLeadStageStatus, statusOfStage } from '../../services/crm/crmLeadOutcome';
import { spreadOrderedQuantity } from '../../services/procurement/requisitionOrder';
import { rebuildOrderRows } from '../../services/procurement/requisitionReceipt';
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

describe('a void or edit of an order rebuilds duplicate rows the same way (C9, review)', () => {
  const ordered = (orderedQty: number, receivedQty = 0) => ({ itemId: 7, requestedQty: 5, orderedQty, receivedQty, remainingQty: 0, status: 'ordered' });
  const shape = (rows: ReturnType<typeof rebuildOrderRows>) => rows.map(r => [r.orderedQty, r.receivedQty ?? 0, r.remainingQty, r.status]);

  it('spreads the live orders over the rows and reopens what the void or a lower edit freed', () => {
    // rows 5 + 5 fully ordered by 6 (draft) and 4 (final); the order of 4 is voided, or edited down, leaving 6
    expect(shape(rebuildOrderRows([ordered(5), ordered(5)] as never, new Set([7]), [{ itemId: 7, quantity: 6 }], []))).toEqual([[5, 0, 0, 'ordered'], [1, 0, 4, 'pending']]);
    // both orders final and received; voiding the 4 leaves 6 ordered and received
    expect(shape(rebuildOrderRows([ordered(5, 5), ordered(5, 5)] as never, new Set([7]), [{ itemId: 7, quantity: 6 }], [{ itemId: 7, quantity: 6 }]))).toEqual([[5, 5, 0, 'received'], [1, 1, 4, 'pending']]);
  });

  it('keeps a row closed before the rebuild closed: by flag, by note or by the legacy rule (ordered below its request)', () => {
    // TD-1391 (v11 phase 7.2): the closed row keeps what it had ordered and the open row gets the rest back to order
    for (const closed of [{ ...ordered(2), closed: true }, { ...ordered(2), closureNote: 'بسته شد' }, ordered(3)]) {
      const kept = closed.orderedQty;
      expect(shape(rebuildOrderRows([ordered(5), closed] as never, new Set([7]), [{ itemId: 7, quantity: 6 }], []))).toEqual([[6 - kept, 0, kept - 1, 'pending'], [kept, 0, 0, 'ordered']]);
    }
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
