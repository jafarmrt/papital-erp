import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// v10.1.45 closing sweep, OBS-R1-53 (server part): the financial ratios add and subtract amounts with FinancialMath,
// never with JS + / -, like every other report total (AGENTS §1.8)
const src = fs.readFileSync(path.resolve(__dirname, '../../services/accounting/accountingReport.service.ts'), 'utf8');

describe('OBS-R1-53: financial ratio amounts are decimal', () => {
  it('net working capital, quick assets and equity use FinancialMath', () => {
    expect(src).not.toMatch(/totalCurrentAssets - totalCurrentLiabilities/);
    expect(src).not.toMatch(/totalCurrentAssets - inventoryBalance/);
    expect(src).not.toMatch(/bs\.totalEquity \+ bs\.netProfitPeriod/);
    expect(src).toContain('FinancialMath.subtract(totalCurrentAssets, totalCurrentLiabilities)');
  });
});
