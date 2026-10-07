import 'dotenv/config';
import { sql, type SQL } from 'drizzle-orm';
import { TEST_MARKER } from '../src/tests/fixtures/testMarker.js';

/**
 * Test data cleanup (TD-036, TD-107; v9.0.111, TD-581, owner decision t1 «الف»).
 *
 *   NODE_ENV=development ERP_ALLOW_TEST_CLEANUP=1 npm run db:cleanup-test            preview (default)
 *   NODE_ENV=development ERP_ALLOW_TEST_CLEANUP=1 npm run db:cleanup-test -- --force  delete
 *
 * - Runs only with NODE_ENV test or development AND ERP_ALLOW_TEST_CLEANUP=1 (AGENTS.md §23); otherwise it stops
 *   before connecting to the database.
 * - Touches only rows that carry TEST_MARKER, and of those only rows nothing else still refers to; the rest are kept
 *   and counted. No real-format pattern (PAY-, REV-V, SILVER-, user_, DOC-, ...) is ever used.
 * - Never deletes Kardex rows, treasury rows, cheques, users, audit logs, outbox, dead letter or idempotency rows,
 *   workflow definitions, and never changes counters or sequences.
 * - Preview runs the same steps in a transaction that is rolled back, so its counts are exact.
 */

export const CLEANUP_ALLOWED_ENVS = ['test', 'development'] as const;

/** Why the cleanup must not run in this environment, or null when it may */
export function cleanupRefusal(env: NodeJS.ProcessEnv): string | null {
  const nodeEnv = env.NODE_ENV ?? '';
  if (!(CLEANUP_ALLOWED_ENVS as readonly string[]).includes(nodeEnv)) {
    return `NODE_ENV is "${nodeEnv || '(unset)'}"; the test data cleanup runs only with NODE_ENV=test or NODE_ENV=development`;
  }
  if (env.ERP_ALLOW_TEST_CLEANUP !== '1') return 'ERP_ALLOW_TEST_CLEANUP=1 is required';
  return null;
}

interface CleanupStep {
  label: string;
  /** Rows carrying the marker (before this step) */
  candidates: SQL;
  /** Deletes the step's rows (child rows first); the last statement's row count is the step's count */
  deletes: SQL[];
}

/** Workflow runtime rows of the entities listed in a temp table */
function workflowOf(entityType: string, idTable: string): SQL[] {
  const instances = sql`SELECT id FROM workflow_instances WHERE entity_type = ${entityType}
    AND entity_id IN (SELECT id::text FROM ${sql.identifier(idTable)})`;
  return [
    sql`DELETE FROM workflow_history_logs WHERE instance_id IN (${instances})`,
    sql`DELETE FROM workflow_tasks WHERE instance_id IN (${instances})`,
    sql`DELETE FROM workflow_pending_approvals WHERE instance_id IN (${instances})`,
    sql`DELETE FROM workflow_instances WHERE id IN (${instances})
      AND NOT EXISTS (SELECT 1 FROM purchase_requisitions pr WHERE pr.workflow_instance_id = workflow_instances.id)`,
  ];
}

/** A voucher that treasury, a cheque or a fiscal year closing still refers to stays */
const voucherReferenced = (v: string) => sql`(
  EXISTS (SELECT 1 FROM treasury_transactions tt WHERE tt.voucher_id = ${sql.identifier(v)}.id)
  OR EXISTS (SELECT 1 FROM cheques c WHERE c.voucher_id = ${sql.identifier(v)}.id)
  OR EXISTS (SELECT 1 FROM fiscal_periods fp WHERE fp.closing_voucher_id = ${sql.identifier(v)}.id))`;

export function cleanupSteps(m: string): CleanupStep[] {
  const markedDoc = sql`(d.notes ILIKE ${m} OR d.buyer_name ILIKE ${m})`;
  const markedLead = sql`(l.title ILIKE ${m} OR l.company ILIKE ${m} OR l.customer_name ILIKE ${m})`;
  return [
    {
      label: 'daily work logs',
      candidates: sql`SELECT count(*)::int AS c FROM daily_work_logs WHERE title ILIKE ${m} OR content ILIKE ${m}`,
      deletes: [sql`DELETE FROM daily_work_logs WHERE title ILIKE ${m} OR content ILIKE ${m}`],
    },
    {
      label: 'CRM activities',
      candidates: sql`SELECT count(*)::int AS c FROM crm_activities a WHERE a.title ILIKE ${m}
        OR a.lead_id IN (SELECT l.id FROM crm_leads l WHERE ${markedLead})`,
      deletes: [sql`DELETE FROM crm_activities a WHERE a.title ILIKE ${m}
        OR a.lead_id IN (SELECT l.id FROM crm_leads l WHERE ${markedLead})`],
    },
    {
      label: 'piecework logs',
      candidates: sql`SELECT count(*)::int AS c FROM piecework_logs WHERE notes ILIKE ${m}`,
      deletes: [sql`DELETE FROM piecework_logs pl WHERE pl.notes ILIKE ${m}
        AND (pl.payroll_id IS NULL OR pl.payroll_id IN (SELECT p.id FROM piecework_payrolls p WHERE p.title ILIKE ${m}))`],
    },
    {
      // A marked document goes only with no Kardex row, no treasury row, no return of it, no WooCommerce log, no
      // year correction, no unmarked sales lead pointing at it, and only when its own vouchers can go too.
      label: 'documents (with lines, vouchers, workflow)',
      candidates: sql`SELECT count(*)::int AS c FROM documents d WHERE ${markedDoc}`,
      deletes: [
        sql`CREATE TEMP TABLE erp_cleanup_docs ON COMMIT DROP AS SELECT d.id FROM documents d WHERE ${markedDoc}
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.document_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM treasury_transactions tt WHERE tt.document_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM documents r WHERE r.return_of_document_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM woocommerce_order_logs w WHERE w.erp_document_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM ref_fiscal_year_corrections f WHERE f.document_id = d.id)
          AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.proforma_id = d.id AND NOT ${markedLead})
          AND NOT EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.source_document_id = d.id AND ${voucherReferenced('v')})`,
        ...workflowOf('document', 'erp_cleanup_docs'),
        sql`DELETE FROM journal_voucher_items WHERE voucher_id IN (SELECT id FROM journal_vouchers
          WHERE source_document_id IN (SELECT id FROM erp_cleanup_docs))`,
        sql`DELETE FROM journal_vouchers WHERE source_document_id IN (SELECT id FROM erp_cleanup_docs)`,
        sql`DELETE FROM document_items WHERE document_id IN (SELECT id FROM erp_cleanup_docs)`,
        sql`DELETE FROM documents WHERE id IN (SELECT id FROM erp_cleanup_docs)`,
      ],
    },
    {
      label: 'journal vouchers (with rows, workflow)',
      candidates: sql`SELECT count(*)::int AS c FROM journal_vouchers WHERE description ILIKE ${m}`,
      deletes: [
        sql`CREATE TEMP TABLE erp_cleanup_vouchers ON COMMIT DROP AS SELECT v.id FROM journal_vouchers v
          WHERE v.description ILIKE ${m} AND v.source_document_id IS NULL AND v.source_payroll_id IS NULL
          AND v.source_cheque_id IS NULL AND NOT ${voucherReferenced('v')}`,
        ...workflowOf('journal_voucher', 'erp_cleanup_vouchers'),
        sql`DELETE FROM journal_voucher_items WHERE voucher_id IN (SELECT id FROM erp_cleanup_vouchers)`,
        sql`DELETE FROM journal_vouchers WHERE id IN (SELECT id FROM erp_cleanup_vouchers)`,
      ],
    },
    {
      label: 'piecework payrolls',
      candidates: sql`SELECT count(*)::int AS c FROM piecework_payrolls WHERE title ILIKE ${m}`,
      deletes: [sql`DELETE FROM piecework_payrolls p WHERE p.title ILIKE ${m}
        AND NOT EXISTS (SELECT 1 FROM piecework_logs pl WHERE pl.payroll_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM treasury_transactions tt WHERE tt.payroll_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.source_payroll_id = p.id)`],
    },
    {
      label: 'sales leads',
      candidates: sql`SELECT count(*)::int AS c FROM crm_leads l WHERE ${markedLead}`,
      deletes: [sql`DELETE FROM crm_leads l WHERE ${markedLead}
        AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.crm_lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.lead_id = l.id)`],
    },
    {
      label: 'production projects (with stages)',
      candidates: sql`SELECT count(*)::int AS c FROM production_projects WHERE title ILIKE ${m}`,
      deletes: [
        sql`CREATE TEMP TABLE erp_cleanup_projects ON COMMIT DROP AS SELECT p.id FROM production_projects p WHERE p.title ILIKE ${m}
          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM purchase_requisitions pr WHERE pr.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM project_bom_allocations b WHERE b.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM pending_materials pm WHERE pm.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM piecework_logs pl WHERE pl.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM daily_work_logs dl WHERE dl.project_id = p.id)`,
        sql`DELETE FROM project_stages WHERE project_id IN (SELECT id FROM erp_cleanup_projects)`,
        sql`DELETE FROM project_product_stage_progress WHERE project_id IN (SELECT id FROM erp_cleanup_projects)`,
        sql`DELETE FROM production_projects WHERE id IN (SELECT id FROM erp_cleanup_projects)`,
      ],
    },
    {
      label: 'items (with prices, workflow)',
      candidates: sql`SELECT count(*)::int AS c FROM items WHERE name ILIKE ${m}`,
      deletes: [
        sql`CREATE TEMP TABLE erp_cleanup_items ON COMMIT DROP AS SELECT i.id FROM items i WHERE i.name ILIKE ${m}
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM document_items di WHERE di.item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM project_product_stage_progress sp WHERE sp.item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM project_bom_allocations b WHERE b.item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM production_projects p WHERE p.item_id = i.id)`,
        ...workflowOf('item', 'erp_cleanup_items'),
        sql`DELETE FROM item_prices WHERE item_id IN (SELECT id FROM erp_cleanup_items)`,
        sql`DELETE FROM items WHERE id IN (SELECT id FROM erp_cleanup_items)`,
      ],
    },
    {
      label: 'personnel',
      candidates: sql`SELECT count(*)::int AS c FROM personnel WHERE full_name ILIKE ${m}`,
      deletes: [sql`DELETE FROM personnel p WHERE p.full_name ILIKE ${m}
        AND NOT EXISTS (SELECT 1 FROM piecework_logs pl WHERE pl.personnel_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM piecework_payrolls pp WHERE pp.personnel_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.assigned_personnel_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.assigned_personnel_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM treasury_transactions tt WHERE tt.party_type = 'personnel' AND tt.party_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM journal_voucher_items vi WHERE vi.detailed_type = 'personnel' AND vi.detailed_id = p.id)`],
    },
    {
      label: 'customers and suppliers',
      candidates: sql`SELECT count(*)::int AS c FROM customers WHERE name ILIKE ${m} OR notes ILIKE ${m}`,
      deletes: [sql`DELETE FROM customers c WHERE (c.name ILIKE ${m} OR c.notes ILIKE ${m})
        AND NOT EXISTS (SELECT 1 FROM journal_voucher_items vi WHERE vi.detailed_type IN ('customer', 'supplier') AND vi.detailed_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM crm_leads l WHERE l.customer_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM crm_activities a WHERE a.customer_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM production_projects p WHERE p.customer_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM cheques ch WHERE ch.party_type IN ('customer', 'supplier') AND ch.party_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM treasury_transactions tt WHERE tt.party_type IN ('customer', 'supplier') AND tt.party_id = c.id)`],
    },
  ];
}

export interface CleanupReportRow {
  step: string;
  marked: number;
  deleted: number;
  kept: number;
}

class PreviewRollback extends Error {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--force' && a !== '--dry-run');
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')} (supported: --force, --dry-run)`);
  const refusal = cleanupRefusal(process.env);
  if (refusal) throw new Error(`Refused: ${refusal}. Nothing was read or changed.`);
  const force = args.includes('--force') && !args.includes('--dry-run');

  // imported only after the gate: a refused run never opens a database connection
  const { orm } = await import('../src/db/drizzle.js');
  const report: CleanupReportRow[] = [];
  console.log(`Test data cleanup (marker ${TEST_MARKER}); mode: ${force ? 'DELETE (--force)' : 'PREVIEW (rolled back; add --force to delete)'}`);
  try {
    await orm.transaction(async tx => {
      for (const step of cleanupSteps(`%${TEST_MARKER}%`)) {
        const counted = await tx.execute(step.candidates);
        const marked = Number((counted.rows[0] as { c?: unknown } | undefined)?.c ?? 0);
        let deleted = 0;
        for (const statement of step.deletes) deleted = (await tx.execute(statement)).rowCount ?? 0;
        report.push({ step: step.label, marked, deleted, kept: marked - deleted });
      }
      if (!force) throw new PreviewRollback();
    });
  } catch (err: unknown) {
    if (!(err instanceof PreviewRollback)) throw err;
  }
  console.table(report);
  const kept = report.reduce((n, r) => n + r.kept, 0);
  if (kept > 0) console.log(`${kept} marked row(s) kept because other rows still refer to them (Kardex, treasury, vouchers, ...).`);
  console.log(force ? 'Done: marked rows deleted. Kardex, treasury, users, audit logs, counters and sequences were not touched.'
    : 'Preview only: nothing was changed.');
  process.exit(0);
}

if (process.argv[1]?.endsWith('cleanup-test-data.ts') || process.argv[1]?.endsWith('cleanup-test-data.js')) {
  main().catch((err: unknown) => {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}${cause}`);
    process.exit(1);
  });
}
