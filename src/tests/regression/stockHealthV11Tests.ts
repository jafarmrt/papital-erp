import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVoucherItems, journalVouchers, transactions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { accountIdsByCode, inFiscalSandbox, postApproved, runCase, sandboxAdminClient, type ShouldRun } from './fiscalClosingTests.js';
import { stockDoc } from './stockPathsV11Tests.js';

/**
 * v11 phase 6.1j (M8, M21): the financial health check reports the small differences it used to call healthy, a voucher
 * off by a fraction of a rial and a stock vs ledger gap larger than rounding explains, with the manual vouchers on the
 * inventory accounts. Real services on PostgreSQL in its own schema with the standard chart of accounts; red on v11.4.0.
 */
/** receipts and sales through the documents route, each voucher approved at once */
async function stockFlows() {
  const admin = await sandboxAdminClient();
  const today = await businessTodayIsoDate();
  const main = String(await getDefaultWarehouseCode(orm));
  const supplier = await createTestCustomer({ partyType: 'supplier' });
  const customer = await createTestCustomer();
  const approveAll = () => orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.status, 'draft'));
  const receive = async (itemId: number, quantity: number, price: number, extra: Record<string, unknown> = {}) => {
    const id = await stockDoc(admin, { docType: 'receipt', inOut: 'in', date: today, location: main, buyer_name: supplier.name, partyId: supplier.id, items: [{ itemId, quantity, unit_price: price }], ...extra });
    await approveAll();
    return id;
  };
  const sell = async (itemId: number, price: number, extra: Record<string, unknown> = {}) => {
    await stockDoc(admin, { docType: 'invoice', inOut: 'out', date: today, location: main, buyer_name: customer.name, partyId: customer.id, items: [{ itemId, quantity: 1, unit_price: price }], ...extra });
    await approveAll();
  };
  return { admin, approveAll, receive, sell };
}

export async function runStockHealthV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const healthId = 'reg_health_small_differences_v11_6_1j_m8_m21';
  if (shouldRun(healthId, 'v11', 'phase6', 'm8', 'm21', 'health', 'voucher', 'inventory')) {
    await runCase(results, healthId, 'v11 phase 6.1j (M8, M21): the financial health check lists a voucher whose debit and credit differ within the 0.01 tolerance as a warning (an error over it), and a stock vs ledger gap larger than rounding explains with the manual voucher that made it (not a reversed pair); a gap from the 4-decimal WAC, the rial rounding of foreign-currency voucher rows or of void residues stays healthy, and a manual posting within it is still listed; before, both were reported healthy', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '1401', '4001');
      const testOf = async (id: string) => (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === id);
      const startStock = await testOf('inventory_reconciliation');
      if (startStock?.status !== 'healthy') problems.push(`the empty sandbox stock check is ${startStock?.status}`);

      const small = await postApproved('2026-05-01', acc['1001'], acc['4001'], 100, 'M8 small difference');
      await orm.update(journalVoucherItems).set({ debit: money('100.004') })
        .where(and(eq(journalVoucherItems.voucherId, small), sql`${journalVoucherItems.debit} > 0`));
      const warn = await testOf('vouchers_balance');
      if (warn?.status !== 'warning' || !warn.items?.some(i => Number(i.id) === small) || Number(warn.metrics?.smallDifferenceCount) !== 1) {
        problems.push(`a voucher off by 0.004 reads ${JSON.stringify({ status: warn?.status, metrics: warn?.metrics })}, expected warning listing it`);
      }
      const big = await postApproved('2026-05-02', acc['1001'], acc['4001'], 1000, 'M8 big difference');
      await orm.update(journalVoucherItems).set({ credit: money('999.97') })
        .where(and(eq(journalVoucherItems.voucherId, big), sql`${journalVoucherItems.credit} > 0`));
      const err = await testOf('vouchers_balance');
      if (err?.status !== 'error' || Number(err.metrics?.unbalancedCount) !== 1 || Number(err.metrics?.smallDifferenceCount) !== 1 || Number(err.items?.[0]?.id) !== big) {
        problems.push(`with one voucher off by 0.03 the check reads ${JSON.stringify({ status: err?.status, metrics: err?.metrics, first: err?.items?.[0]?.id })}, expected error with it first`);
      }

      const { admin, approveAll, receive, sell } = await stockFlows();
      const stepOf = async (label: string, previousTolerance: number) => {
        const t = await testOf('inventory_reconciliation');
        const gap = Number(t?.metrics?.discrepancy);
        if (t?.status !== 'healthy' || !(gap > previousTolerance)) {
          problems.push(`${label} reads ${JSON.stringify({ status: t?.status, metrics: t?.metrics })}, expected healthy with a gap over ${previousTolerance} (what the allowance explained without it)`);
        }
        return { gap, tolerance: Number(t?.metrics?.roundingTolerance) };
      };

      // each step's gap is more than the allowance before it explained, so the allowance grows by the term that covers it;
      // a step's allowance is always more than its gap, so the steps run from the tightest bound to the loosest
      // TD-1147: 1 at 100 and 1 at 300.9 average to 200.45; after a sale, voiding the first receipt leaves 100.45, of which
      // the residue voucher posts 100, so six such voids leave the ledger 2.7 rials over an empty stock
      for (let i = 0; i < 6; i++) {
        const voided = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
        const first = await receive(voided.id, 1, 100);
        await receive(voided.id, 1, 300.9);
        await sell(voided.id, 500);
        const voidRes = await admin.del(`/api/documents/${first}`);
        if (voidRes.status >= 300) throw new Error(`setup: voiding a receipt returned ${voidRes.status} ${JSON.stringify(voidRes.body).slice(0, 200)}`);
        await approveAll();
      }
      const afterResidue = await stepOf('six void residues rounded to the rial', 2);

      // TD-1030: a large dollar row's 4-decimal rate cannot land on its exact Kardex rials; 100,000,000,011 rials sold at
      // 600,000 credits inventory 166,666.6667 USD at 599,999.9999, worth 100,000,000,003, so 8 rials stay in the ledger
      const large = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      await receive(large.id, 1, 100_000_000_011);
      await sell(large.id, 200_000, { currency: 'USD', exchangeRate: 600_000 });
      const afterLarge = await stepOf('a large dollar sale', afterResidue.tolerance);

      // TD-1030: the inventory row of a dollar receipt is its rial value rounded to the rial, 1001 for 1 USD at 1000.55, so 30
      // receipts leave the ledger 13.5 rials more over the Kardex, more than the allowance before them explains
      const fractional = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      for (let i = 0; i < 30; i++) await receive(fractional.id, 1, 1, { currency: 'USD', exchangeRate: 1000.55 });
      const rialRounded = await stepOf('30 dollar receipts rounded to the rial', afterLarge.tolerance);

      // the 4-decimal WAC: 100000 at 1 and 3 at 2 average to 1.0000, so the warehouse is worth 100003 and the ledger 100006
      const bulk = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      await receive(bulk.id, 100000, 1);
      await receive(bulk.id, 3, 2);
      const rounded = await testOf('inventory_reconciliation');
      if (rounded?.status !== 'healthy' || Number(rounded?.metrics?.discrepancy) !== rialRounded.gap + 3) {
        problems.push(`a 3-rial gap from the 4-decimal WAC reads ${JSON.stringify({ status: rounded?.status, metrics: rounded?.metrics })}, expected healthy with ${rialRounded.gap + 3}`);
      }
      const base = Number(rounded?.metrics?.discrepancy);

      // a manual posting within the rounding allowance is listed, though the check stays healthy
      const smallPosting = await postApproved('2026-05-03', acc['1401'], acc['1001'], 6, 'M21 small manual inventory posting');
      const listed = await testOf('inventory_reconciliation');
      if (listed?.status !== 'healthy' || Number(listed?.metrics?.discrepancy) !== base + 6 || !listed?.items?.some(i => i.id === `manual_${smallPosting}` && Number(i.linkId) === smallPosting)) {
        problems.push(`a 6-rial manual posting within the allowance reads ${JSON.stringify({ status: listed?.status, discrepancy: listed?.metrics?.discrepancy, items: listed?.items?.map(i => i.id) })}, expected healthy with it listed`);
      }

      // a manual posting and its approved reversal cancel out and are not listed
      const undone = await postApproved('2026-05-03', acc['1401'], acc['1001'], 500, 'M21 posting undone');
      const reversal = await postApproved('2026-05-03', acc['1001'], acc['1401'], 500, 'M21 reversal');
      const [undoneRow] = await orm.select({ voucherNumber: journalVouchers.voucherNumber }).from(journalVouchers).where(eq(journalVouchers.id, undone));
      await orm.update(journalVouchers).set({ referenceId: undone, referenceNumber: `REV-V${undoneRow.voucherNumber}` }).where(eq(journalVouchers.id, reversal));
      const manual = await postApproved('2026-05-03', acc['1401'], acc['1001'], 900, 'M21 manual inventory posting');
      const stock = await testOf('inventory_reconciliation');
      if (stock?.status === 'healthy' || Number(stock?.metrics?.discrepancy) !== base + 906 || !stock?.items?.some(i => i.id === 'inv_diff')
        || !stock?.items?.some(i => i.id === `manual_${manual}` && Number(i.linkId) === manual) || !stock?.items?.some(i => i.id === `manual_${smallPosting}`)
        || stock?.items?.some(i => i.id === `manual_${undone}` || i.id === `manual_${reversal}`)) {
        problems.push(`a 900-rial manual posting to inventory reads ${JSON.stringify({ status: stock?.status, discrepancy: stock?.metrics?.discrepancy, items: stock?.items?.map(i => i.id) })}`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `0.004 → ${warn?.status}; 0.03 → ${err?.status}; 3-rial WAC rounding → ${rounded?.status}; ${afterResidue.gap}-rial void residues, ${afterLarge.gap}-rial large dollar sale and ${rialRounded.gap}-rial rial rounding → healthy; 6-rial manual posting → ${listed?.status} and listed; 900-rial manual posting → ${stock?.status} with both vouchers listed, the reversed pair not`;
    }));
  }

  const boundsId = 'reg_health_rounding_bounds_v11_6_1j_m21';
  if (shouldRun(boundsId, 'v11', 'phase6', 'm21', 'health', 'inventory')) {
    await runCase(results, boundsId, 'v11 phase 6.1j (M21): the stock vs ledger rounding allowance covers the void residue of a legacy receipt with no Kardex rows, a large dollar row whose rial value and product are both rounded (one rial plus the rate\'s 4th decimal on its amount) and the 4-decimal rial unit price of a dollar receipt of a large quantity, each in its own sandbox at a gap the allowance without its term does not cover, so none is reported as a gap', async () => {
      const problems: string[] = [];
      const testOf = async () => (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'inventory_reconciliation');
      const expectHealthy = (label: string, t: Awaited<ReturnType<typeof testOf>>, minGap: number) => {
        if (t?.status !== 'healthy' || !(Number(t?.metrics?.discrepancy) >= minGap)) {
          problems.push(`${label} reads ${JSON.stringify({ status: t?.status, metrics: t?.metrics })}, expected healthy with a gap of at least ${minGap}`);
        }
        return `gap ${t?.metrics?.discrepancy} within ${t?.metrics?.roundingTolerance}`;
      };

      // TD-1147, a legacy receipt with no Kardex rows: its void reverses the stock from its lines and writes no reversal
      // row, so each of six such voids leaves 0.45 rials as in the case above, with nothing in the Kardex to count it by
      const legacy = await inFiscalSandbox(async () => {
        const { admin, approveAll, receive, sell } = await stockFlows();
        for (let i = 0; i < 6; i++) {
          const voided = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
          const first = await receive(voided.id, 1, 100);
          await receive(voided.id, 1, 300.9);
          await sell(voided.id, 500);
          await orm.update(transactions).set({ isDeleted: 1 }).where(eq(transactions.documentId, first));
          const voidRes = await admin.del(`/api/documents/${first}`);
          if (voidRes.status >= 300) throw new Error(`setup: voiding a legacy receipt returned ${voidRes.status} ${JSON.stringify(voidRes.body).slice(0, 200)}`);
          await approveAll();
        }
        return expectHealthy('six legacy void residues', await testOf(), 3);
      });

      // TD-1030: 103,500,060,145.5 rials sold in dollars at 600,000 is 172,500.1002 USD at 600,000.0002, worth
      // 103,500,060,155: rounded once as rials and again as amount × rate, 9.5 rials off, where half a rial and the rate's
      // 4th decimal on the amount allow 9.125; ten such sales
      const large = await inFiscalSandbox(async () => {
        const { receive, sell } = await stockFlows();
        for (let i = 0; i < 10; i++) {
          const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
          await receive(item.id, 1, 103_500_060_145.5);
          await sell(item.id, 200_000, { currency: 'USD', exchangeRate: 600_000 });
        }
        return expectHealthy('ten large dollar sales', await testOf(), 95);
      });

      // stockUnitPriceInIrr: 1,000,000 at 0.0001 USD and 1000.4999 is 0.10004999 rials a unit, recorded as 0.1000, while
      // the voucher carries 100,050 rials; with 1 at 49.98 before it the WAC 0.10004988 is recorded as 0.1000 too, so the
      // ledger is 99.88 rials over the warehouse, where the stock on hand alone allows 50
      const unit = await inFiscalSandbox(async () => {
        const { receive } = await stockFlows();
        const tiny = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
        await receive(tiny.id, 1, 49.98);
        await receive(tiny.id, 1_000_000, 0.0001, { currency: 'USD', exchangeRate: 1000.4999 });
        return expectHealthy('a dollar receipt of a large quantity', await testOf(), 99);
      });

      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `legacy voids: ${legacy}; large dollar sales: ${large}; large quantity: ${unit}`;
    });
  }

  return results;
}
