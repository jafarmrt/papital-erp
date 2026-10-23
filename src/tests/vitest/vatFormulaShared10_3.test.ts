import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeInvoiceTotals } from '../../lib/invoiceTotals';
import { resolveDocumentVat } from '../../services/documents/documentVat';
import { wooOrderVatPercent } from '../../services/woocommerce/wooOrderVat';
import { fin } from '../../lib/financialDecimal';

/**
 * 10.3 (ARCH review finding 6): the invoice form, the server and the WooCommerce order percent take the VAT base and the
 * VAT from one place (src/lib/vatFormula.ts). Before, the form and the shop order each wrote the formula again.
 */
const FORMULA_USERS = ['src/lib/invoiceTotals.ts', 'src/services/documents/documentVat.ts', 'src/services/woocommerce/wooOrderVat.ts'];

/** A small seeded generator, so a failure names a case that comes back */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('one VAT formula for the form, the server and the shop (10.3)', () => {
  it('no other file computes a percent of the VAT base on its own', () => {
    for (const file of FORMULA_USERS) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toMatch(/import \{[^}]*\} from '[./a-z]*vatFormula\.js';/);
      expect(source, file).not.toMatch(/divide\(100\b/);
    }
  });

  it('the formula keeps its amounts: whole rials, cents, a discount over the lines, a two-decimal percent', () => {
    const cases: Array<[Array<{ quantity: number; unitPrice: number; discount?: number }>, number, string, number, number]> = [
      // lines, percent, currency, net, VAT
      [[{ quantity: 3, unitPrice: 1_250_000, discount: 50_000 }, { quantity: 1, unitPrice: 99_990 }], 9, 'IRR', 3_799_990, 341_999],
      [[{ quantity: 3, unitPrice: 1_250_000, discount: 50_000 }, { quantity: 1, unitPrice: 99_990 }], 8.75, 'IRR', 3_799_990, 332_499],
      [[{ quantity: 1, unitPrice: 15 }], 10, 'IRR', 15, 2],
      [[{ quantity: 1, unitPrice: 15.55 }], 9, 'USD', 15.55, 1.4],
      [[{ quantity: 1, unitPrice: 100, discount: 150 }], 10, 'IRR', 0, 0],
      [[{ quantity: 2, unitPrice: 100 }], 0, 'IRR', 200, 0],
    ];
    for (const [lines, percent, currency, net, vat] of cases) {
      const form = computeInvoiceTotals(lines, percent, currency);
      expect([form.net, form.vatAmount]).toEqual([net, vat]);
      expect(resolveDocumentVat({ docType: 'invoice', input: { vatPercent: percent }, lines, currency }).vatAmount.toNumber()).toBe(vat);
    }
  });

  it('a zero percent reads no lines, as before', () => {
    expect(resolveDocumentVat({ docType: 'invoice', input: { vatPercent: 0 }, lines: undefined as never }).vatAmount.toNumber()).toBe(0);
  });

  it('the form shows the VAT the server records, over many invoices in rials and dollars', () => {
    const next = seeded(20261023);
    for (let n = 0; n < 300; n++) {
      const currency = n % 3 === 0 ? 'USD' : 'IRR';
      const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => ({
        quantity: Math.round(next() * 5000) / 100,
        unitPrice: currency === 'USD' ? Math.round(next() * 100_000) / 100 : Math.round(next() * 9_000_000),
        discount: next() < 0.3 ? Math.round(next() * 50_000) : 0,
      }));
      const vatPercent = [0, 9, 10, Math.round(next() * 1000) / 100][n % 4];
      const form = computeInvoiceTotals(lines, vatPercent, currency);
      const server = resolveDocumentVat({ docType: 'invoice', input: { vatPercent }, lines, currency }).vatAmount.toNumber();
      expect(form.vatAmount, `case ${n}`).toBe(server);
    }
  });

  it('a shop order whose tax a percent builds keeps that percent, and the server builds the same tax from it', () => {
    // net 3 × 1,250,000 + 99,990 − 50,000 = 3,799,990
    const lines = [{ quantity: 3, unit_price: 1_250_000, discount: 50_000 }, { quantity: 1, unit_price: 99_990 }];
    for (const [tax, percent] of [[341_999, 9], [332_499, 8.75]] as const) {
      expect(wooOrderVatPercent(lines, fin(tax), 'IRR')).toBe(percent);
      const serverLines = lines.map(l => ({ quantity: l.quantity, unitPrice: l.unit_price, discount: l.discount ?? 0 }));
      expect(resolveDocumentVat({ docType: 'invoice', input: { vatPercent: percent }, lines: serverLines, currency: 'IRR' }).vatAmount.toNumber()).toBe(tax);
    }
    // a tax no percent of the lines builds (shipping tax in it) keeps no percent
    expect(wooOrderVatPercent(lines, fin(341_999 + 12_345), 'IRR')).toBeUndefined();
  });
});
