import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { brief, fixture } from './documentEntryTests.js';
import { createBank } from './treasuryPartyTests.js';
import { presetRange } from '../../lib/reports/reportPeriods.js';
import type { VatDocumentRow, VatReport } from '../../lib/reports/vatReport.js';

/** the tax office as the treasury payment names it */
const TAX_OFFICE_NAME = 'اداره امور مالیاتی';

/**
 * Series 10.1, D-03 PR3 (reports plan §4, owner decisions t12 and t13): the VAT report of the management reports page.
 * Through the real Express routes with real sessions; every case is red on the code before the report (404). The
 * documents and vouchers of a case are moved by SQL to days no other row of the shared test schema holds, so the
 * period figures are exact, and put back after the case (`DateKeeper`).
 */
export async function runVatReportTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[], keep: DateKeeper) => Promise<string>]> = [
    ['reg_vat_report_documents_d03',
      'v10.1.14: the VAT report sums final sales invoices and returns of the period by VAT percent, a foreign invoice at its own rate, leaves out a voided invoice, a proforma and a foreign invoice without a rate, and lists the documents to check (D-03)',
      ['d03', 'reports', 'vat', 'return', 'currency'], vatDocumentsCase],
    ['reg_vat_report_ledger_d03',
      'v10.1.14: the VAT report reads the mapped VAT account by source with the draft share and names the documents and vouchers that make its difference with the sales documents (D-03)',
      ['d03', 'reports', 'vat', 'ledger', 'treasury'], vatLedgerCase],
    ['reg_vat_report_access_d03',
      'v10.1.14: GET /reports/vat needs accounting.reports, defaults to this quarter and refuses an invalid query (D-03)',
      ['d03', 'reports', 'vat', 'permission'], vatAccessCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const keep = await DateKeeper.start(h);
      const wrong: string[] = [];
      let details: string;
      try {
        details = await run(h, wrong, keep);
      } finally {
        await keep.restore();
      }
      await keep.assertNothingLeftEarly();
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

const DAY_MS = 86_400_000;
const docIdOf = (res: { body?: unknown }) => Number((res.body as { docId?: unknown })?.docId);
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

async function vat(h: Harness, query: string, session = h.admin): Promise<VatReport> {
  const res = await h.get(`/api/reports/vat?${query}`, session);
  if (res.status !== 200) throw new Error(`GET /api/reports/vat?${query} answered ${brief(res)}`);
  return res.body as VatReport;
}

function expectEqual(wrong: string[], label: string, got: unknown, expected: unknown): void {
  if (String(got) !== String(expected)) wrong.push(`${label}: got ${String(got)}, expected ${String(expected)}`);
}

/** A day in the 1990s whose day before and day after hold no document and no voucher */
async function freeDay(h: Harness): Promise<string> {
  let day = shiftDay('1990-01-10', Number(h.tag) % 3000);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const [row] = await h.q(
      `SELECT (SELECT COUNT(*) FROM documents WHERE date >= $1::date - 1 AND date < $1::date + 2)
            + (SELECT COUNT(*) FROM journal_vouchers WHERE date >= to_char($1::date - 1, 'YYYY-MM-DD') AND date <= to_char($1::date + 1, 'YYYY-MM-DD')) AS n`,
      [day],
    );
    if (Number(row?.n ?? 0) === 0) return day;
    day = shiftDay(day, 7);
  }
  throw new Error('setup: no free day found');
}

/**
 * What a case moved, put back after it: a voucher left in the 1990s holds Jalali 1375/1376 open, and the invariants
 * suite then closes later years, which wait for every earlier year with a voucher (TD-544). Each row is recorded the
 * first time a case touches it; the manual voucher a case adds is deleted.
 */
class DateKeeper {
  private readonly documents = new Map<number, Record<string, unknown>>();
  private readonly vouchers = new Map<number, Record<string, unknown>>();
  private readonly added: number[] = [];

  private constructor(private readonly h: Harness, private readonly voucherIdAfter: number, private readonly documentIdAfter: number) {}

  static async start(h: Harness): Promise<DateKeeper> {
    const [row] = await h.q(`SELECT (SELECT COALESCE(MAX(id), 0) FROM journal_vouchers) AS v, (SELECT COALESCE(MAX(id), 0) FROM documents) AS d`);
    return new DateKeeper(h, Number(row?.v ?? 0), Number(row?.d ?? 0));
  }

  async keepDocuments(ids: number[]): Promise<void> {
    const rows = await this.h.q(`SELECT id, date::text AS date, vat_amount, vat_percent, exchange_rate FROM documents WHERE id = ANY($1::int[])`, [ids]);
    for (const row of rows) if (!this.documents.has(Number(row.id))) this.documents.set(Number(row.id), row);
  }

  async keepVouchers(column: 'id' | 'source_document_id', ids: number[]): Promise<void> {
    const rows = await this.h.q(`SELECT id, date, status FROM journal_vouchers WHERE ${column} = ANY($1::int[])`, [ids]);
    for (const row of rows) if (!this.vouchers.has(Number(row.id))) this.vouchers.set(Number(row.id), row);
  }

  addedVoucher(id: number): void {
    this.added.push(id);
  }

  async restore(): Promise<void> {
    for (const id of this.added) {
      const res = await this.h.del(`/api/accounting/vouchers/${id}`);
      if (res.status >= 300) throw new Error(`cleanup: deleting voucher ${id} ${brief(res)}`);
    }
    for (const [id, v] of this.vouchers) await this.h.q(`UPDATE journal_vouchers SET date = $2, status = $3 WHERE id = $1`, [id, v.date, v.status]);
    for (const [id, d] of this.documents) {
      await this.h.q(`UPDATE documents SET date = $2::timestamp, vat_amount = $3, vat_percent = $4, exchange_rate = $5 WHERE id = $1`,
        [id, d.date, d.vat_amount, d.vat_percent, d.exchange_rate]);
    }
  }

  /** no live voucher or document the case made stays before 2000 */
  async assertNothingLeftEarly(): Promise<void> {
    const [row] = await this.h.q(
      `SELECT (SELECT COUNT(*) FROM journal_vouchers WHERE id > $1 AND is_deleted = 0 AND date < '2000-01-01')
            + (SELECT COUNT(*) FROM documents WHERE id > $2 AND is_deleted = 0 AND date < '2000-01-01') AS n`,
      [this.voucherIdAfter, this.documentIdAfter],
    );
    if (Number(row?.n ?? 0) > 0) throw new Error(`the case left ${String(row?.n)} live vouchers or documents before 2000`);
  }
}

async function moveDocuments(h: Harness, keep: DateKeeper, ids: number[], day: string): Promise<void> {
  await keep.keepDocuments(ids);
  await h.q(`UPDATE documents SET date = $2::date + time '10:00' WHERE id = ANY($1::int[])`, [ids, day]);
}

async function moveVouchersOf(h: Harness, keep: DateKeeper, ids: number[], day: string): Promise<void> {
  await keep.keepVouchers('source_document_id', ids);
  await h.q(`UPDATE journal_vouchers SET date = $2 WHERE source_document_id = ANY($1::int[])`, [ids, day]);
}

const docRow = (r: VatReport, id: number): VatDocumentRow | undefined => r.documents.find(d => d.id === id);

/** Seven final documents, a voided invoice and a proforma moved to one free day */
async function vatDocumentsCase(h: Harness, wrong: string[], keep: DateKeeper): Promise<string> {
  const f = await fixture(h);
  const a = await f.item(10, 400_000);
  const b = await f.item(10, 200_000);
  const made = async (label: string, res: { status: number; body?: unknown }) => {
    if (res.status !== 200) throw new Error(`setup: ${label} ${brief(res)}`);
    return docIdOf(res);
  };
  const sale = (label: string, lines: Array<{ itemId: number; quantity: number; unit_price: number; discount?: number }>, extra: Record<string, unknown> = {}) =>
    h.post('/api/documents', f.doc('invoice', 'final', lines.map(l => ({ ...l, location: f.wh })), extra)).then(res => made(label, res));

  const one = await sale('invoice 1', [{ itemId: a, quantity: 3, unit_price: 900_000 }, { itemId: b, quantity: 2, unit_price: 500_000, discount: 100_000 }], { vatPercent: 10 });
  const back = await made('return', await h.post('/api/documents', f.doc('return', 'final', [{ itemId: a, quantity: 1, location: f.wh }], { returnOfDocumentId: one })));
  const euro = await sale('EUR invoice', [{ itemId: b, quantity: 1, unit_price: 10 }], { currency: 'EUR', exchangeRate: 500_000, vatPercent: 9 });
  const noVat = await sale('invoice without VAT', [{ itemId: b, quantity: 1, unit_price: 400_000 }]);
  const mismatch = await sale('invoice with another VAT', [{ itemId: a, quantity: 1, unit_price: 500_000 }], { vatPercent: 10 });
  const noPercent = await sale('invoice with VAT and no percent', [{ itemId: b, quantity: 1, unit_price: 200_000 }], { vatPercent: 10 });
  const unconverted = await sale('EUR invoice to lose its rate', [{ itemId: b, quantity: 1, unit_price: 20 }], { currency: 'EUR', exchangeRate: 500_000, vatPercent: 10 });
  const voided = await sale('invoice to void', [{ itemId: a, quantity: 1, unit_price: 900_000 }], { vatPercent: 10 });
  const voidRes = await h.del(`/api/documents/${voided}`);
  if (voidRes.status !== 200) throw new Error(`setup: voiding ${brief(voidRes)}`);
  const proforma = await made('proforma', await h.post('/api/documents', f.doc('invoice', 'proforma', [{ itemId: a, quantity: 1, unit_price: 900_000, location: f.wh }], { vatPercent: 10 })));
  // legacy states the report must flag: a VAT that is not its percent, a VAT without a percent, a foreign invoice without a rate
  await keep.keepDocuments([mismatch, noPercent, unconverted]);
  await h.q(`UPDATE documents SET vat_amount = 55000 WHERE id = $1`, [mismatch]);
  await h.q(`UPDATE documents SET vat_percent = 0 WHERE id = $1`, [noPercent]);
  await h.q(`UPDATE documents SET exchange_rate = NULL WHERE id = $1`, [unconverted]);
  const day = await freeDay(h);
  const all = [one, back, euro, noVat, mismatch, noPercent, unconverted, voided, proforma];
  await moveDocuments(h, keep, all, day);
  await moveVouchersOf(h, keep, all, day);

  const r = await vat(h, `from=${day}&to=${day}`);
  // 1) by percent: 10% = invoice 1 (3,600,000 / 360,000) + the 55,000 invoice, less the return; 9% the EUR invoice in rials
  expectEqual(wrong, 'rate keys', r.rates.map(x => x.key).join(','), '10,9,0,unknown');
  const ten = r.rates[0];
  expectEqual(wrong, '10% invoices', ten?.invoiceCount, 2);
  expectEqual(wrong, '10% base', ten?.salesBase, 4_100_000);
  expectEqual(wrong, '10% VAT', ten?.salesVat, 415_000);
  expectEqual(wrong, '10% returns', `${ten?.returnCount}/${ten?.returnBase}/${ten?.returnVat}`, '1/900000/90000');
  expectEqual(wrong, '10% net VAT', ten?.netVat, 325_000);
  expectEqual(wrong, '9% base and VAT', `${r.rates[1]?.salesBase}/${r.rates[1]?.salesVat}`, '5000000/450000');
  expectEqual(wrong, '0% base and VAT', `${r.rates[2]?.salesBase}/${r.rates[2]?.salesVat}`, '400000/0');
  expectEqual(wrong, 'unknown percent', `${r.rates[3]?.percent}/${r.rates[3]?.salesVat}`, 'null/20000');
  const t = r.totals;
  expectEqual(wrong, 'totals', `${t.invoiceCount}/${t.salesBase}/${t.salesVat}/${t.returnCount}/${t.returnVat}/${t.netVat}`, '5/9700000/885000/1/90000/795000');
  expectEqual(wrong, 'warnings', JSON.stringify(r.warnings), JSON.stringify({ unconverted: 1, rate_mismatch: 1, rate_missing: 1, no_vat: 1 }));

  // 2) the document list
  expectEqual(wrong, 'listed documents', r.total, 7);
  if (docRow(r, voided) || docRow(r, proforma)) wrong.push('a voided invoice or a proforma is listed');
  const eu = docRow(r, euro);
  expectEqual(wrong, 'EUR row', `${eu?.netOwn}/${eu?.vatOwn}/${eu?.exchangeRate}/${eu?.net}/${eu?.vat}/${eu?.percent}`, '10/0.9/500000/5000000/450000/9');
  const off = docRow(r, mismatch);
  expectEqual(wrong, 'mismatch row', `${off?.warning}/${off?.vat}/${off?.expectedVatOwn}`, 'rate_mismatch/55000/50000');
  const lost = docRow(r, unconverted);
  expectEqual(wrong, 'unconverted row', `${lost?.warning}/${lost?.net}/${lost?.vat}/${lost?.vatOwn}`, 'unconverted/null/null/2');
  expectEqual(wrong, 'return row', `${docRow(r, back)?.kind}/${docRow(r, back)?.vat}/${docRow(r, back)?.warning}`, 'return/90000/null');
  expectEqual(wrong, 'no VAT row', docRow(r, noVat)?.warning, 'no_vat');
  expectEqual(wrong, 'no percent row', docRow(r, noPercent)?.warning, 'rate_missing');
  const flagged = await vat(h, `from=${day}&to=${day}&list=warnings`);
  expectEqual(wrong, 'warning list', flagged.documents.map(d => d.id).sort((x, y) => x - y).join(','), [noVat, mismatch, noPercent, unconverted].sort((x, y) => x - y).join(','));
  const paged = await vat(h, `from=${day}&to=${day}&limit=2`);
  expectEqual(wrong, 'first page', `${paged.documents.length}/${paged.total}`, '2/7');
  const pastEnd = await vat(h, `from=${day}&to=${day}&limit=2&page=9`);
  expectEqual(wrong, 'page past the end', `${pastEnd.documents.length}/${pastEnd.total}`, '0/7');
  const exported = await vat(h, `from=${day}&to=${day}&limit=2&export=true`);
  expectEqual(wrong, 'export rows', exported.documents.length, 7);

  // 3) the ledger: every voucher of the day is an automatic draft; the EUR invoice without a rate posted 2 EUR x 500,000
  const ledger = r.ledger;
  if (!ledger) throw new Error('no ledger part for the mapped VAT account');
  expectEqual(wrong, 'period credit', `${ledger.credit.total}/${ledger.credit.draft}`, '1880000/1880000');
  expectEqual(wrong, 'period debit', `${ledger.debit.total}/${ledger.debit.draft}`, '90000/90000');
  expectEqual(wrong, 'closing less opening', Number(ledger.closing.total) - Number(ledger.opening.total), 1_790_000);
  expectEqual(wrong, 'document source', `${ledger.bySource.document.credit}/${ledger.bySource.document.debit}`, '1880000/90000');
  const c = r.comparison;
  expectEqual(wrong, 'comparison', `${c?.documentsNet}/${c?.ledgerNet}/${c?.difference}`, '795000/1790000/995000');
  expectEqual(wrong, 'difference rows', c?.rows.map(x => `${x.kind}:${x.document?.id}:${x.difference}`).join(','),
    `document_unconverted:${unconverted}:1000000,document_differs:${mismatch}:-5000`);
  return 'one day: 10%, 9%, 0% and unknown percent rows, 885,000 sales VAT less 90,000 return VAT; a voided invoice, a proforma and a foreign invoice without a rate left out; four warnings; paging and export; the ledger and its two differences';
}

/** One day D: an invoice in D, its voucher moved out; another invoice outside D with its voucher in D; a voided invoice reversed in D; a VAT payment and a manual voucher */
async function vatLedgerCase(h: Harness, wrong: string[], keep: DateKeeper): Promise<string> {
  const f = await fixture(h);
  const day = await freeDay(h);
  const before = shiftDay(day, -1);
  const after = shiftDay(day, 1);
  const baseline = await vat(h, `from=${day}&to=${day}`);
  if (!baseline.ledger) throw new Error('no ledger part for the mapped VAT account');

  const a = await f.item(10, 100_000);
  const b = await f.item(10, 50_000);
  const sale = async (label: string, itemId: number, price: number) => {
    const res = await h.post('/api/documents', f.doc('invoice', 'final', [{ itemId, quantity: 1, unit_price: price, location: f.wh }], { vatPercent: 10 }));
    if (res.status !== 200) throw new Error(`setup: ${label} ${brief(res)}`);
    return docIdOf(res);
  };
  const earlier = await sale('invoice before the day', a, 1_000_000);
  const matched = await sale('invoice of the day', b, 500_000);
  const voided = await sale('invoice to void', a, 300_000);
  const outside = await sale('invoice after the day', b, 100_000);
  const missing = await sale('invoice without a voucher in the day', a, 200_000);

  // the voided invoice: its voucher approved before the day, so the void posts a reversal, moved into the day
  await h.q(`UPDATE journal_vouchers SET status = 'approved' WHERE source_document_id = $1 AND is_deleted = 0`, [voided]);
  const [original] = await h.q(`SELECT id FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [voided]);
  const voidRes = await h.del(`/api/documents/${voided}`);
  if (voidRes.status !== 200) throw new Error(`setup: voiding ${brief(voidRes)}`);
  const [reversal] = await h.q(`SELECT id, voucher_number, status FROM journal_vouchers WHERE reference_id = $1 AND reference_number LIKE 'REV-V%' AND is_deleted = 0`, [original?.id]);
  if (!reversal) throw new Error('setup: the void posted no reversal voucher');

  await moveDocuments(h, keep, [earlier, voided], before);
  await moveVouchersOf(h, keep, [earlier, voided], before);
  await moveDocuments(h, keep, [matched, missing], day);
  await moveVouchersOf(h, keep, [matched, outside], day);
  await moveDocuments(h, keep, [outside], after);
  await moveVouchersOf(h, keep, [missing], after);
  await keep.keepVouchers('id', [Number(reversal.id)]);
  await h.q(`UPDATE journal_vouchers SET date = $2 WHERE id = $1`, [reversal.id, day]);

  // a VAT payment to the tax office from a bank, and a manual draft voucher crediting the VAT account
  const vatAccount = Number((await h.q(`SELECT id FROM accounts WHERE code = '3203' AND is_deleted = 0`))[0]?.id);
  const capital = Number((await h.q(`SELECT id FROM accounts WHERE code = '4101' AND is_deleted = 0`))[0]?.id);
  const cash = Number((await h.q(`SELECT id FROM accounts WHERE code = '1001' AND is_deleted = 0`))[0]?.id);
  const bank = await createBank('D03 VAT');
  const treasury = { method: 'bank_transfer', bankAccountId: bank.id, date: f.today };
  const funding = await h.post('/api/accounting/treasury', { ...treasury, type: 'receipt', amount: 100_000, partyType: 'other', partyName: `D03 funding ${h.tag}`, contraAccountId: capital });
  if (funding.status !== 201) throw new Error(`setup: funding receipt ${brief(funding)}`);
  const payment = await h.post('/api/accounting/treasury', { ...treasury, type: 'payment', amount: 15_000, partyType: 'other', partyName: TAX_OFFICE_NAME, contraAccountId: vatAccount });
  if (payment.status !== 201) throw new Error(`setup: VAT payment ${brief(payment)}`);
  const paymentVoucher = Number((payment.body as { voucherId?: unknown })?.voucherId);
  await keep.keepVouchers('id', [paymentVoucher]);
  await h.q(`UPDATE journal_vouchers SET date = $2, status = 'approved' WHERE id = $1`, [paymentVoucher, day]);
  const manual = await h.post('/api/accounting/vouchers', {
    date: day, status: 'draft', description: `D03 manual VAT ${h.tag}`,
    items: [{ accountId: cash, debit: 7_000, credit: 0 }, { accountId: vatAccount, debit: 0, credit: 7_000 }],
  });
  if (manual.status !== 201) throw new Error(`setup: manual voucher ${brief(manual)}`);
  keep.addedVoucher(Number((manual.body as { id?: unknown })?.id));

  const r = await vat(h, `from=${day}&to=${day}`);
  const ledger = r.ledger;
  if (!ledger) throw new Error('no ledger part after the setup');
  // part 1: the invoice of the day (50,000) and the one whose voucher left the day (20,000)
  expectEqual(wrong, 'documents VAT', `${r.totals.invoiceCount}/${r.totals.netVat}`, '2/70000');
  // ledger: credit 50,000 + 10,000 (the outside invoice) + 7,000 (manual); debit 30,000 (reversal) + 15,000 (payment)
  const reversalDraft = reversal.status === 'draft' ? 30_000 : 0;
  expectEqual(wrong, 'period credit', `${ledger.credit.total}/${ledger.credit.draft}`, '67000/67000');
  expectEqual(wrong, 'period debit', `${ledger.debit.total}/${ledger.debit.draft}`, `45000/${reversalDraft}`);
  expectEqual(wrong, 'by source', ['document', 'treasury', 'other'].map(s => {
    const x = ledger.bySource[s as 'document'];
    return `${s}:${x.credit}/${x.debit}`;
  }).join(','), 'document:60000/30000,treasury:0/15000,other:7000/0');
  expectEqual(wrong, 'opening growth', Number(ledger.opening.total) - Number(baseline.ledger.opening.total), 130_000);
  expectEqual(wrong, 'opening draft growth', Number(ledger.opening.draft) - Number(baseline.ledger.opening.draft), 100_000);
  expectEqual(wrong, 'closing', Number(ledger.closing.total) - Number(ledger.opening.total), 22_000);
  const c = r.comparison;
  expectEqual(wrong, 'comparison', `${c?.documentsNet}/${c?.ledgerNet}/${c?.difference}/${c?.rowCount}`, '70000/22000/-48000/5');
  expectEqual(wrong, 'difference rows', c?.rows.map(x => `${x.kind}:${x.document?.id ?? '-'}:${x.expected}:${x.ledger}`).join(','), [
    `document_voided:${voided}:0:-30000`, `document_missing:${missing}:20000:0`, 'treasury:-:0:-15000',
    `document_outside:${outside}:0:10000`, 'other:-:0:7000',
  ].join(','));
  expectEqual(wrong, 'reversal voucher named', c?.rows[0]?.vouchers.map(v => v.number).join(','), reversal.voucher_number);
  return 'a day with a matched invoice, a voucher moved out, a voucher of another day\'s invoice, a voided invoice\'s reversal, a VAT payment and a manual voucher: ledger 67,000 credit and 45,000 debit by source, opening and closing, and five differences summing to -48,000';
}

async function vatAccessCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const query = `from=${f.today}&to=${f.today}`;
  const salesOnly = await h.sessionWith(['reports.sales', 'documents.view']);
  const denied = await h.get(`/api/reports/vat?${query}`, salesOnly);
  if (denied.status !== 403) wrong.push(`a user without accounting.reports got ${brief(denied)}, expected 403`);

  const reader = await h.sessionWith(['accounting.reports']);
  const plain = await vat(h, query, reader);
  if (!plain.ledger) wrong.push('an accounting.reports holder got no ledger part');
  const quarter = presetRange('this_quarter', f.today);
  const defaults = await vat(h, '', reader);
  expectEqual(wrong, 'default range', `${defaults.range.from}/${defaults.range.to}`, `${quarter?.from}/${f.today}`);
  expectEqual(wrong, 'default list', defaults.list, 'all');

  const badQuery = async (q: string) => {
    const res = await h.get(`/api/reports/vat?${q}`, reader);
    if (res.status !== 400) wrong.push(`${q} answered ${brief(res)}, expected 400`);
  };
  await badQuery(`${query}&unknown=1`);
  await badQuery(`${query}&list=other`);
  await badQuery('from=not-a-date');
  await badQuery(`${query}&page=0`);
  const inverted = await h.get('/api/reports/vat?from=2026-10-10&to=2026-10-01', reader);
  if (inverted.status !== 422 || (inverted.body as { code?: string })?.code !== 'REPORT_RANGE_INVALID') wrong.push(`an inverted range answered ${brief(inverted)}, expected 422 REPORT_RANGE_INVALID`);
  return 'no accounting.reports: 403; accounting.reports: the report with its ledger part, this quarter by default; an unknown key, list, date or page is 400 and an inverted range 422';
}
