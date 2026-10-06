import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MONEY_STOCK_PATHS } from '../../../eslint.config.js';
import { toStorageDate } from '../../utils/calendarDate';
import { jalaliToIsoDate } from '../../utils/dateUtils';

// v9.0.89 (TD-669، B16-05): jalaliToIsoDate و normalizeDateToIso روز و ماه را نمی‌سنجند (۱۴۰۴/۱۲/۳۰ ← ۱ فروردین ۱۴۰۵).
// مسیرهای پول و انبار تاریخ ورودی را با requireStorageDate می‌خوانند؛ شمار فراخوان این دو تبدیلگر در آن مسیرها فقط کم می‌شود.
const LOOSE_CALL = /\b(jalaliToIsoDate|normalizeDateToIso)\s*\(/g;
const BASELINE: Record<string, number> = {
  // فیلتر تاریخ گزارش (خواندن)، نه نوشتن
  'src/services/accounting/accountingReport.service.ts': 3,
  // مرز سال مالی از روز اول فروردین (همیشه روز معتبر)
  'src/services/documents/documentRefNumber.service.ts': 2,
};

const root = path.resolve(__dirname, '../../..');
const globToRegExp = (glob: string): RegExp => new RegExp(`^${glob
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '(?:.*/)?')}$`);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else if (rel.endsWith('.ts')) out.push(rel);
  }
  return out;
}

function looseCallsInMoneyStockPaths(): Record<string, number> {
  const patterns = MONEY_STOCK_PATHS.map(globToRegExp);
  const counts: Record<string, number> = {};
  for (const file of listFiles('src')) {
    if (!patterns.some(p => p.test(file))) continue;
    const code = fs.readFileSync(path.join(root, file), 'utf8')
      .split('\n').filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n');
    const n = (code.match(LOOSE_CALL) || []).length;
    if (n > 0) counts[file] = n;
  }
  return counts;
}

describe('loose date converters in money and stock paths (TD-669, B16-05)', () => {
  it('shows why: the loose converter moves a non-existent day into the next fiscal year', () => {
    expect(jalaliToIsoDate('1404/12/30')).toBe('2026-03-21');
    expect(toStorageDate('1404/12/30')).toBeNull();
    expect(toStorageDate('1404/07/31')).toBeNull();
  });

  it('never adds a call: no new file and no file above its baseline', () => {
    const counts = looseCallsInMoneyStockPaths();
    const increased = Object.entries(counts).filter(([file, n]) => n > (BASELINE[file] ?? 0));
    expect(increased).toEqual([]);
  });

  it('treasury and cheque write paths have none', () => {
    const counts = looseCallsInMoneyStockPaths();
    expect(Object.keys(counts).filter(f => f.startsWith('src/services/accounting/treasury/'))).toEqual([]);
  });

  it('the baseline only shrinks: a file below its baseline lowers it in the same change', () => {
    const counts = looseCallsInMoneyStockPaths();
    const lower = Object.entries(BASELINE).filter(([file, n]) => (counts[file] ?? 0) < n);
    expect(lower).toEqual([]);
  });
});
