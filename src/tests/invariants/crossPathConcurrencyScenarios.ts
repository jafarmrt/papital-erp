import { pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { TreasuryTransactionService } from '../../services/accounting/treasury/treasuryTransaction.service.js';
import { DocumentService } from '../../services/document.service.js';
import { ProjectBomAllocationService } from '../../services/inventory/projectBomAllocation.service.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { ProjectService } from '../../services/projects.service.js';
import { createTestCustomer, createTestItem, createTestUser } from '../fixtures/factories.js';
import { runBusinessYearSimulation } from '../simulation/businessYearSimulator.js';
import type { InvariantScope } from './businessInvariants.js';
import { accountIdByCode, outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v10.0.36 (I-03, series 10 phase 3 lane L3): races between two different paths that touch the same rows. The existing
 * concurrency checks race one path against itself (two voids, two deliveries, two receipts); these race a project
 * delivery with a purchase requisition's «دریافت کالا», a material allocation with a remittance, and two invoice
 * settlements (and a settlement with the invoice's void). Every operation queues behind one held row lock and then runs
 * at once, as in `raceBehindRowLock`. Each function returns its problems; an empty list is correct behaviour.
 */

const ADMIN = { username: 'inv', role: 'admin', permissions: [] as string[] };
/** The refusal of a stock movement beyond the sellable stock (TD-775 / TD-905): «امکان خروج بیش از …» or «… کافی نیست» */
const SELLABLE_REFUSALS = ['امکان خروج بیش از', 'کافی نیست'];
const notEnough = (message: string) => SELLABLE_REFUSALS.some(text => message.includes(text));
/** The void's refusal while a receipt is live (TD-779), and the receipt's refusal of a voided invoice (TD-501) */
const VOID_REFUSAL_WITH_RECEIPT = 'دریافت';
const RECEIPT_REFUSALS_OF_VOIDED = ['باطل', 'یافت نشد', 'فعال'];

let seq = 0;
const tag = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}-${++seq}`;

async function newItem(itemIds: number[], type: 'product' | 'raw_material'): Promise<number> {
  const item = await createTestItem({ type, stocks: {}, weightedAverageCost: 0 });
  itemIds.push(item.id);
  return item.id;
}

async function openProject(title: string, products: Array<{ itemId: number; quantity: number }> = []): Promise<number> {
  const { project } = await ProjectService.createProject({
    title, startDate: await businessTodayIsoDate(), quantity: 1,
    products: products.map((p, i) => ({ id: `prod-${i + 1}`, item_id: p.itemId, item_code: '', item_name: 'cross-path product', customer_code: '', quantity: p.quantity, unit: 'عدد', needs_assembly: false })),
  } as Parameters<typeof ProjectService.createProject>[0]);
  return project.id;
}

/** An approved purchase requisition of `quantity` with one draft order at `unitPrice`; returns its id */
async function orderedRequisition(itemId: number, quantity: number, unitPrice: number, wh: string): Promise<number> {
  const res = await pool.query<{ code: string; name: string }>('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const req = await ProcurementService.createRequisition({
    title: 'cross-path requisition',
    items: [{ itemId, itemCode: res.rows[0]?.code, itemName: res.rows[0]?.name, unit: 'عدد', requestedQty: quantity, unitPriceEstimate: unitPrice }],
  }, ADMIN);
  await ProcurementService.convertToPurchaseOrders({
    requisitionId: req.id,
    orderGroups: [{ supplierName: 'cross-path supplier', targetWarehouse: wh, status: 'draft', items: [{ itemId, quantity, unitPrice }] }],
  }, ADMIN);
  return req.id;
}

/**
 * A project delivery («ورود به انبار») and a purchase requisition's «دریافت کالا» bring the same item into stock at the same
 * moment, at two costs. Both are accepted, stock and the Kardex hold both quantities, and the weighted average cost is
 * the one of the two entries in either order.
 */
export async function checkDeliveryAndReceiveShareItem(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const itemIds: number[] = [];
  const item = await newItem(itemIds, 'product');
  const projectId = await openProject('cross-path delivery', [{ itemId: item, quantity: 5 }]);
  const requisitionId = await orderedRequisition(item, 4, 300_000, wh);

  const outcomes = await raceBehindRowLock<unknown>('items', [item], [
    () => ProjectService.addProjectToInventory({ projectId, itemsToAdd: [{ itemId: item, quantity: 5, unitPrice: 120_000, location: wh }], currentUser: 'inv' }),
    () => ProcurementService.executeWorkflowAction(requisitionId, 'receive_items', ADMIN),
  ]);
  problems.push(...outcomeProblems(['project delivery', 'receive items'], outcomes, () => false));

  const { stock, wac } = await itemState(item);
  if (stock !== 9) problems.push(`stock after a delivery of 5 and a receipt of 4 is ${stock}, not 9`);
  // (5 × 120,000 + 4 × 300,000) ÷ 9 = 200,000 whichever entry ran first
  if (Number(wac) !== 200_000) problems.push(`the weighted average cost after both entries is ${wac}, not 200000`);
  const scope: InvariantScope = { ...mark, itemIds };
  problems.push(...await invariantProblems(scope, 'after a concurrent project delivery and receive items'));
  return problems;
}

/**
 * A material allocation to a project and a remittance draw on the same 10 units: 6 and 6 cannot both leave. Exactly one
 * is accepted, the other is refused as beyond the stock, and stock never goes below zero. With the units reserved for the
 * project, the remittance never takes them and the allocation does.
 */
export async function checkAllocationAndRemittanceShareStock(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const itemIds: number[] = [];
  const today = await businessTodayIsoDate();
  const remittance = (itemId: number, quantity: number) => DocumentService.createDocumentWithDetails({
    docType: 'remittance', inOut: 'out', status: 'final', date: today, user: 'inv', buyerName: 'cross-path remittance',
    items: [{ itemId, quantity, unitPrice: 0, location: wh }],
  });
  const allocate = (projectId: number, itemId: number, quantity: number) =>
    ProjectBomAllocationService.allocateMaterialsForProject({ projectId, allocations: [{ itemId, quantity, location: wh }], username: 'inv' });

  // 1) free stock: 6 and 6 of 10
  const free = await newItem(itemIds, 'raw_material');
  await receive(free, 10, 1_000, wh, today);
  const projectId = await openProject('cross-path allocation');
  const race = await raceBehindRowLock<unknown>('items', [free], [() => allocate(projectId, free, 6), () => remittance(free, 6)]);
  problems.push(...outcomeProblems(['allocation', 'remittance'], race, (_label, message) => notEnough(message)));
  const accepted = race.filter(o => o.status === 'fulfilled').length;
  if (accepted !== 1) problems.push(`${accepted} of a concurrent allocation of 6 and remittance of 6 from 10 were accepted, not one`);
  const { stock } = await itemState(free);
  if (stock !== 4) problems.push(`stock after the race over 10 units is ${stock}, not 4`);

  // 2) the 10 units reserved for the project: the remittance is refused, the allocation passes
  const reserved = await newItem(itemIds, 'raw_material');
  await receive(reserved, 10, 1_000, wh, today);
  const [it] = (await pool.query<{ code: string; name: string }>('SELECT code, name FROM items WHERE id = $1', [reserved])).rows;
  const { project } = await ProjectService.createProject({
    title: 'cross-path reserving project', startDate: today, quantity: 1, products: [],
    inventoryControl: { isFinalized: true, manualPurchaseItems: [], sections: [{ id: 'sec-1', title: 'materials', checkType: 'global', globalItems: [{ itemCode: it.code, name: it.name, unit: 'عدد', requiredQty: 10 }] }] },
  } as Parameters<typeof ProjectService.createProject>[0]);
  const reservedRace = await raceBehindRowLock<unknown>('items', [reserved], [() => remittance(reserved, 4), () => allocate(project.id, reserved, 10)]);
  if (reservedRace[1].status !== 'fulfilled') problems.push(`allocating the project's own reserved 10 concurrently with a remittance was refused (${String((reservedRace[1] as PromiseRejectedResult).reason?.message ?? '').slice(0, 160)})`);
  if (reservedRace[0].status === 'fulfilled') problems.push('a remittance took 4 units reserved for a project while the project allocated them');
  problems.push(...outcomeProblems(['remittance', 'allocation'], reservedRace, (label, message) => label === 'remittance' && notEnough(message)));
  const after = await itemState(reserved);
  if (after.stock !== 0) problems.push(`stock of the reserved item after the allocation of 10 is ${after.stock}, not 0`);

  const scope: InvariantScope = { ...mark, itemIds };
  problems.push(...await invariantProblems(scope, 'after a concurrent allocation and remittance'));
  return problems;
}

/**
 * Two receipts settle one sales invoice at the same moment through two banks, and a receipt races the invoice's void.
 * The two receipts are both recorded, each bank holds its own amount and the invoice's paid amount is their sum; of a
 * receipt and a void exactly one wins: either the void is refused because the invoice has a treasury row (TD-779) or the
 * receipt is refused because the invoice is voided.
 */
export async function checkConcurrentSettlements(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const itemIds: number[] = [];
  const today = await businessTodayIsoDate();
  const customer = await createTestCustomer({ partyType: 'customer' });
  // a subsidiary ledger account of its own under general account 10, as treasury accounts require (TD-510) and I18 expects
  const parent = await accountIdByCode('10');
  const [ledgerRow] = (await pool.query<{ id: number }>(
    `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
     VALUES ($1, $2, 'subsidiary', $3, 'asset', 'debit', 0, 1, 0) RETURNING id`, [`10${Date.now().toString().slice(-9)}`, `cross-path bank ${tag('L')}`, parent])).rows;
  const ledger = ledgerRow.id;
  const bankA = await BankAccountService.createBankAccount({ title: `cross-path bank ${tag('A')}`, type: 'bank', accountId: ledger, initialBalance: 0, currency: 'IRR' });
  const bankB = await BankAccountService.createBankAccount({ title: `cross-path bank ${tag('B')}`, type: 'bank', accountId: ledger, initialBalance: 0, currency: 'IRR' });
  const item = await newItem(itemIds, 'product');
  await receive(item, 10, 100_000, wh, today);
  const invoice = async () => (await DocumentService.createDocumentWithDetails({
    docType: 'invoice', inOut: 'out', status: 'final', date: today, user: 'inv', buyerName: customer.name, partyId: customer.id,
    items: [{ itemId: item, quantity: 2, unitPrice: 500_000, location: wh }],
  })).docId;
  const settle = (documentId: number, bankAccountId: number, amount: number) => TreasuryTransactionService.createTreasuryTransaction({
    type: 'receipt', method: 'bank_transfer', amount, bankAccountId, partyType: 'customer', partyId: customer.id, partyName: customer.name,
    documentId, date: today, username: 'inv',
  });
  const balance = async (bankId: number) =>
    Number((await pool.query<{ b: string }>('SELECT current_balance::text AS b FROM bank_accounts WHERE id = $1', [bankId])).rows[0]?.b ?? 0);
  const liveReceipts = async (documentId: number) => Number((await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM treasury_transactions WHERE document_id = $1 AND status = 'completed' AND reversal_of_id IS NULL`, [documentId])).rows[0]?.n ?? 0);

  // 1) two receipts of 600,000 and 400,000 through two banks
  const first = await invoice();
  const two = await raceBehindRowLock<unknown>('documents', [first], [() => settle(first, bankA.id, 600_000), () => settle(first, bankB.id, 400_000)]);
  problems.push(...outcomeProblems(['receipt A', 'receipt B'], two, () => false));
  if (await balance(bankA.id) !== 600_000 || await balance(bankB.id) !== 400_000) problems.push(`bank balances after two concurrent receipts are ${await balance(bankA.id)} and ${await balance(bankB.id)}, not 600000 and 400000`);
  if (await liveReceipts(first) !== 2) problems.push(`the invoice has ${await liveReceipts(first)} live receipts after two concurrent receipts, not 2`);

  // 2) a receipt and the invoice's void, both waiting behind the invoice row
  const second = await invoice();
  const voidRace = await raceBehindRowLock<unknown>('documents', [second], [
    () => settle(second, bankA.id, 1_000_000),
    () => DocumentService.deleteDocument(second, 'inv'),
  ]);
  problems.push(...outcomeProblems(['receipt', 'void'], voidRace, (label, message) =>
    (label === 'void' && message.includes(VOID_REFUSAL_WITH_RECEIPT))
      || (label === 'receipt' && RECEIPT_REFUSALS_OF_VOIDED.some(text => message.includes(text)))));
  const won = voidRace.filter(o => o.status === 'fulfilled').length;
  if (won !== 1) problems.push(`${won} of a concurrent receipt and void of one invoice were accepted, not one`);
  const voided = Number((await pool.query<{ d: number }>('SELECT is_deleted AS d FROM documents WHERE id = $1', [second])).rows[0]?.d ?? 0) === 1;
  const receipts = await liveReceipts(second);
  if (voided && receipts > 0) problems.push(`the voided invoice keeps ${receipts} live receipt(s)`);
  if (!voided && receipts !== 1) problems.push(`the invoice that was not voided has ${receipts} live receipts, not 1`);

  const scope: InvariantScope = { ...mark, itemIds };
  problems.push(...await invariantProblems(scope, 'after concurrent settlements'));
  return problems;
}

/**
 * The business-year simulator with twelve users at once: every operation of a round starts together. No round may end in a
 * deadlock or a non-business error, and every invariant holds after the rounds. Each kind of operation of the default mix
 * runs, and most rounds hold operations that touch the same items, banks and documents.
 */
export async function checkSimulatorWithConcurrentUsers(): Promise<string[]> {
  // the simulator signs approvals as an existing user and creates none
  await createTestUser({ role: 'admin' });
  const run = await runBusinessYearSimulation({ seed: 21, steps: 144, checkEvery: 3, users: 12 });
  const problems = run.findings.map(f => `step ${f.firstStep} ${f.firstOp}: ${f.invariant} ${f.key}: ${f.message}`);
  if (run.steps.length !== 144) problems.push(`the run recorded ${run.steps.length} steps, not 144`);
  if (run.counts.ok < 60) problems.push(`only ${run.counts.ok} of 144 concurrent operations succeeded`);
  return problems;
}
