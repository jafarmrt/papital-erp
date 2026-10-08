import { CHEQUE_TRANSITIONS } from '../../lib/treasury/chequeTransitions.js';
import type { InvariantViolation } from './businessInvariants.js';
import { rows } from './ledgerRows.js';

/**
 * v10.0.10 (TD-982, I-01) — I9 of the V8 catalogue (V8_MASTER_ROADMAP.md §4), read-only SQL over the live cheques above
 * the watermark:
 * - the status history starts at the registration status (received / in_treasury), each step is a transition of
 *   CHEQUE_TRANSITIONS and the last step is the cheque's status;
 * - every step that posts (cleared, in collection, bounced, returned to the drawer, spent; `chequeLifecycle.service.ts`)
 *   has its own live voucher linked by `source_cheque_id` (TD-271), so a cheque registered with a voucher has exactly
 *   1 + (posting steps) live vouchers.
 */

const POSTING_STEPS: Record<'received' | 'paid', ReadonlySet<string>> = {
  received: new Set(['passed', 'in_collection', 'bounced', 'returned', 'spent']),
  paid: new Set(['passed', 'bounced']),
};

interface HistoryStep { status?: unknown }

export async function checkChequeTransitions(chequeIdAfter: number | undefined): Promise<InvariantViolation[]> {
  if (chequeIdAfter === undefined) return [];
  const cheques = await rows<{ id: number; cheque_number: string; type: string; status: string; voucher_id: number | null; history: unknown; vouchers: string }>(
    `SELECT q.id, q.cheque_number, q.type, q.status, q.voucher_id, q.status_history AS history,
            (SELECT COUNT(*) FROM journal_vouchers v WHERE v.source_cheque_id = q.id AND v.is_deleted = 0)::text AS vouchers
       FROM cheques q
      WHERE q.id > $1 AND q.is_deleted = 0
      ORDER BY q.id`,
    [chequeIdAfter]
  );
  const violations: InvariantViolation[] = [];
  for (const q of cheques) {
    const steps = (Array.isArray(q.history) ? q.history as HistoryStep[] : []).map(s => String(s?.status ?? ''));
    const type = q.type === 'paid' ? 'paid' : 'received';
    const start = type === 'received' ? 'received' : 'in_treasury';
    const key = `cheque:${q.id}`;
    const badStep = steps.findIndex((s, i) => (i === 0 ? s !== start : !(CHEQUE_TRANSITIONS[steps[i - 1]] ?? []).includes(s as never)));
    if (steps.length === 0 || badStep >= 0 || steps[steps.length - 1] !== q.status) {
      violations.push({
        invariant: 'I9_cheque_transitions',
        key,
        message: `Cheque ${q.cheque_number} has a status history that is not a chain of allowed transitions ending at its status`,
        expected: `${start} -> ... -> ${q.status}`,
        actual: steps.join(' -> ') || '(empty)',
      });
      continue;
    }
    if (q.voucher_id === null) continue; // recorded without a voucher (TD-409): listed by the health check instead
    const expected = 1 + steps.slice(1).filter(s => POSTING_STEPS[type].has(s)).length;
    if (Number(q.vouchers) !== expected) {
      violations.push({
        invariant: 'I9_cheque_transitions',
        key: `${key}:vouchers`,
        message: `Cheque ${q.cheque_number} has ${q.vouchers} live vouchers for its history ${steps.join(' -> ')}`,
        expected: String(expected),
        actual: q.vouchers,
      });
    }
  }
  return violations;
}
