// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  checkExpression, compareRehearsal, isRehearsalDatabase, type HealthStatus, type RehearsalSnapshot, type TotalsSection,
} from '../../db/upgradeRehearsal';

/**
 * v8.0.88 (TD-367): مقایسه پیش و پس از مهاجرت در تمرین ارتقا. جمع دفتر، موجودی و مانده بانک نباید عوض شوند و
 * سلامت مالی نباید بدتر شود؛ کم شدن سطرها و سطرهای ناقض قید NOT VALID فقط یادداشت‌اند.
 */
function snapshot(totals: Record<string, string>, extra: Partial<RehearsalSnapshot> = {}): RehearsalSnapshot {
  const sections = new Set<TotalsSection>(['ledger', 'item', 'warehouse_stock', 'bank']);
  return {
    totals: new Map(Object.entries(totals)), labels: new Map(), sections, rowCounts: new Map(), notValid: new Map(), unavailable: [], ...extra,
  };
}

describe('upgrade rehearsal comparison (TD-367)', () => {
  it('accepts unchanged totals and treats a missing key as zero', () => {
    const before = snapshot({ 'ledger|1|IRR|debit': '100', 'warehouse_stock|5|1': '0' });
    const after = snapshot({ 'ledger|1|IRR|debit': '100' });
    expect(compareRehearsal(before, after, null, null).problems).toEqual([]);
  });

  it('reports a changed ledger total or stock with its label', () => {
    const before = snapshot({ 'ledger|1|IRR|debit': '100', 'item|7|stock': '10' });
    const after = snapshot({ 'ledger|1|IRR|debit': '105', 'item|7|stock': '3' }, { labels: new Map([['item|7|stock', 'item R-7 stock']]) });
    expect(compareRehearsal(before, after, null, null).problems).toEqual(['ledger|1|IRR|debit: 100 → 105', 'item R-7 stock: 10 → 3']);
  });

  it('does not compare a section that was not readable before (older schema)', () => {
    const before = snapshot({ 'item|7|stock': '10' }, { sections: new Set<TotalsSection>(['item']) });
    const after = snapshot({ 'item|7|stock': '10', 'warehouse_stock|7|1': '10' });
    expect(compareRehearsal(before, after, null, null).problems).toEqual([]);
  });

  it('flags a health check that got worse but not one that improved', () => {
    const h = (status: HealthStatus['status'], count: number): HealthStatus => ({ title: 't', status, count });
    const before = new Map([['a', h('healthy', 0)], ['b', h('error', 3)], ['c', h('warning', 1)]]);
    const after = new Map([['a', h('error', 1)], ['b', h('warning', 1)], ['c', h('warning', 2)]]);
    expect(compareRehearsal(snapshot({}), snapshot({}), before, after).problems).toHaveLength(2);
  });

  it('lists removed rows and NOT VALID violations only as notes', () => {
    const before = snapshot({}, { rowCounts: new Map([['documents', 10], ['changelogs', 4]]) });
    const after = snapshot({}, { rowCounts: new Map([['documents', 9]]), notValid: new Map([['chk_x_date_datefmt', 2]]) });
    const findings = compareRehearsal(before, after, null, null);
    expect(findings.problems).toEqual([]);
    expect(findings.notices).toHaveLength(3);
  });

  it('extracts CHECK expressions and recognises only drill copies', () => {
    expect(checkExpression('CHECK ((is_deleted = ANY (ARRAY[0, 1]))) NOT VALID')).toBe('(is_deleted = ANY (ARRAY[0, 1]))');
    expect(checkExpression('CHECK ((qty >= (0)::numeric))')).toBe('(qty >= (0)::numeric)');
    expect(isRehearsalDatabase('erp_restore_drill_20261005_120000')).toBe(true);
    expect(isRehearsalDatabase('papital_erp')).toBe(false);
  });
});
