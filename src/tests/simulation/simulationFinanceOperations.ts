import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts, personnel, pieceworkTasks } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../../services/accounting/payrollPaymentVoid.service.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { ChequeLifecycleService } from '../../services/accounting/treasury/chequeLifecycle.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { PieceworkPayrollService } from '../../services/piecework/payroll.service.js';
import { PieceworkService } from '../../services/piecework.service.js';
import { CHEQUE_TRANSITIONS } from '../../lib/treasury/chequeTransitions.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { isoDay, type OpOutcome, type SimRandom } from './simulationOperations.js';

/**
 * v10.0.8 (TD-982, I-01) — treasury, cheque and payroll operations of the business-year simulator. Every operation goes
 * through the application services only, dated on the simulated day; a business refusal (AppError) is an allowed outcome.
 */

export interface SimParty { id: number; name: string }

export interface FinanceWorld {
  tag: string;
  customer: SimParty;
  supplier: SimParty;
  /** treasury rows, cheques and payroll payments the simulator recorded, for void and status steps */
  treasuryIds: number[];
  chequeIds: number[];
  payrollPayments: Array<{ payrollId: number; transactionId: number }>;
}

/**
 * Creates a bank with its own subsidiary ledger account under general account 10 (so I15 / I16 read only the simulator's
 * rows, and the account sits one level under its parent as the trial balance and the closing expect) and funds it
 */
export async function setupFinance(tag: string): Promise<{ bankAccountId: number; workerId: number; taskId: number }> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '10'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `10${Date.now().toString().slice(-9)}`, name: `Simulator bank ${tag}`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `Simulator bank ${tag}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR' });
  await TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount: 200000000, bankAccountId: bank.id, partyType: 'other',
    contraAccountId: await miscContraAccountId(), partyName: `Simulator capital ${tag}`, date: isoDay(0), username: 'sim',
  });
  const [worker] = await orm.insert(personnel).values({ fullName: `Simulator worker ${tag}`, salaryType: 'piecework', monthlySalary: money(0) })
    .returning({ id: personnel.id });
  const [task] = await orm.insert(pieceworkTasks).values({ code: `${tag}_PT`, title: `Simulator task ${tag}`, defaultRate: money(15000) })
    .returning({ id: pieceworkTasks.id });
  return { bankAccountId: bank.id, workerId: worker.id, taskId: task.id };
}

export function createFinanceOperations(random: SimRandom, world: FinanceWorld, ids: { bankAccountId: number; workerId: number; taskId: number }) {
  const { pick, between, chance } = random;
  const { customer, supplier } = world;
  let payrollFrom = 0;

  const treasuryReceipt = async (day: number): Promise<OpOutcome> => {
    const row = await TreasuryTransactionService.createTreasuryTransaction({
      type: 'receipt', method: chance(0.5) ? 'cash' : 'bank_transfer', amount: between(1, 40) * 50000, bankAccountId: ids.bankAccountId,
      partyType: 'customer', partyId: customer.id, partyName: customer.name, date: isoDay(day), username: 'sim',
    });
    world.treasuryIds.push(row.id);
    return { detail: `treasury receipt #${row.id} ${row.amount}`, tags: [] };
  };

  const treasuryPayment = async (day: number): Promise<OpOutcome> => {
    const row = await TreasuryTransactionService.createTreasuryTransaction({
      type: 'payment', method: 'bank_transfer', amount: between(1, 40) * 50000, bankAccountId: ids.bankAccountId,
      partyType: 'supplier', partyId: supplier.id, partyName: supplier.name, date: isoDay(day), username: 'sim',
    });
    world.treasuryIds.push(row.id);
    return { detail: `treasury payment #${row.id} ${row.amount}`, tags: [] };
  };

  const treasuryVoid = async (): Promise<OpOutcome> => {
    if (world.treasuryIds.length === 0) return { detail: 'skip:no-treasury-row', tags: [] };
    const id = pick(world.treasuryIds);
    const live = (await pool.query<{ status: string | null }>(`SELECT status FROM treasury_transactions WHERE id = $1`, [id])).rows[0];
    if (!live || live.status === 'voided') return { detail: 'skip:already-void', tags: [] };
    await TreasuryTransactionService.voidTreasuryTransaction(id, { reason: 'simulator void', username: 'sim' });
    return { detail: `void treasury #${id}`, tags: [] };
  };

  const chequeReceived = async (day: number): Promise<OpOutcome> => {
    const cheque = await ChequeLifecycleService.createCheque({
      type: 'received', chequeNumber: `${world.tag}-${world.chequeIds.length + 1}`, bankName: 'Mellat', issueDate: isoDay(day),
      dueDate: isoDay(day + 30), amount: between(1, 20) * 100000, partyType: 'customer', partyId: customer.id, partyName: customer.name, username: 'sim',
    });
    world.chequeIds.push(cheque.id);
    return { detail: `received cheque #${cheque.id}`, tags: [] };
  };

  /** One allowed transition of a recorded cheque, picked at random from the transition table */
  const chequeStep = async (day: number): Promise<OpOutcome> => {
    if (world.chequeIds.length === 0) return { detail: 'skip:no-cheque', tags: [] };
    const id = pick(world.chequeIds);
    const status = (await pool.query<{ status: string }>(`SELECT status FROM cheques WHERE id = $1`, [id])).rows[0]?.status ?? '';
    const next = (CHEQUE_TRANSITIONS as Readonly<Record<string, readonly string[]>>)[status] ?? [];
    if (next.length === 0) return { detail: `skip:cheque-${status}`, tags: [] };
    const to = pick(next);
    await ChequeLifecycleService.updateChequeStatus(id, {
      status: to, actionDate: isoDay(day), username: 'sim',
      ...(to === 'in_collection' || to === 'passed' ? { bankAccountId: ids.bankAccountId } : {}),
      ...(to === 'spent' ? { transfereePartyId: supplier.id } : {}),
    } as Parameters<typeof ChequeLifecycleService.updateChequeStatus>[1]);
    return { detail: `cheque #${id} ${status} -> ${to}`, tags: [to] };
  };

  /** Work logged on the day, a payslip for the days since the last one and a payment of part or all of it */
  const payroll = async (day: number): Promise<OpOutcome> => {
    if (day < payrollFrom) return { detail: 'skip:period-taken', tags: [] };
    await PieceworkService.logWorkEntries([{ personnelId: ids.workerId, taskId: ids.taskId, date: isoDay(day), quantity: between(1, 30) }]);
    const issued = await PieceworkPayrollService.generatePayroll({ personnelId: ids.workerId, startDate: isoDay(payrollFrom), endDate: isoDay(day), username: 'sim' });
    if (!issued.payroll) return { detail: `skip:payroll-${issued.status}`, tags: [] };
    payrollFrom = day + 1;
    const net = Number(issued.payroll.netPayable ?? 0);
    const partial = chance(0.4);
    const paid = await PayrollPaymentService.registerPayrollPayment({
      payrollId: issued.payroll.id, bankAccountId: ids.bankAccountId, amount: partial ? Math.max(1, Math.floor(net / 2)) : undefined,
      paymentDate: isoDay(day), username: 'sim',
    });
    world.payrollPayments.push({ payrollId: issued.payroll.id, transactionId: paid.transactionId });
    return { detail: `payroll #${issued.payroll.id} net ${net} paid ${partial ? 'half' : 'all'}`, tags: [partial ? 'partial' : 'full'] };
  };

  const payrollPaymentVoid = async (): Promise<OpOutcome> => {
    if (world.payrollPayments.length === 0) return { detail: 'skip:no-payroll-payment', tags: [] };
    const target = pick(world.payrollPayments);
    const live = (await pool.query<{ status: string | null }>(`SELECT status FROM treasury_transactions WHERE id = $1`, [target.transactionId])).rows[0];
    if (!live || live.status === 'voided') return { detail: 'skip:already-void', tags: [] };
    await PayrollPaymentVoidService.voidPayrollPayment({ ...target, reason: 'simulator void', username: 'sim' });
    return { detail: `void payroll payment #${target.transactionId} of payroll #${target.payrollId}`, tags: [] };
  };

  return { treasuryReceipt, treasuryPayment, treasuryVoid, chequeReceived, chequeStep, payroll, payrollPaymentVoid };
}
