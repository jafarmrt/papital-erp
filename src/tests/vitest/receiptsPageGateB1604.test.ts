import { describe, expect, it } from 'vitest';
import { canOpenPage } from '../../lib/permissions/pageAccess';

/**
 * Package 16 B16-04 residual (TD-668 follow-up, with package 8 TD-791): the «ورود و خروج انبار» page opens for whoever
 * records one of its document types. On v9.0.230 it opened for `documents.view` / `documents.create`, which record none of
 * them, and stayed closed for `warehouse.out`, which records remittances and waste.
 */
// receipt and production receipt `warehouse.in`, sales return `documents.finalize`, remittance and waste `warehouse.out`
const STOCK_DOCUMENT_RECORD_KEYS = ['warehouse.in', 'warehouse.out', 'documents.finalize'];

describe('receipts page gate follows the record permissions of its document types', () => {
  const viewer = (permissions: string[]) => ({ role: 'custom_role', permissions });

  it('each record key of the page opens it', () => {
    for (const key of STOCK_DOCUMENT_RECORD_KEYS) {
      expect(canOpenPage('/receipts', viewer([key])), key).toBe(true);
    }
  });

  it('document view or create alone does not open it', () => {
    expect(canOpenPage('/receipts', viewer(['documents.view']))).toBe(false);
    expect(canOpenPage('/receipts', viewer(['documents.create']))).toBe(false);
  });
});
