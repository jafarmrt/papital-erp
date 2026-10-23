import fs from 'fs';
import path from 'path';
import { TestCaseResult, makeTestCase } from '../types.js';
import { MONEY_STOCK_WRITE_MODULES, PLAIN_TRANSACTION_WRITES, plainTransactionViolations } from './resubmissionPolicy.js';

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.posix.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.posix.join(dir, e.name)] : []);

/** The sources the rule covers: `MONEY_STOCK_WRITE_MODULES` and every route file that takes a resubmission key */
function moneyStockWriteSources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of MONEY_STOCK_WRITE_MODULES) {
    for (const file of entry.endsWith('/') ? walk(entry.slice(0, -1)) : [entry]) files.set(file, fs.readFileSync(file, 'utf8'));
  }
  for (const file of walk('src/routes')) {
    const source = fs.readFileSync(file, 'utf8');
    if (/\bidempotency\(\{/.test(source)) files.set(file, source);
  }
  return files;
}

/**
 * 10.3 (ARCH review finding 1): the money and stock writes open their transaction with `idempotentTransaction`, so the
 * resubmission key is completed in the same commit; the plain ones are listed with their reason. Red on v10.2.39: about
 * seventy writes of treasury, vouchers, documents, stock, items, procurement, projects and the workshop were plain.
 */
export async function runMoneyStockWriteKeyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const id = 'sec_money_stock_writes_complete_key_in_tx';
  if (!shouldRun(id, 'security', 'idempotency', 'resubmission', 'package10_3')) return [];
  const tStart = Date.now();
  const name = '10.3: the money and stock writes complete their resubmission key in their own transaction; the plain ones are listed with their reason (ARCH review finding 1)';
  try {
    const files = moneyStockWriteSources();
    if (files.size < 100) throw new Error(`only ${files.size} files scanned; the module list does not match the tree`);
    const violations = plainTransactionViolations(files);
    if (violations.length > 0) throw new Error(`${violations.length} money or stock writes complete their key after the answer: ${violations.join(' | ')}`);
    return [makeTestCase({ id, name, layer: 'security', executionType: 'real_code', passed: true, durationMs: Date.now() - tStart,
      details: `${files.size} files scanned, ${PLAIN_TRANSACTION_WRITES.size} listed` })];
  } catch (err) {
    return [makeTestCase({ id, name, layer: 'security', executionType: 'real_code', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err) })];
  }
}
