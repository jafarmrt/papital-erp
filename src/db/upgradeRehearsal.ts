import type pkg from 'pg';
import type { FinancialHealthReport, HealthCheckStatus } from '../types.js';
import { terminalLine } from '../lib/terminalText.js';

/**
 * v8.0.88 (TD-367): تمرین ارتقا روی رونوشت داده. `scripts/upgrade-rehearsal.sh` آخرین پشتیبان را در پایگاه‌داده تمرین
 * (`erp_restore_drill_*`) بازیابی می‌کند و `scripts/upgrade-rehearsal.ts` مهاجرت‌های همین کد را روی آن اجرا می‌کند.
 * این ماژول پیش و پس از مهاجرت از داده عکس می‌گیرد و دو عکس را مقایسه می‌کند: جمع بدهکار و بستانکار هر حساب در
 * هر ارز، موجودی و میانگین بهای هر کالا، موجودی هر کالا در هر انبار و مانده هر بانک نباید با مهاجرت عوض شوند؛
 * آزمون سلامت مالی نباید بدتر شود. کم شدن سطرهای یک جدول و سطرهای ناقض قیدهای NOT VALID فقط گزارش می‌شوند.
 * پرس‌وجوها به ستون‌هایی تکیه دارند که از مهاجرت پایه وجود داشته‌اند، تا روی پشتیبان نسخه‌های قدیمی هم کار کنند.
 */

export type Queryable = Pick<pkg.Pool, 'query'>;

/** بخش‌های جمع کسب‌وکار؛ هر بخش فقط وقتی مقایسه می‌شود که پیش و پس از مهاجرت خوانده شده باشد */
export type TotalsSection = 'ledger' | 'item' | 'warehouse_stock' | 'bank';

export interface RehearsalSnapshot {
  /** کلید (با پیشوند بخش) ← مقدار عددی متنی؛ نبودِ کلید یعنی صفر */
  totals: Map<string, string>;
  /** نام خوانای هر کلید (کد حساب، کالا، انبار، بانک) */
  labels: Map<string, string>;
  sections: Set<TotalsSection>;
  rowCounts: Map<string, number>;
  /** قید NOT VALID ← تعداد سطرهای ناقض آن */
  notValid: Map<string, number>;
  unavailable: string[];
}

/** v10.0.14 (TD-1000): the health check is named by its id on the terminal, never by its Persian title */
export interface HealthStatus {
  status: HealthCheckStatus;
  count: number;
}

export interface RehearsalFindings {
  /** تغییرهایی که مهاجرت نباید بدهد: ارتقا روی این داده امن نیست */
  problems: string[];
  /** برای اطلاع اپراتور */
  notices: string[];
}

export const REHEARSAL_DATABASE_PREFIX = 'erp_restore_drill_';

/** تمرین فقط روی پایگاه‌داده تمرین بازیابی اجرا می‌شود، هرگز روی پایگاه‌داده برنامه */
export function isRehearsalDatabase(name: string): boolean {
  return name.startsWith(REHEARSAL_DATABASE_PREFIX);
}

async function hasColumn(db: Queryable, table: string, column: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2) AS ok`,
    [table, column],
  );
  return Boolean(r.rows[0]?.ok);
}

async function readSection(
  snapshot: RehearsalSnapshot,
  section: TotalsSection,
  read: () => Promise<Array<{ key: string; value: string; label?: string }>>,
): Promise<void> {
  try {
    for (const row of await read()) {
      snapshot.totals.set(`${section}|${row.key}`, row.value);
      if (row.label) snapshot.labels.set(`${section}|${row.key}`, row.label);
    }
    snapshot.sections.add(section);
  } catch (err: unknown) {
    snapshot.unavailable.push(`${section}: ${rehearsalErrorCause(err)}`);
  }
}

/** متن CHECK یک قید (بی «CHECK (...)» و «NOT VALID») */
export function checkExpression(definition: string): string | null {
  const m = definition.match(/^CHECK \((.*)\)( NOT VALID)?$/s);
  return m ? m[1] : null;
}

export async function snapshotBusinessData(db: Queryable): Promise<RehearsalSnapshot> {
  const snapshot: RehearsalSnapshot = {
    totals: new Map(), labels: new Map(), sections: new Set(), rowCounts: new Map(), notValid: new Map(), unavailable: [],
  };

  await readSection(snapshot, 'ledger', async () => {
    const rowsDeleted = await hasColumn(db, 'journal_voucher_items', 'is_deleted');
    const r = await db.query<{ account_id: number; code: string | null; cur: string; debit: string; credit: string }>(`
      SELECT i.account_id, a.code, COALESCE(NULLIF(i.currency, ''), NULLIF(v.currency, ''), 'IRR') AS cur,
             trim_scale(SUM(i.debit))::text AS debit, trim_scale(SUM(i.credit))::text AS credit
        FROM journal_voucher_items i
        JOIN journal_vouchers v ON v.id = i.voucher_id
        LEFT JOIN accounts a ON a.id = i.account_id
       WHERE COALESCE(v.is_deleted, 0) = 0 ${rowsDeleted ? 'AND COALESCE(i.is_deleted, 0) = 0' : ''}
       GROUP BY 1, 2, 3`);
    return r.rows.flatMap(row => {
      const label = `account ${row.code ?? row.account_id} (${row.cur})`;
      return [
        { key: `${row.account_id}|${row.cur}|debit`, value: row.debit, label: `${label} debit` },
        { key: `${row.account_id}|${row.cur}|credit`, value: row.credit, label: `${label} credit` },
      ];
    });
  });

  await readSection(snapshot, 'item', async () => {
    const r = await db.query<{ id: number; code: string | null; stock: string; wac: string }>(
      `SELECT id, code, trim_scale(COALESCE(current_stock, 0))::text AS stock, trim_scale(COALESCE(weighted_average_cost, 0))::text AS wac FROM items`,
    );
    return r.rows.flatMap(row => [
      { key: `${row.id}|stock`, value: row.stock, label: `item ${row.code ?? row.id} stock` },
      { key: `${row.id}|wac`, value: row.wac, label: `item ${row.code ?? row.id} average cost` },
    ]);
  });

  await readSection(snapshot, 'warehouse_stock', async () => {
    const r = await db.query<{ item_id: number; warehouse_id: number; item_code: string | null; wh_code: string | null; qty: string }>(`
      SELECT s.item_id, s.warehouse_id, i.code AS item_code, w.code AS wh_code, trim_scale(SUM(s.current_stock))::text AS qty
        FROM item_warehouse_stocks s
        LEFT JOIN items i ON i.id = s.item_id
        LEFT JOIN warehouses w ON w.id = s.warehouse_id
       GROUP BY 1, 2, 3, 4`);
    return r.rows.map(row => ({
      key: `${row.item_id}|${row.warehouse_id}`, value: row.qty, label: `item ${row.item_code ?? row.item_id} in warehouse ${row.wh_code ?? row.warehouse_id}`,
    }));
  });

  await readSection(snapshot, 'bank', async () => {
    const r = await db.query<{ id: number; code: string | null; balance: string }>(
      `SELECT id, code, trim_scale(COALESCE(current_balance, 0))::text AS balance FROM bank_accounts`,
    );
    return r.rows.map(row => ({ key: String(row.id), value: row.balance, label: `bank account ${row.code ?? row.id} balance` }));
  });

  try {
    const tables = await db.query<{ name: string }>(
      `SELECT format('%I', c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = current_schema() ORDER BY 1`,
    );
    for (const { name } of tables.rows) {
      const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${name}`);
      snapshot.rowCounts.set(name, Number(n.rows[0]?.n ?? 0));
    }
  } catch (err: unknown) {
    snapshot.unavailable.push(`row counts: ${rehearsalErrorCause(err)}`);
  }

  try {
    const constraints = await db.query<{ tbl: string; name: string; def: string }>(`
      SELECT format('%I', t.relname) AS tbl, c.conname AS name, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'c' AND NOT c.convalidated AND n.nspname = current_schema()
       ORDER BY 1, 2`);
    for (const c of constraints.rows) {
      const expr = checkExpression(c.def);
      if (!expr) continue;
      const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${c.tbl} WHERE (${expr}) IS FALSE`);
      const count = Number(n.rows[0]?.n ?? 0);
      if (count > 0) snapshot.notValid.set(c.name, count);
    }
  } catch (err: unknown) {
    snapshot.unavailable.push(`NOT VALID constraints: ${rehearsalErrorCause(err)}`);
  }
  return snapshot;
}

export function healthStatuses(report: FinancialHealthReport): Map<string, HealthStatus> {
  const map = new Map<string, HealthStatus>();
  for (const t of report.tests) {
    const previous = map.get(t.id);
    // چند ردیف با یک شناسه (مثلاً موجودی) : بدترین وضعیت و جمع شمار
    if (!previous || STATUS_RANK[t.status] > STATUS_RANK[previous.status]) {
      map.set(t.id, { status: t.status, count: (previous?.count ?? 0) + t.count });
    } else {
      previous.count += t.count;
    }
  }
  return map;
}

const STATUS_RANK: Record<HealthCheckStatus, number> = { healthy: 0, warning: 1, error: 2 };

export function compareRehearsal(
  before: RehearsalSnapshot,
  after: RehearsalSnapshot,
  healthBefore: Map<string, HealthStatus> | null,
  healthAfter: Map<string, HealthStatus> | null,
): RehearsalFindings {
  const problems: string[] = [];
  const notices: string[] = [];

  for (const section of before.sections) {
    if (!after.sections.has(section)) {
      problems.push(`${section}: readable before the migrations but not after`);
      continue;
    }
    const keys = new Set<string>();
    for (const key of [...before.totals.keys(), ...after.totals.keys()]) if (key.startsWith(`${section}|`)) keys.add(key);
    for (const key of [...keys].sort()) {
      const was = before.totals.get(key) ?? '0';
      const now = after.totals.get(key) ?? '0';
      // trim_scale: هر عدد یک متن یکتا دارد
      if (was !== now) {
        problems.push(`${after.labels.get(key) ?? before.labels.get(key) ?? key}: ${was} → ${now}`);
      }
    }
  }

  for (const [table, n] of before.rowCounts) {
    const now = after.rowCounts.get(table);
    if (now === undefined) notices.push(`table ${table} (${n} rows) was removed by the migrations`);
    else if (now < n) notices.push(`table ${table}: ${n} → ${now} rows`);
  }

  for (const [name, n] of after.notValid) {
    notices.push(`${n} existing row(s) break constraint ${name} (NOT VALID: kept as they were; updating such a row fails until it is corrected)`);
  }

  if (healthBefore && healthAfter) {
    for (const [id, now] of healthAfter) {
      const was = healthBefore.get(id);
      if (!was) {
        if (now.status !== 'healthy') notices.push(`health check ${id} (new): ${now.status}, ${now.count} issue(s)`);
        continue;
      }
      const worse = STATUS_RANK[now.status] > STATUS_RANK[was.status]
        || (now.status !== 'healthy' && now.status === was.status && now.count > was.count);
      if (worse) problems.push(`health check ${id}: ${was.status} (${was.count}) → ${now.status} (${now.count})`);
    }
  } else if (healthAfter) {
    for (const [id, now] of healthAfter) {
      if (now.status !== 'healthy') notices.push(`health check ${id} after the upgrade: ${now.status}, ${now.count} issue(s)`);
    }
  }

  for (const u of before.unavailable) notices.push(`not compared (before): ${u}`);
  for (const u of after.unavailable) notices.push(`not compared (after): ${u}`);
  return { problems, notices };
}

const FAILED_QUERY = /^Failed query:/;
const CAUSE_MAX_LENGTH = 300;

/**
 * v10.0.14 (TD-1000, owner rule t9): the reason a rehearsal step could not run, for the terminal. A Drizzle error
 * carries the whole SQL text (with Persian literals) in its message, so the database's own cause is taken instead;
 * an older schema missing a table the current code reads says so. Persian runs become an English marker.
 */
export function rehearsalErrorCause(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error && FAILED_QUERY.test(current.message) && current.cause; depth++) {
    current = current.cause;
  }
  const message = current instanceof Error ? current.message : String(current);
  const code = (current as { code?: unknown } | null)?.code;
  const text = FAILED_QUERY.test(message)
    ? 'a database query failed'
    : code === '42P01' || code === '42703'
      ? `${message} (the schema before the migrations lacks what the current code reads)`
      : message;
  const firstLine = terminalLine(text.split('\n')[0] ?? '');
  return firstLine.length > CAUSE_MAX_LENGTH ? `${firstLine.slice(0, CAUSE_MAX_LENGTH)}…` : firstLine;
}
