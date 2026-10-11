import type { RouteGuardRow } from '../../lib/routeGuardTable.js';

/**
 * v10.0.35 (TD-979، OBS-R2-06): هر route نویسنده ورودی‌اش را با Zod می‌خواند (`validate`، AGENTS.md و نقشه راه V7).
 * POST / PUT / PATCH اسکیمای `body` دارد و DELETE دست‌کم `validate` پارامترهایش را. تنها استثنا routeهای بی‌بدنه زیرند؛
 * هندلر هر کدام بازبینی شده و `req.body` را نمی‌خواند. فهرست فقط کوتاه می‌شود: route تازه بی اسکیما و ردیفی که دیگر
 * لازم نیست هر دو آزمون را قرمز می‌کنند.
 */
export const WRITER_ROUTES_WITHOUT_BODY = new Set([
  // فقط محدودکننده ورود (`app.ts`)؛ بدنه را route ورود با `loginSchema` می‌خواند
  'POST /api/login', 'POST /api/auth/login',
  'POST /api/logout', 'POST /api/auth/logout',
  'POST /api/accounting/accounts/:id/restore',
  'POST /api/accounting/accounts/seed-default', 'POST /api/accounting/accounts/seed-standard',
  'POST /api/accounting/bank-accounts/sync-reconcile', 'POST /api/accounting/banks/sync-reconcile',
  'POST /api/accounting/quick-fix/sync-all-vouchers',
  'POST /api/accounting/vouchers/:id/finalize',
  'POST /api/categories/reset-defaults',
  'POST /api/crm/leads/:id/convert-to-customer',
  'POST /api/events/dlq/purge',
  'POST /api/events/outbox/:eventId/retry',
  'POST /api/events/outbox/retry-failed',
  'POST /api/events/webhooks/:id/rotate-secret', 'POST /api/events/webhooks/:id/toggle',
  'POST /api/inventory/allocations/:id/consume',
  'POST /api/inventory/kardex-initial-backfill',
  // بدنه خود پرونده است (جریان خام، نه JSON)؛ پرسمان با `mediaUploadSchema` / `mediaPosterSchema` سنجیده می‌شود
  'POST /api/media/assets', 'PUT /api/media/assets/:id/poster',
  'POST /api/media/assets/:id/rebuild-light',
  'POST /api/piecework/payrolls/:id/sync-voucher',
  'POST /api/piecework/tasks/:id/restore',
  'POST /api/piecework/tasks/clear-defaults', 'POST /api/piecework/tasks/clear-all',
  'POST /api/procurement/orders/:id/deliver',
  'POST /api/warehouses/:id/reactivate',
  'POST /api/woocommerce/sync-all-stocks',
  'POST /api/workflow/delegations/:id/revoke',
  'PUT /api/notifications/:id/read', 'PUT /api/notifications/read-all',
]);

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function writerRouteValidationViolations(rows: RouteGuardRow[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const unvalidatedBody = new Set<string>();
  for (const row of rows) {
    const key = `${row.method} ${row.path}`;
    seen.add(key);
    if (BODY_METHODS.has(row.method)) {
      if (row.validatesBody) continue;
      unvalidatedBody.add(key);
      if (!WRITER_ROUTES_WITHOUT_BODY.has(key)) violations.push(`${key}: no Zod body schema`);
    } else if (row.method === 'DELETE' && !row.validated) {
      violations.push(`${key}: no validate()`);
    }
  }
  for (const key of WRITER_ROUTES_WITHOUT_BODY) {
    if (!seen.has(key)) violations.push(`${key}: listed without a body but no such route exists`);
    else if (!unvalidatedBody.has(key)) violations.push(`${key}: listed without a body but every registration validates one; remove it from the list`);
  }
  return violations;
}
