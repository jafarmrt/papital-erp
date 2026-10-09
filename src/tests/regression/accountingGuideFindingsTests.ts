import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * Lane L1 guide findings (v10.0.42 on). TD-1124: the detailed level of the trial balance grouped voucher rows by the
 * detailed name only, so two parties of one name were one row and a renamed party was two rows with one code. Red before.
 */
export async function runAccountingGuideFindingsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  if (shouldRun('reg_trial_balance_detailed_by_id_td_1124', 'td1124', 'accounting', 'trial-balance')) {
    await runCase(results, 'reg_trial_balance_detailed_by_id_td_1124', 'TD-1124: the detailed trial balance keys rows by detailed type and id; a legacy row without an id keys by name', () => inFiscalSandbox(async () => {
      const today = await businessTodayIsoDate();
      const receivable = await AccountMappingService.getTradeReceivablesAccount();
      if (!receivable) throw new Error('trade receivables account is not mapped');
      const { '5001': sales } = await accountIdsByCode('5001');
      const row = (detailedId: number | null, detailedName: string, amount: number) => ({
        accountId: receivable.id, debit: amount, credit: 0, description: 'TD-1124', detailedType: 'customer', detailedId, detailedName,
      });
      await VoucherService.createJournalVoucher({
        date: today, voucherType: 'general', status: 'approved', description: 'TD-1124', referenceModule: 'manual',
        items: [
          row(901, 'Namesake', 100), row(902, 'Namesake', 200),
          row(903, 'Old name', 300), row(903, 'New name', 400),
          row(null, 'Legacy only', 500),
          { accountId: sales, debit: 0, credit: 1500, description: 'TD-1124' },
        ],
      } as never);
      const tb = await AccountingReportService.getTrialBalance({ level: 'detailed', endDate: today });
      const mine = tb.filter(r => r.parentId === receivable.id);
      const debitOf = (code: string) => mine.filter(r => r.code === code).map(r => r.debitBalance);
      const problems: string[] = [];
      const exp = (code: string, want: number[]) => {
        const got = debitOf(code);
        if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${code}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      };
      exp(`${receivable.code}-901`, [100]);
      exp(`${receivable.code}-902`, [200]);
      exp(`${receivable.code}-903`, [700]);
      if (!mine.some(r => r.name.startsWith('Legacy only') && r.debitBalance === 500)) problems.push('legacy row without an id is missing');
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'two parties of one name are two rows, a renamed party is one row with its whole balance, a legacy row keeps its name';
    }));
  }
  return results;
}
