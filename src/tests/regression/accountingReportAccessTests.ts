import { orm } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient, sandboxClientWith,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «د»: who reads the account card, the party statement and the party list, and what they return
 * (decision t5 «الف»). Each scenario runs in its own isolated schema with the standard chart of accounts and is red on
 * the version before its fix.
 */
export async function runAccountingReportAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const accessId = 'reg_ledger_reports_need_accounting_keys_td_547';
  if (shouldRun(accessId, 'td547', 'accounting', 'permission', 'report', 'package3')) {
    await runCase(results, accessId,
      'v9.0.204: the account card, ledger, party statement and party list open only for accounting.reports or accounting.view, and a card or statement with no account or party is 422 (TD-547)',
      () => inFiscalSandbox(async () => {
        const problems: string[] = [];
        const today = await businessTodayIsoDate();
        const ids = await accountIdsByCode('1201', '5001');
        await postApproved(today, ids['1201'], ids['5001'], 1_000_000, 'TD-547 sale');
        const [customer] = await orm.insert(customers).values({ name: 'TD-547 customer', partyType: 'customer' }).returning({ id: customers.id });

        const urls = [
          `/api/accounting/reports/account-card?accountId=${ids['1201']}`,
          `/api/accounting/reports/ledger?accountId=${ids['1201']}`,
          `/api/accounting/reports/party-ledger?partyId=${customer.id}&partyType=customer`,
          '/api/accounting/reports/parties?type=personnel',
        ];
        // 1) B03-05 S05: «documents.view» and «customers.view» read the whole ledger, payroll amounts and personnel phones
        for (const keys of [['documents.view'], ['customers.view'], ['customers.view', 'customers.manage']]) {
          const client = await sandboxClientWith(keys);
          for (const url of urls) {
            const res = await client.get(url);
            if (res.status !== 403) problems.push(`${keys.join('+')} ${url} answered ${res.status}, expected 403`);
          }
          if (keys[0] === 'customers.view') {
            const own = await client.get(`/api/customers/${customer.id}/account-card`);
            if (own.status !== 200) problems.push(`the customer's own account card (TD-416) answered ${own.status} for ${keys.join('+')}, expected 200`);
          }
        }
        for (const key of ['accounting.reports', 'accounting.view']) {
          const client = await sandboxClientWith([key]);
          for (const url of urls) {
            const res = await client.get(url);
            if (res.status !== 200) problems.push(`${key} ${url} answered ${res.status}, expected 200`);
          }
        }

        // 2) a card with no account and no party returned every row of the ledger (22 MB in S19)
        const admin = await sandboxAdminClient();
        for (const url of ['/api/accounting/reports/account-card', `/api/accounting/reports/ledger?startDate=${today}`, '/api/accounting/reports/ledger?detailedName=%20']) {
          const res = await admin.get(url);
          if (res.status !== 422 || res.body?.code !== 'ACCOUNT_CARD_FILTER_REQUIRED') {
            problems.push(`${url} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}, expected 422 ACCOUNT_CARD_FILTER_REQUIRED`);
          }
        }
        const byType = await admin.get('/api/accounting/reports/ledger?detailedType=customer');
        if (byType.status !== 200) problems.push(`a card filtered by detailed type answered ${byType.status}, expected 200`);
        const noParty = await admin.get(`/api/accounting/reports/party-ledger?startDate=${today}`);
        if (noParty.status !== 422 || noParty.body?.code !== 'PARTY_LEDGER_PARTY_REQUIRED') {
          problems.push(`a statement with no party answered ${noParty.status} ${JSON.stringify(noParty.body).slice(0, 160)}, expected 422 PARTY_LEDGER_PARTY_REQUIRED`);
        }
        assertNoProblems(problems);
        return 'documents.view and customers.view get 403 on the four routes and still read the customer card; accounting keys get 200; unfiltered card and statement 422';
      }));
  }

  return results;
}
