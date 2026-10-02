import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals } from '../../lib/invoiceTotals';
import { computeNetAmount, resolveDocumentVat } from '../../services/documents/documentVat';

const serverTotals = (lines: Array<{ quantity: number; unitPrice: number; discount: number }>, vatPercent: number) => {
  const net = computeNetAmount(lines).toNumber();
  const vat = resolveDocumentVat({ docType: 'invoice', input: { vatPercent }, lines }).vatAmount.toNumber();
  return { net, vatAmount: vat, payable: net + vat };
};

describe('computeInvoiceTotals (sales invoice form)', () => {
  it('sums lines without floating-point drift', () => {
    // JS: 0.7 * 15 = 10.499999999999998 and 3 * 0.1 = 0.30000000000000004
    const t = computeInvoiceTotals([{ quantity: 0.7, unitPrice: 15, discount: 0 }, { quantity: 3, unitPrice: 0.1, discount: 0 }], 0);
    expect(t.gross).toBe(10.8);
    expect(t.net).toBe(10.8);
    expect(t.payable).toBe(10.8);
  });

  it('computes VAT exactly as the server does for a percentage', () => {
    const cases: Array<{ lines: Array<{ quantity: number; unitPrice: number; discount: number }>; vat: number }> = [
      { lines: [{ quantity: 3, unitPrice: 1_250_000, discount: 50_000 }], vat: 10 },
      { lines: [{ quantity: 0.1, unitPrice: 50, discount: 0 }], vat: 10 },
      { lines: [{ quantity: 2.5, unitPrice: 333_333, discount: 1 }, { quantity: 1, unitPrice: 17, discount: 0 }], vat: 9 },
      { lines: [{ quantity: 1, unitPrice: 15, discount: 0 }], vat: 10 },
    ];
    for (const c of cases) {
      const client = computeInvoiceTotals(c.lines, c.vat);
      const server = serverTotals(c.lines, c.vat);
      expect({ net: client.net, vatAmount: client.vatAmount, payable: client.payable }).toEqual(server);
    }
    // 15 × 10% = 1.5 → rounded half-up to 2 (server rule)
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 15, discount: 0 }], 10).vatAmount).toBe(2);
    // 4.6 × 25 = 115 → VAT 11.5 → 12; the old form computed 4.6 * 25 = 114.99999999999999 and sent VAT 11
    expect(computeInvoiceTotals([{ quantity: 4.6, unitPrice: 25, discount: 0 }], 10).vatAmount).toBe(12);
    expect(serverTotals([{ quantity: 4.6, unitPrice: 25, discount: 0 }], 10).vatAmount).toBe(12);
  });

  it('clamps a discount larger than the lines to zero and charges no VAT when off', () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 100, discount: 150 }], 10);
    expect(t.net).toBe(0);
    expect(t.vatAmount).toBe(0);
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 100, discount: 0 }], 0).vatAmount).toBe(0);
  });
});
