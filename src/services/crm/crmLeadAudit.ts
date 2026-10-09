import type { crmLeads } from '../../db/schema.js';

/**
 * v10.0.38 (OBS-R2-33، TD-991): ردیف ممیزی ویرایش پرونده فروش و «تبدیل به مشتری» با پیش و پس فیلدهای پرونده و فقط
 * فیلدهای تغییرکرده. پیش‌تر ویرایش فقط «ویرایش فرصت فروش» بی پیش و پس می‌نوشت و تبدیل به مشتری ممیزی نداشت.
 */

type Lead = typeof crmLeads.$inferSelect;

const AUDITED_LEAD_FIELDS = [
  'title', 'customerId', 'customerName', 'phone', 'company', 'contacts', 'source', 'stage', 'status', 'estimatedValue',
  'currency', 'probability', 'assignedTo', 'assignedPersonnelId', 'expectedCloseDate', 'notes', 'hasProforma', 'proformaId',
] as const satisfies readonly (keyof Lead)[];

export type LeadAuditSnapshot = Partial<Record<typeof AUDITED_LEAD_FIELDS[number], unknown>>;

function auditValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

export function leadAuditSnapshot(lead: Lead): LeadAuditSnapshot {
  const snapshot: LeadAuditSnapshot = {};
  for (const field of AUDITED_LEAD_FIELDS) snapshot[field] = auditValue(lead[field]);
  return snapshot;
}

export function leadAuditDetails(before: Lead, after: Lead) {
  const b = leadAuditSnapshot(before);
  const a = leadAuditSnapshot(after);
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of AUDITED_LEAD_FIELDS) {
    if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) changes[field] = { before: b[field], after: a[field] };
  }
  return { before: b, after: a, changes };
}
