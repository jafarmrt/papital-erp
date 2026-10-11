import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// TD-1180: these screens and the voucher sync route said «دوبل» for an accounting voucher;
// the accounting glossary (TD-579) says «سند حسابداری». The word is built from code points
// so that this file prints no Persian on the terminal.
const DOUBLE = String.fromCodePoint(0x062F, 0x0648, 0x0628, 0x0644);

const FILES = [
  'src/components/crm/CustomerDossierDrawer.tsx',
  'src/components/documents/stock/StockDocumentHeader.tsx',
  'src/lib/permissions/permissionCatalog.ts',
  'src/pages/CustomersPage.tsx',
  'src/routes/accounting/voucherSync.routes.ts',
];

describe('double_word_removed_td_1180', () => {
  it.each(FILES)('%s has no double-entry loanword', (file) => {
    const text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    expect(text.includes(DOUBLE)).toBe(false);
  });
});
