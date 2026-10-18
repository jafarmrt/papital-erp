import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * v10.2.1 (OBS-R2-52، بسته ۴ برنامه ۱۰.۲): هر دریافت و پرداخت خزانه از یک راه ثبت و ابطال می‌شود،
 * `postTreasuryRow` / `reverseTreasuryRow` در `src/services/accounting/treasury/treasuryPosting.ts`. پیش‌تر پرداخت فیش
 * حقوق و ابطال آن (`src/services/accounting/payrollPayment*.ts`) مانده بانک و ردیف خزانه را خودشان می‌نوشتند، و
 * صورت‌هزینه تنخواه و پرداخت ماهانه بیمه و مالیات هم ردیف خزانه را جدا درج می‌کردند. تنها استثنا جفت ردیف انتقال
 * بین دو حساب است که یک سند مشترک دارد.
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const TREASURY_DIR = 'src/services/accounting/treasury/';
const OUTSIDE_ALLOWED = [TREASURY_DIR, 'src/tests/', 'src/db/'];
const POSTING_FILE = `${TREASURY_DIR}treasuryPosting.ts`;
/** the bank-to-bank transfer writes its two rows itself (one shared voucher, TD-341) */
const TRANSFER_FILE = `${TREASURY_DIR}treasuryTransaction.service.ts`;

const DRIZZLE_WRITE = /\.(?:insert|update|delete)\(\s*(?:\w+\.)?(?:bankAccounts|treasuryTransactions)\s*\)/g;
const SQL_WRITE = /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+"?(?:bank_accounts|treasury_transactions)\b/gi;
const ROW_INSERT = /\.insert\(\s*(?:\w+\.)?treasuryTransactions\s*\)/g;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** one scan of the repository for the whole file (TD-1261) */
const SOURCES = productionFiles(SRC).map(file => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8'),
}));

function hits(text: string, pattern: RegExp, rel: string): string[] {
  return [...text.matchAll(pattern)].map(match =>
    `${rel}:${text.slice(0, match.index).split('\n').length} ${match[0].replace(/\s+/g, ' ')}`);
}

describe('treasury payments have one path (OBS-R2-52)', () => {
  it('no production file outside the treasury services writes a treasury row or a bank balance', () => {
    const found = SOURCES
      .filter(({ rel }) => !OUTSIDE_ALLOWED.some(dir => rel.startsWith(dir)))
      .flatMap(({ rel, text }) => [...hits(text, DRIZZLE_WRITE, rel), ...hits(text, SQL_WRITE, rel)]);
    expect(found).toEqual([]);
  });

  it('inside the treasury services only the shared posting inserts a treasury row, besides the transfer pair', () => {
    const inserts = SOURCES
      .filter(({ rel }) => rel.startsWith(TREASURY_DIR) && rel !== POSTING_FILE)
      .flatMap(({ rel, text }) => hits(text, ROW_INSERT, rel));
    expect(inserts.map(hit => hit.split(':')[0])).toEqual([TRANSFER_FILE, TRANSFER_FILE]);
    const posting = SOURCES.find(({ rel }) => rel === POSTING_FILE);
    expect(posting && hits(posting.text, ROW_INSERT, POSTING_FILE)).toHaveLength(2);
  });

  it('the scan sees a direct write', () => {
    const sample = 'await tx.update(bankAccounts).set({ currentBalance }); await tx.insert(schema.treasuryTransactions).values(row);';
    expect(sample.match(DRIZZLE_WRITE)).toHaveLength(2);
    expect('UPDATE bank_accounts SET current_balance = 0'.match(SQL_WRITE)).toHaveLength(1);
    expect(sample.match(ROW_INSERT)).toHaveLength(1);
  });
});
