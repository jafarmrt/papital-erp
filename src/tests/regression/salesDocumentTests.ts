import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';

/**
 * Package 8 (documents and invoices), PR B: the money of sales documents (zero-price invoices, voiding an invoice that has
 * returns or receipts, the VAT and amount of a sales return), through the real Express routes with real sessions. Each case
 * reproduces a finding of the package 8 review and is red on the code before its fix.
 */
export async function runSalesDocumentTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_zero_price_invoice_voucher_td_772',
      'v9.0.243: a final sales invoice with zero gross gets a voucher that moves its Kardex cost from inventory to cost of sales (TD-772)',
      ['td772', 'documents', 'voucher', 'cogs', 'package8'], zeroPriceInvoiceCase],
    ['reg_void_invoice_with_returns_td_773',
      'v9.0.244: an invoice with a sales return that is not voided is not voided (409 naming the returns); after the return is voided it is (TD-773)',
      ['td773', 'documents', 'void', 'return', 'package8'], voidWithReturnsCase],
    ['reg_void_invoice_with_receipts_td_779',
      'v9.0.245: a document with a live treasury receipt is not voided (409 naming it); the receipt is moved on account or to another document of the same party, then the void goes through (TD-779)',
      ['td779', 'documents', 'void', 'treasury', 'package8'], voidWithReceiptsCase],
    ['reg_return_price_from_invoice_td_788',
      'v9.0.246: a sales return of an invoice takes its currency, rate and net unit price from that invoice; another price, currency, rate or a line discount is 422, also on draft edit and finalize (TD-788)',
      ['td788', 'documents', 'return', 'currency', 'package8'], returnPriceFromInvoiceCase],
    ['reg_return_vat_from_invoice_td_774',
      'v9.0.247: a sales return of an invoice takes the invoice VAT in proportion to the returned net (cumulative, so a full return gives all of it back) and its voucher debits VAT payable; a return without an invoice takes the user percent (TD-774)',
      ['td774', 'documents', 'return', 'vat', 'package8'], returnVatFromInvoiceCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

interface VoucherRow { accountId: number; code: string; debit: number; credit: number }

/** Active rows of the active voucher(s) issued for a document, and how many such vouchers there are */
async function documentVoucher(h: Harness, docId: number): Promise<{ count: number; rows: VoucherRow[] }> {
  const vouchers = await h.q(`SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [docId]);
  const rows = await h.q(
    `SELECT i.account_id AS "accountId", a.code, i.debit::float8 AS debit, i.credit::float8 AS credit
       FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
      WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 ORDER BY i.id`,
    [docId],
  );
  return { count: vouchers.length, rows: rows as unknown as VoucherRow[] };
}

const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
const rowsText = (rows: VoucherRow[]) => rows.map(r => `${r.code} ${r.debit}/${r.credit}`).join(', ') || 'none';

/** B08-03 (TD-772): a final invoice at price 0 left stock at WAC but had no voucher */
async function zeroPriceInvoiceCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const cogs = await AccountMappingService.getCostOfGoodsSoldAccount();
  const finished = await AccountMappingService.getInventoryFinishedGoodsAccount();
  if (!cogs || !finished) throw new Error('the cost of sales or finished goods account is not mapped');

  const expectCostOnly = async (docId: number, cost: number, label: string) => {
    const { count, rows } = await documentVoucher(h, docId);
    const debitCogs = rows.filter(r => r.accountId === cogs.id).reduce((s, r) => s + r.debit, 0);
    const creditStock = rows.filter(r => r.accountId === finished.id).reduce((s, r) => s + r.credit, 0);
    const others = rows.filter(r => r.accountId !== cogs.id && r.accountId !== finished.id);
    if (count !== 1 || Math.abs(debitCogs - cost) > 0.001 || Math.abs(creditStock - cost) > 0.001 || others.length > 0) {
      wrong.push(`${label}: ${count} voucher(s) with rows ${rowsText(rows)}, expected one voucher with cost of sales ${cost} debit and finished goods ${cost} credit only`);
    }
  };

  // 1) a final invoice of 2 units at price 0, WAC 50,000: Dr cost of sales 100,000 / Cr finished goods 100,000
  const a = await f.item(10, 50_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 2, unit_price: 0, location: f.wh }]));
  if (invoice.status !== 200) wrong.push(`a zero-price final invoice answered ${brief(invoice)}, expected 200`);
  else await expectCostOnly(docIdOf(invoice), 100_000, 'zero-price final invoice');

  // 2) a zero-price proforma finalized into an invoice gets the same voucher
  const b = await f.item(10, 30_000);
  const proforma = await h.post('/api/documents', f.doc('proforma', 'proforma', [{ itemId: b, quantity: 1, unit_price: 0, location: f.wh }]));
  const proformaId = docIdOf(proforma);
  const finalized = await h.put(`/api/documents/${proformaId}/finalize`, {});
  if (proforma.status !== 200 || finalized.status !== 200) wrong.push(`a zero-price proforma and its finalize answered ${brief(proforma)} and ${brief(finalized)}, expected 200 and 200`);
  else await expectCostOnly(proformaId, 30_000, 'finalized zero-price proforma');

  return 'a final invoice of 2 units at price 0 and WAC 50,000, and a finalized zero-price proforma, each get one voucher: Dr cost of sales / Cr finished goods at the Kardex cost, with no revenue or customer row';
}

/** B08-04 (TD-773): voiding an invoice with an active return brought the returned goods back twice */
async function voidWithReturnsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  // the stock enters through a receipt, so the Kardex holds it and the return can be voided (TD-265 reads the ledger)
  const a = await f.item(0, 1_000);
  const receipt = await h.post('/api/documents', f.doc('receipt', 'final', [{ itemId: a, quantity: 10, unit_price: 1_000, location: f.wh }]));
  if (receipt.status !== 200) throw new Error(`setup: receipt ${brief(receipt)}`);
  const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
  const textOf = (res: { body?: unknown }) => String((res.body as { error?: unknown })?.error ?? (res.body as { message?: unknown })?.message ?? '');
  const isDeleted = async (id: number) => Number((await h.q(`SELECT is_deleted FROM documents WHERE id = $1`, [id]))[0]?.is_deleted);

  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 5, unit_price: 3_000, location: f.wh }]));
  const invoiceId = docIdOf(invoice);
  const ret = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 2, unit_price: 3_000, location: f.wh }], { returnOfDocumentId: invoiceId }));
  const returnId = docIdOf(ret);
  if (invoice.status !== 200 || ret.status !== 200 || await f.stock(a) !== 7) {
    throw new Error(`setup: invoice ${brief(invoice)}, return ${brief(ret)}, stock ${await f.stock(a)} (expected 200, 200 and 7)`);
  }
  const [retRow] = await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [returnId]);

  // 1) the invoice is not voided while its final return stands: 409 naming the return, nothing moves
  const refused = await h.del(`/api/documents/${invoiceId}`);
  if (refused.status !== 409 || codeOf(refused) !== 'DOCUMENT_HAS_ACTIVE_RETURNS' || !textOf(refused).includes(String(retRow?.ref_number))) {
    wrong.push(`voiding an invoice with a final return answered ${brief(refused)}, expected 409 DOCUMENT_HAS_ACTIVE_RETURNS naming the return`);
  }
  if (await isDeleted(invoiceId) !== 0 || await f.stock(a) !== 7) wrong.push(`the refused void left the invoice deleted=${await isDeleted(invoiceId)} and stock ${await f.stock(a)}, expected 0 and 7`);

  // 2) a draft return counts too
  const returnVoided = await h.del(`/api/documents/${returnId}`);
  if (returnVoided.status !== 200) wrong.push(`voiding the final return answered ${brief(returnVoided)}, expected 200`);
  const draft = await h.post('/api/documents', f.doc('return', 'draft', [{ itemId: a, quantity: 1, unit_price: 3_000, location: f.wh }], { returnOfDocumentId: invoiceId }));
  const draftRefused = await h.del(`/api/documents/${invoiceId}`);
  if (draft.status !== 200 || draftRefused.status !== 409) wrong.push(`a draft return (${brief(draft)}) did not stop the void: ${brief(draftRefused)}, expected 409`);

  // 3) once its returns are voided, the invoice is voided and the stock is the purchase quantity again
  const draftVoided = await h.del(`/api/documents/${docIdOf(draft)}`);
  if (draftVoided.status !== 200) wrong.push(`voiding the draft return answered ${brief(draftVoided)}, expected 200`);
  const voided = await h.del(`/api/documents/${invoiceId}`);
  if (voided.status !== 200 || await isDeleted(invoiceId) !== 1 || await f.stock(a) !== 10) {
    wrong.push(`voiding the invoice after its returns answered ${brief(voided)} with stock ${await f.stock(a)}, expected 200 and 10`);
  }
  return 'an invoice of 5 with a final return of 2 is not voided (409 naming the return, stock stays 7), a draft return also stops it, and after both returns are voided the invoice is voided and stock is 10';
}

/** B08-10 (TD-779): a settled invoice was voided silently and its receipt stayed linked to the voided document */
async function voidWithReceiptsCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { createBank } = await import('./treasuryPartyTests.js');
  const { createTestCustomer } = await import('../fixtures/factories.js');
  const bank = await createBank('P8 TD-779 bank');
  const party = `P8 party ${h.tag}`;
  const customer = await createTestCustomer({ name: party });
  const a = await f.item(10, 1_000);
  const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
  const textOf = (res: { body?: unknown }) => String((res.body as { error?: unknown })?.error ?? (res.body as { message?: unknown })?.message ?? '');
  const docRow = async (id: number) => (await h.q(`SELECT is_deleted FROM documents WHERE id = $1`, [id]))[0];
  const txRow = async (id: number) => (await h.q(`SELECT document_id, voucher_id, status FROM treasury_transactions WHERE id = $1`, [id]))[0];
  const sale = async (buyer = party) => docIdOf(await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 1, unit_price: 3_000_000, location: f.wh }], { buyer_name: buyer })));

  const invoiceId = await sale();
  const receipt = await h.post('/api/accounting/treasury', {
    type: 'receipt', method: 'bank_transfer', bankAccountId: bank.id, amount: 3_000_000, date: f.today,
    partyType: 'customer', partyId: customer.id, partyName: party, documentId: invoiceId,
  });
  const receiptId = Number((receipt.body as { id?: unknown })?.id);
  if (![200, 201].includes(receipt.status) || !receiptId) throw new Error(`setup: receipt ${brief(receipt)}`);
  const receiptBefore = await txRow(receiptId);
  const number = String((await h.q(`SELECT transaction_number FROM treasury_transactions WHERE id = $1`, [receiptId]))[0]?.transaction_number);

  // 1) the settled invoice is not voided: 409 naming the receipt, nothing changes
  const refused = await h.del(`/api/documents/${invoiceId}`);
  if (refused.status !== 409 || codeOf(refused) !== 'DOCUMENT_HAS_TREASURY_ROWS' || !textOf(refused).includes(number)) {
    wrong.push(`voiding a settled invoice answered ${brief(refused)}, expected 409 DOCUMENT_HAS_TREASURY_ROWS naming ${number}`);
  }
  if (Number((await docRow(invoiceId))?.is_deleted) !== 0) wrong.push('the refused void deleted the invoice');

  // 2) a reader of the treasury cannot move the receipt; the treasury user moves it on account and the voucher stays
  const reader = await h.sessionWith(['accounting.view']);
  const readerMove = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: null }, reader);
  if (readerMove.status !== 403) wrong.push(`accounting.view moved a receipt with ${brief(readerMove)}, expected 403`);
  const detached = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: null });
  const afterDetach = await txRow(receiptId);
  if (detached.status !== 200 || afterDetach?.document_id !== null || afterDetach?.voucher_id !== receiptBefore?.voucher_id) {
    wrong.push(`moving the receipt on account answered ${brief(detached)} and left ${JSON.stringify(afterDetach)}, expected 200, no document and the same voucher`);
  }
  const voided = await h.del(`/api/documents/${invoiceId}`);
  if (voided.status !== 200) wrong.push(`voiding the invoice after its receipt moved on account answered ${brief(voided)}, expected 200`);

  // 3) the receipt goes to another invoice of the same party, never to a voided one or another party's
  const toVoided = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: invoiceId });
  if (toVoided.status !== 422 || codeOf(toVoided) !== 'TREASURY_DOCUMENT_INVALID') wrong.push(`moving the receipt to the voided invoice answered ${brief(toVoided)}, expected 422 TREASURY_DOCUMENT_INVALID`);
  const otherParty = await sale(`P8 other party ${h.tag}`);
  const toOther = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: otherParty });
  if (toOther.status !== 422 || codeOf(toOther) !== 'TREASURY_DOCUMENT_PARTY_MISMATCH') wrong.push(`moving the receipt to another party's invoice answered ${brief(toOther)}, expected 422 TREASURY_DOCUMENT_PARTY_MISMATCH`);
  const second = await sale();
  const moved = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: second });
  if (moved.status !== 200 || (await txRow(receiptId))?.document_id !== second) wrong.push(`moving the receipt to another invoice of the party answered ${brief(moved)}, expected 200 and the new link`);
  const secondRefused = await h.del(`/api/documents/${second}`);
  if (secondRefused.status !== 409) wrong.push(`the second invoice with the moved receipt was voided: ${brief(secondRefused)}, expected 409`);

  // 4) a voided receipt and its reversal do not hold the invoice
  const receiptVoid = await h.post(`/api/accounting/treasury/${receiptId}/void`, { reason: 'TD-779 test' });
  const secondVoided = await h.del(`/api/documents/${second}`);
  if (receiptVoid.status !== 200 || secondVoided.status !== 200) wrong.push(`after voiding the receipt (${brief(receiptVoid)}) the invoice void answered ${brief(secondVoided)}, expected 200 and 200`);
  const movedVoided = await h.put(`/api/accounting/treasury/${receiptId}/document`, { documentId: null });
  if (movedVoided.status !== 409 || codeOf(movedVoided) !== 'TREASURY_ROW_NOT_RELINKABLE') wrong.push(`moving a voided receipt answered ${brief(movedVoided)}, expected 409 TREASURY_ROW_NOT_RELINKABLE`);
  return 'a settled invoice is not voided (409 naming the receipt); accounting.view cannot move it; the treasury user moves it on account with its voucher unchanged and the void goes through; it moves to another invoice of the party but not to a voided invoice or another party\'s; a voided receipt does not hold the invoice and is not moved';
}

interface ReturnVoucherRow { code: string; debit: number; credit: number; currency: string; rate: number | null }

/** B08-19 (TD-788): the amount, currency and rate of a sales return came from the request body, not from its invoice */
async function returnPriceFromInvoiceCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  if (!receivable) throw new Error('the trade receivables account is not mapped');
  const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
  const returnsOf = async (invoiceId: number) => Number((await h.q(`SELECT COUNT(*)::int AS n FROM documents WHERE return_of_document_id = $1`, [invoiceId]))[0]?.n);
  const linesOf = async (docId: number) => (await h.q(
    `SELECT unit_price::float8 AS price, discount::float8 AS discount FROM document_items WHERE document_id = $1 AND is_deleted = 0 ORDER BY id`, [docId],
  )) as Array<{ price: number; discount: number }>;
  const headOf = async (docId: number) => (await h.q(`SELECT currency, exchange_rate::float8 AS rate, status FROM documents WHERE id = $1`, [docId]))[0];
  const customerCredit = async (docId: number) => {
    const rows = (await h.q(
      `SELECT a.code, i.debit::float8 AS debit, i.credit::float8 AS credit, COALESCE(i.currency, v.currency, 'IRR') AS currency,
              i.exchange_rate::float8 AS rate
         FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id JOIN accounts a ON a.id = i.account_id
        WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2`,
      [docId, receivable.id],
    )) as unknown as ReturnVoucherRow[];
    return rows;
  };
  const expectRefused = async (label: string, res: { status: number; body?: unknown }, code: string, invoiceId: number, before: number) => {
    if (res.status !== 422 || codeOf(res) !== code) wrong.push(`${label} answered ${brief(res)}, expected 422 ${code}`);
    if (await returnsOf(invoiceId) !== before) wrong.push(`${label} still recorded a return`);
  };
  const expectCredit = async (label: string, docId: number, amount: number, currency: string, rate: number | null) => {
    const rows = await customerCredit(docId);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    const okRows = rows.length > 0 && rows.every(r => r.currency === currency && (rate === null || Math.abs(Number(r.rate) - rate) < 0.001));
    if (Math.abs(credit - amount) > 0.0001 || !okRows) {
      wrong.push(`${label}: the customer was credited ${JSON.stringify(rows)}, expected ${amount} ${currency}${rate ? ` at rate ${rate}` : ''}`);
    }
  };

  // 1) rial invoice 2 x 1,000,000 with a line discount of 200,000: the customer owes 1,800,000, 900,000 per unit
  const a = await f.item(10, 400_000);
  const invoice = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: a, quantity: 2, unit_price: 1_000_000, discount: 200_000, location: f.wh }]));
  const invoiceId = docIdOf(invoice);
  if (invoice.status !== 200) throw new Error(`setup: invoice ${brief(invoice)}`);
  const ret = (lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, status = 'final', of = invoiceId) =>
    h.post('/api/documents', f.doc('return', status, lines.map(l => ({ itemId: a, quantity: 1, location: f.wh, ...l })), { returnOfDocumentId: of, ...extra }));

  await expectRefused('a return of 1 at 5,000,000', await ret([{ unit_price: 5_000_000 }]), 'RETURN_PRICE_MISMATCH', invoiceId, 0);
  await expectRefused('a return at the gross price with its own discount', await ret([{ unit_price: 1_000_000, discount: 100_000 }]), 'RETURN_PRICE_MISMATCH', invoiceId, 0);
  await expectRefused('a rial return of the rial invoice in USD', await ret([{ unit_price: 900_000 }], { currency: 'USD', exchangeRate: 600_000 }), 'RETURN_CURRENCY_MISMATCH', invoiceId, 0);
  const filled = await ret([{}]);
  if (filled.status !== 200) wrong.push(`a return of 1 without a price answered ${brief(filled)}, expected 200`);
  else {
    const lines = await linesOf(docIdOf(filled));
    if (lines.length !== 1 || lines[0].price !== 900_000 || lines[0].discount !== 0) wrong.push(`the return line was stored as ${JSON.stringify(lines)}, expected price 900,000 and no discount`);
    await expectCredit('the return of 1 without a price', docIdOf(filled), 900_000, 'IRR', null);
  }
  const net = await ret([{ unit_price: 900_000 }]);
  if (net.status !== 200) wrong.push(`a return of 1 at the net price 900,000 answered ${brief(net)}, expected 200`);
  else await expectCredit('the return of 1 at the net price', docIdOf(net), 900_000, 'IRR', null);

  // 2) USD invoice 2 x 100 with a discount of 20 at rate 600,000: the customer owes 180 USD
  const b = await f.item(10, 400_000);
  const usd = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId: b, quantity: 2, unit_price: 100, discount: 20, location: f.wh }], { currency: 'USD', exchangeRate: 600_000 }));
  const usdId = docIdOf(usd);
  if (usd.status !== 200) throw new Error(`setup: USD invoice ${brief(usd)}`);
  const usdRet = (extra: Record<string, unknown>, line: Record<string, unknown> = {}, status = 'final') =>
    h.post('/api/documents', f.doc('return', status, [{ itemId: b, quantity: 2, location: f.wh, ...line }], { returnOfDocumentId: usdId, ...extra }));
  // the stock page sent IRR, the gross price and no discount: 200 rials instead of 180 USD
  await expectRefused('a return of the USD invoice in IRR at price 100', await usdRet({ currency: 'IRR' }, { unit_price: 100 }), 'RETURN_CURRENCY_MISMATCH', usdId, 0);
  await expectRefused('a USD return at rate 500,000', await usdRet({ currency: 'USD', exchangeRate: 500_000 }, { unit_price: 90 }), 'RETURN_EXCHANGE_RATE_MISMATCH', usdId, 0);
  await expectRefused('a USD return at the gross price 100', await usdRet({ currency: 'USD', exchangeRate: 600_000 }, { unit_price: 100 }), 'RETURN_PRICE_MISMATCH', usdId, 0);

  // 3) a draft takes the invoice terms, an edit cannot change them, and it finalizes into 180 USD at 600,000
  const draft = await usdRet({}, {}, 'draft');
  const draftId = docIdOf(draft);
  const draftHead = await headOf(draftId);
  const draftLines = await linesOf(draftId);
  if (draft.status !== 200 || draftHead?.currency !== 'USD' || Number(draftHead?.rate) !== 600_000 || draftLines[0]?.price !== 90) {
    wrong.push(`a draft return without currency or price answered ${brief(draft)} and stored ${JSON.stringify({ head: draftHead, lines: draftLines })}, expected USD at 600,000 and price 90`);
  }
  const edited = await h.put(`/api/documents/${draftId}`, { currency: 'IRR', items: [{ itemId: b, quantity: 2, unit_price: 100, location: f.wh }] });
  if (edited.status !== 422 || codeOf(edited) !== 'RETURN_CURRENCY_MISMATCH') wrong.push(`editing the draft return to IRR answered ${brief(edited)}, expected 422 RETURN_CURRENCY_MISMATCH`);
  const editedPrice = await h.put(`/api/documents/${draftId}`, { items: [{ itemId: b, quantity: 1, unit_price: 100, location: f.wh }] });
  if (editedPrice.status !== 422 || codeOf(editedPrice) !== 'RETURN_PRICE_MISMATCH') wrong.push(`editing the draft return price answered ${brief(editedPrice)}, expected 422 RETURN_PRICE_MISMATCH`);
  // a draft stored before this version with the gross price is not finalized until it is edited
  await h.q(`UPDATE document_items SET unit_price = 100 WHERE document_id = $1 AND is_deleted = 0`, [draftId]);
  const legacyFinalize = await h.put(`/api/documents/${draftId}/finalize`, {});
  if (legacyFinalize.status !== 422 || codeOf(legacyFinalize) !== 'RETURN_PRICE_MISMATCH' || (await headOf(draftId))?.status !== 'draft') {
    wrong.push(`finalizing a draft return stored at the gross price answered ${brief(legacyFinalize)}, expected 422 RETURN_PRICE_MISMATCH and a draft`);
  }
  const fixed = await h.put(`/api/documents/${draftId}`, { items: [{ itemId: b, quantity: 2, location: f.wh }] });
  const finalized = await h.put(`/api/documents/${draftId}/finalize`, {});
  if (fixed.status !== 200 || finalized.status !== 200) wrong.push(`editing and finalizing the draft return answered ${brief(fixed)} and ${brief(finalized)}, expected 200 and 200`);
  else await expectCredit('the finalized USD return', draftId, 180, 'USD', 600_000);

  // 4) a return without an invoice still takes the user's price
  const free = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, unit_price: 5_000_000, location: f.wh }]));
  if (free.status !== 200) wrong.push(`a return without an invoice answered ${brief(free)}, expected 200`);
  else await expectCredit('the return without an invoice', docIdOf(free), 5_000_000, 'IRR', null);
  return 'a rial invoice 2 x 1,000,000 less 200,000: returns at 5,000,000, with a discount or in USD are 422, a return of 1 is 900,000 with or without the price; a USD invoice 2 x 100 less 20 at 600,000: IRR, another rate or the gross price are 422, a draft takes USD, 600,000 and 90, is not edited away from them, a legacy gross-price draft is not finalized, and the fixed draft credits 180 USD at 600,000; a return without an invoice keeps its price';
}

/** B08-05 (TD-774): a sales return always had VAT 0, so the customer kept owing the VAT of goods given back */
async function returnVatFromInvoiceCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
  const receivable = await AccountMappingService.getTradeReceivablesAccount();
  const vatPayable = await AccountMappingService.getSalesVatPayableAccount();
  if (!receivable || !vatPayable) throw new Error('the trade receivables or VAT payable account is not mapped');
  const codeOf = (res: { body?: unknown }) => (res.body as { code?: string })?.code;
  const vatOf = async (docId: number) => (await h.q(`SELECT vat_percent::float8 AS pct, vat_amount::float8 AS amount FROM documents WHERE id = $1`, [docId]))[0] as { pct: number; amount: number };
  const netOn = async (docIds: number[], accountId: number) => Number((await h.q(
    `SELECT COALESCE(SUM(i.debit - i.credit), 0)::float8 AS net FROM journal_voucher_items i JOIN journal_vouchers v ON v.id = i.voucher_id
      WHERE v.source_document_id = ANY($1::int[]) AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2`,
    [docIds, accountId],
  ))[0]?.net);
  const sale = async (itemId: number, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const res = await h.post('/api/documents', f.doc('invoice', 'final', lines.map(l => ({ itemId, location: f.wh, ...l })), extra));
    if (res.status !== 200) throw new Error(`setup: invoice ${brief(res)}`);
    return docIdOf(res);
  };
  const giveBack = (itemId: number, invoiceId: number, quantity: number, extra: Record<string, unknown> = {}, status = 'final') =>
    h.post('/api/documents', f.doc('return', status, [{ itemId, quantity, location: f.wh }], { returnOfDocumentId: invoiceId, ...extra }));

  // 1) S05: invoice 1 x 1,000,000 at 10% (VAT 100,000); its full return gives back 100,000 VAT and 1,100,000 to the customer
  const a = await f.item(10, 400_000);
  const invoiceId = await sale(a, [{ quantity: 1, unit_price: 1_000_000 }], { vatPercent: 10 });
  const otherPercent = await giveBack(a, invoiceId, 1, { vatPercent: 5 });
  if (otherPercent.status !== 422 || codeOf(otherPercent) !== 'RETURN_VAT_MISMATCH') wrong.push(`a return at 5% of a 10% invoice answered ${brief(otherPercent)}, expected 422 RETURN_VAT_MISMATCH`);
  const full = await giveBack(a, invoiceId, 1, { vatPercent: 10 });
  if (full.status !== 200) wrong.push(`the full return answered ${brief(full)}, expected 200`);
  else {
    const vat = await vatOf(docIdOf(full));
    if (vat.pct !== 10 || vat.amount !== 100_000) wrong.push(`the full return stored VAT ${JSON.stringify(vat)}, expected 10% and 100,000`);
    const both = [invoiceId, docIdOf(full)];
    const customer = await netOn(both, receivable.id);
    const payable = await netOn(both, vatPayable.id);
    if (customer !== 0 || payable !== 0) wrong.push(`after the invoice and its full return the customer nets ${customer} and VAT payable ${payable}, expected 0 and 0`);
  }

  // 2) VAT 100 over 3 units of 1,000 returned one by one: 33, 34 and 33, all of the invoice VAT and never more
  const b = await f.item(10, 400);
  const thirds = await sale(b, [{ quantity: 3, unit_price: 1_000 }], { vatAmount: 100 });
  const amounts: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const res = await giveBack(b, thirds, 1);
    if (res.status !== 200) wrong.push(`return ${i + 1} of the 3-unit invoice answered ${brief(res)}, expected 200`);
    else amounts.push((await vatOf(docIdOf(res))).amount);
  }
  // the third return is a draft first: it takes its share as a draft and keeps it on finalize
  const draft = await giveBack(b, thirds, 1, {}, 'draft');
  const draftVat = (await vatOf(docIdOf(draft))).amount;
  const finalized = await h.put(`/api/documents/${docIdOf(draft)}/finalize`, {});
  if (draft.status !== 200 || finalized.status !== 200) wrong.push(`the draft third return answered ${brief(draft)} and its finalize ${brief(finalized)}, expected 200 and 200`);
  else amounts.push((await vatOf(docIdOf(draft))).amount);
  if (JSON.stringify(amounts) !== JSON.stringify([33, 34, 33]) || draftVat !== 33) {
    wrong.push(`the VAT of the three returns was ${JSON.stringify(amounts)} (draft ${draftVat}), expected [33,34,33] and draft 33`);
  }

  // 3) a USD invoice 2 x 100 less 20 at 10% (18 USD VAT): a return of 1 takes 9 USD and debits VAT payable in USD
  const c = await f.item(10, 400_000);
  const usd = await sale(c, [{ quantity: 2, unit_price: 100, discount: 20 }], { currency: 'USD', exchangeRate: 600_000, vatPercent: 10 });
  const usdReturn = await giveBack(c, usd, 1);
  if (usdReturn.status !== 200) wrong.push(`the USD return answered ${brief(usdReturn)}, expected 200`);
  else {
    const vat = await vatOf(docIdOf(usdReturn));
    const rows = await h.q(
      `SELECT i.debit::float8 AS debit, COALESCE(i.currency, v.currency) AS currency, i.exchange_rate::float8 AS rate FROM journal_voucher_items i
         JOIN journal_vouchers v ON v.id = i.voucher_id WHERE v.source_document_id = $1 AND v.is_deleted = 0 AND i.is_deleted = 0 AND i.account_id = $2`,
      [docIdOf(usdReturn), vatPayable.id],
    );
    if (vat.amount !== 9 || rows.length !== 1 || Number(rows[0].debit) !== 9 || rows[0].currency !== 'USD' || Number(rows[0].rate) !== 600_000) {
      wrong.push(`the USD return stored VAT ${JSON.stringify(vat)} with VAT rows ${JSON.stringify(rows)}, expected 9 USD debited at 600,000`);
    }
  }

  // 4) a return without an invoice takes the user's percent
  const free = await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, unit_price: 500_000, location: f.wh }], { vatPercent: 10 }));
  if (free.status !== 200) wrong.push(`a return without an invoice at 10% answered ${brief(free)}, expected 200`);
  else {
    const vat = await vatOf(docIdOf(free));
    const payable = await netOn([docIdOf(free)], vatPayable.id);
    if (vat.amount !== 50_000 || payable !== 50_000) wrong.push(`the return without an invoice stored VAT ${JSON.stringify(vat)} and debited VAT payable ${payable}, expected 50,000 and 50,000`);
  }
  return 'a full return of 1,000,000 at 10% gives back 100,000 VAT (customer and VAT payable net 0), another percent is 422; VAT 100 over 3 units returns as 33, 34 and 33 (the draft keeps 33 on finalize); a USD return of 1 of 2 x 100 less 20 at 10% debits 9 USD at 600,000; a return without an invoice at 10% of 500,000 debits 50,000';
}
