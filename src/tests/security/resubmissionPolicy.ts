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
