/**
 * v9.0.427 (TD-589, B01-09, decision t5): the notices a migration raises when it leaves a constraint or index out
 * because existing data is not clean (`RAISE WARNING '... SKIPPED'`, `RAISE NOTICE '... not created'`,
 * `... left NOT VALID`). PostgreSQL sends them to the client as notices; the migrator listened to none, so an upgraded
 * database answered `success: true, warnings: []` without `fk_transactions_item_id` or `uq_cheques_sayad_number_active`.
 * They are now returned in `warnings` and logged; the financial health check lists what is still missing
 * (`conditional_constraints_missing`).
 */
export interface MigrationNotice {
  severity?: string;
  message?: string;
}

/** The warning text of one notice, or null for an ordinary notice (an object created, a row count) */
export function migrationNoticeWarning(notice: MigrationNotice): string | null {
  const message = String(notice.message ?? '').trim();
  if (!message) return null;
  if (String(notice.severity ?? '').toUpperCase() === 'WARNING') return message;
  return /\bSKIPPED\b|\bnot created\b|\bleft NOT VALID\b/.test(message) ? message : null;
}
