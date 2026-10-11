import { pool } from '../../db/drizzle.js';
import { fin } from '../../lib/financialDecimal.js';
import { DocumentService } from '../../services/document.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { KardexWacRecalculatorService } from '../../services/inventory/kardexWacRecalculator.service.js';
import { createTestItem } from '../fixtures/factories.js';
import type { InvariantScope } from './businessInvariants.js';
import { invariantProblems, itemState, receive, watermarks } from './scenarioHelpers.js';

/**
 * v10.0.84 (TD-1147): voiding a receipt whose removal empties the item's stock, or leaves a negative remaining value, keeps
 * the item's weighted average cost (the same formula the Kardex replay uses), while the receipt's voucher is voided at its
 * full value. Before this fix the difference stayed in the inventory accounts with no stock behind it (I3). The void now
 * posts that difference in its own transaction as a draft voucher against «کسری و اضافات انبار» (7012).
 */

interface ResidueVoucher { id: number; status: string; inventoryNet: string; differenceNet: string }

async function residueVouchers(documentId: number): Promise<ResidueVoucher[]> {
  const res = await pool.query<{ id: number; status: string; inv: string; diff: string }>(
    `SELECT v.id, v.status,
            COALESCE(SUM(CASE WHEN a.code IN ('1401', '1403') THEN i.debit - i.credit END), 0)::text AS inv,
            COALESCE(SUM(CASE WHEN a.code = '7012' THEN i.debit - i.credit END), 0)::text AS diff
       FROM journal_vouchers v
       JOIN journal_voucher_items i ON i.voucher_id = v.id AND i.is_deleted = 0
       JOIN accounts a ON a.id = i.account_id
      WHERE v.reference_module = 'inventory' AND v.reference_id = $1 AND v.reference_number LIKE 'VOID-RESIDUE-%' AND v.is_deleted = 0
      GROUP BY v.id, v.status`, [documentId]);
  return res.rows.map(r => ({ id: r.id, status: r.status, inventoryNet: fin(r.inv).toString(), differenceNet: fin(r.diff).toString() }));
}

async function remit(itemId: number, quantity: number, wh: string, date: string): Promise<number> {
  return DocumentService.createDocument({
    docType: 'remittance', inOut: 'out', status: 'final', date, user: 'inv', buyerName: 'مصرف آزمون ابطال رسید',
    items: [{ itemId, quantity, unitPrice: 0, location: wh }],
  });
}

async function approveDocumentVoucher(documentId: number): Promise<void> {
  const vouchers = await pool.query<{ id: number }>('SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [documentId]);
  await VoucherService.approveJournalVouchers(vouchers.rows.map(v => v.id), undefined, 'inv');
}

export async function checkVoidReceiptResidue(wh: string): Promise<string[]> {
  const problems: string[] = [];
  const mark = await watermarks();
  const emptied = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const emptiedApproved = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  const negative = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const plain = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const scope: InvariantScope = { ...mark, itemIds: [emptied.id, emptiedApproved.id, negative.id, plain.id] };

  // 5 × 200,000 and 5 × 100,000 (WAC 150,000), 5 out, void the cheap receipt: stock 0, 250,000 left in the ledger
  const cases: Array<[string, { id: number }, boolean, string]> = [
    ['emptied stock, draft receipt voucher', emptied, false, '1401'],
    ['emptied stock, approved receipt voucher', emptiedApproved, true, '1403'],
  ];
  for (const [label, item, approve] of cases) {
    const caseMark = await watermarks();
    await receive(item.id, 5, 200000, wh, '2026-05-01');
    const cheap = await receive(item.id, 5, 100000, wh, '2026-05-02');
    if (approve) await approveDocumentVoucher(cheap);
    await remit(item.id, 5, wh, '2026-05-03');
    await DocumentService.deleteDocument(cheap, 'inv');
    const state = await itemState(item.id);
    if (state.stock !== 0 || !fin(state.wac).equals(150000)) problems.push(`${label}: stock ${state.stock} and WAC ${state.wac}, expected 0 and 150,000`);
    const vouchers = await residueVouchers(cheap);
    if (vouchers.length !== 1) {
      problems.push(`${label}: ${vouchers.length} residue vouchers, expected one`);
    } else {
      const [v] = vouchers;
      if (v.status !== 'draft' || !fin(v.inventoryNet).equals(-250000) || !fin(v.differenceNet).equals(250000)) {
        problems.push(`${label}: residue voucher ${v.status}, inventory ${v.inventoryNet}, 7012 ${v.differenceNet}; expected draft, -250,000 and 250,000`);
      }
    }
    // each case on its own: the gaps of different cases would cancel in one sum
    problems.push(...await invariantProblems({ ...caseMark, itemIds: [item.id] }, label));
  }

  // 5 × 100,000 and 5 × 300,000 (WAC 200,000), 4 out (stock 6, value 1,200,000), void the dear receipt: the remaining
  // value is -300,000, so WAC stays 200,000 for the one unit left; 500,000 is brought back to the inventory account
  const negativeMark = await watermarks();
  await receive(negative.id, 5, 100000, wh, '2026-05-01');
  const dear = await receive(negative.id, 5, 300000, wh, '2026-05-02');
  await remit(negative.id, 4, wh, '2026-05-03');
  await DocumentService.deleteDocument(dear, 'inv');
  const negState = await itemState(negative.id);
  if (negState.stock !== 1 || !fin(negState.wac).equals(200000)) problems.push(`negative remaining value: stock ${negState.stock} and WAC ${negState.wac}, expected 1 and 200,000`);
  const negVouchers = await residueVouchers(dear);
  if (negVouchers.length !== 1 || !fin(negVouchers[0].inventoryNet).equals(500000) || !fin(negVouchers[0].differenceNet).equals(-500000)) {
    problems.push(`negative remaining value: residue vouchers ${JSON.stringify(negVouchers)}, expected one with inventory 500,000 and 7012 -500,000`);
  }
  problems.push(...await invariantProblems({ ...negativeMark, itemIds: [negative.id] }, 'negative remaining value'));

  // A void whose WAC is recalculated leaves no residue and gets no extra voucher
  await receive(plain.id, 5, 200000, wh, '2026-05-01');
  const plainReceipt = await receive(plain.id, 5, 100000, wh, '2026-05-02');
  await DocumentService.deleteDocument(plainReceipt, 'inv');
  if ((await residueVouchers(plainReceipt)).length !== 0) problems.push('a void that recalculates WAC issued a residue voucher');

  // The live WAC is still the one the Kardex replay gives
  for (const item of [emptied, emptiedApproved, negative, plain]) {
    const state = await itemState(item.id);
    const rebuilt = await KardexWacRecalculatorService.rebuildItemFromLedger(item.id, { user: 'inv' });
    if (fin(rebuilt.replayWac).subtract(fin(state.wac)).abs().greaterThan(fin(0.01))) problems.push(`item ${item.id}: Kardex replay WAC ${rebuilt.replayWac}, live WAC ${state.wac}`);
  }
  problems.push(...await invariantProblems(scope, 'after voiding the receipts'));
  return problems;
}

export const VOID_RESIDUE_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_1147_void_receipt_residue', 'v10.0.84: voiding a receipt that empties stock or leaves a negative remaining value posts the leftover inventory value to inventory count differences (TD-1147)',
    checkVoidReceiptResidue, 'draft 7012 voucher for emptied stock (draft and approved receipt voucher) and for a negative remaining value; none when WAC is recalculated; I3 held'],
];
