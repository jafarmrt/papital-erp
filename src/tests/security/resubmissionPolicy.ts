import type { RouteGuardRow } from '../../lib/routeGuardTable.js';

/**
 * v10.1.64 (OBS-R2-14, decision ت۴۰ item 18): the written resubmission rule for money and stock routes. Every writer
 * route (POST / PUT / PATCH / DELETE) of these sections that needs a login runs the `idempotency` middleware: the browser
 * sends one Idempotency-Key per submission (`submissionKeyFor`), so a double click or a resend after a lost answer gets
 * the first answer instead of a second record (a payment, a work log or a project twice). A deliberate second identical
 * submission after a definite answer takes a new key and is recorded again, so the rule never blocks real work.
 * The only routes left out are listed below with the reason; the list only shrinks.
 */
export const MONEY_STOCK_ROUTE_PREFIXES = [
  '/api/accounting/', '/api/documents', '/api/inventory/', '/api/items', '/api/piecework/', '/api/procurement/',
  '/api/projects', '/api/transfers', '/api/warehouses', '/api/woocommerce/', '/api/workshop/',
  // a raw material request becomes an item on approval (review of #308)
  '/api/pending-materials',
];

export const RESUBMISSION_EXEMPT_ROUTES = new Map<string, string>([
  ['POST /api/accounting/treasury/preview-voucher', 'writes nothing: it only builds the voucher a treasury entry would get'],
  ['POST /api/woocommerce/test-connection', 'writes nothing: it only calls the shop with the given or stored keys'],
]);

const WRITER_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function resubmissionPolicyViolations(rows: RouteGuardRow[]): string[] {
  const violations: string[] = [];
  const seen = new Map<string, boolean>();
  for (const row of rows) {
    if (!WRITER_METHODS.has(row.method) || !row.authenticated) continue;
    if (!MONEY_STOCK_ROUTE_PREFIXES.some(prefix => row.path.startsWith(prefix))) continue;
    const key = `${row.method} ${row.path}`;
    seen.set(key, (seen.get(key) ?? false) || row.idempotent);
    if (row.idempotent || RESUBMISSION_EXEMPT_ROUTES.has(key)) continue;
    violations.push(`${key}: no idempotency()`);
  }
  for (const key of RESUBMISSION_EXEMPT_ROUTES.keys()) {
    if (!seen.has(key)) violations.push(`${key}: listed as exempt but no such route exists`);
    else if (seen.get(key)) violations.push(`${key}: listed as exempt but runs idempotency(); remove it from the list`);
  }
  return violations;
}

/**
 * 10.3 (ARCH review finding 1): the modules that hold the writes behind the money and stock routes, besides every route
 * file that runs `idempotency()`. Their write transactions open with `idempotentTransaction` (or `idempotentTransactionOn`),
 * which completes the request's key in the same commit, so a process that dies after the commit leaves a completed key
 * and a resend gets the «already registered» notice instead of recording a second receipt, voucher, document or stock
 * movement. Before, only payroll and piecework did (v10.2.35, TD-1365) and the key was completed after the answer.
 */
export const MONEY_STOCK_WRITE_MODULES = [
  'src/services/accounting/', 'src/services/documents/', 'src/services/inventory/', 'src/services/items/',
  'src/services/piecework/', 'src/services/projects/', 'src/services/workshop/',
  'src/services/pendingMaterials.service.ts', 'src/services/piecework.service.ts', 'src/services/procurement.service.ts',
  'src/services/projects.service.ts', 'src/services/transfer.service.ts', 'src/services/warehouse.service.ts',
];

/**
 * The plain `orm.transaction` writes left in those modules, by file, with how many and why. A resend after a crash
 * repeats nothing there, or no money or stock route reaches them; the list only shrinks.
 */
export const PLAIN_TRANSACTION_WRITES = new Map<string, { count: number; reason: string }>([
  ['src/services/accounting/voucherSync.service.ts', { count: 1, reason: '«ساخت اسناد جاافتاده» runs one transaction per document and makes only the vouchers still missing, so a resend finds them made' }],
  ['src/services/documents/documentRefNumber.service.ts', { count: 1, reason: 'a write takes its number on its own transaction; alone it only serves a number to a form' }],
  ['src/services/inventory/kardexBackfill.service.ts', { count: 1, reason: 'adds only the opening movements still missing, under its own lock, so a resend finds them added' }],
  ['src/services/inventory/kardexWacRecalculator.service.ts', { count: 1, reason: 'rebuilds an item\'s stock from its Kardex, one transaction per item in «بازسازی همه»; a resend rebuilds the same stock' }],
  ['src/services/inventory/warehouseStockReconciliation.service.ts', { count: 1, reason: 'repairs one item per transaction and only where the stock differs from the Kardex, so a resend finds nothing to repair' }],
  ['src/services/items/itemCategory.service.ts', { count: 4, reason: 'item categories (/api/categories) are outside the money and stock routes and take no resubmission key' }],
]);

/** A transaction opened on the pool: `orm.transaction(`, or that of an executor defaulting to it, unless the line opens the
 * pool's transaction with `idempotentTransaction` and keeps this one for a caller's transaction (a savepoint) */
const PLAIN_TRANSACTION = /\b(?:orm|executor|outer)\.transaction\(/g;

/** Files whose plain `orm.transaction` writes differ from `PLAIN_TRANSACTION_WRITES` (`files` maps a path to its source) */
export function plainTransactionViolations(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    const count = source.split('\n')
      .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line) && !/idempotentTransaction(On)?\(/.test(line))
      .reduce((n, line) => n + (line.match(PLAIN_TRANSACTION) ?? []).length, 0);
    const allowed = PLAIN_TRANSACTION_WRITES.get(file)?.count ?? 0;
    if (count > allowed) violations.push(`${file}: ${count} orm.transaction write(s), ${allowed} listed; open it with idempotentTransaction`);
    else if (count < allowed) violations.push(`${file}: ${allowed} orm.transaction write(s) listed but ${count} left; lower the list`);
  }
  for (const file of PLAIN_TRANSACTION_WRITES.keys()) {
    if (!files.has(file)) violations.push(`${file}: listed in PLAIN_TRANSACTION_WRITES but not scanned`);
  }
  return violations;
}
