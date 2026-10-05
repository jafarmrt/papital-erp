import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';
import { getErrorMessage } from '../../utils/formatters.js';

/**
 * v8.0.67 — ابزار سناریوهای همزمانی حوزه J: عملیات‌ها پشت قفل یک تراکنش نگه‌دارنده صف می‌کشند و با هم آزاد می‌شوند،
 * تا هم‌زمانی واقعی و تکرارپذیر باشد.
 */

const WAIT_DEADLINE_MS = 10000;

/** بن‌بست PostgreSQL (40P01)، در خطای خام یا در زنجیره cause خطای نگاشت‌شده */
export function isDeadlock(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === '40P01' || (typeof e.message === 'string' && e.message.includes('deadlock detected'))) return true;
    cur = e.cause;
  }
  return false;
}

/** شمار نشست‌هایی که مستقیم یا پشت سر نشست دیگری منتظر قفل‌های نشست holderPid هستند */
async function waitersBehind(holderPid: number): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `WITH RECURSIVE w(pid) AS (
       SELECT $1::int
       UNION
       SELECT a.pid FROM pg_stat_activity a JOIN w ON w.pid = ANY(pg_blocking_pids(a.pid))
     ) SELECT (count(*) - 1)::int AS n FROM w`, [holderPid]);
  return res.rows[0]?.n ?? 0;
}

/** تا همه عملیات‌ها پشت قفل برسند (یا پیش از آن تمام شوند) صبر می‌کند؛ پس از مهلت بی‌خطا ادامه می‌دهد */
export async function untilQueued(holderPid: number, expected: number, settled: () => number): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if ((await waitersBehind(holderPid)) + settled() >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** جدول‌هایی که سناریوها ردیفشان را نگه می‌دارند (نام ثابت، نه ورودی) */
type LockedTable = 'items' | 'journal_vouchers' | 'cheques' | 'bank_accounts' | 'purchase_requisitions' | 'production_projects' | 'piecework_logs' | 'workflow_instances';

/**
 * ردیف‌های داده‌شده را در یک تراکنش جدا FOR UPDATE نگه می‌دارد، عملیات‌ها را شروع می‌کند، تا همه پشت قفل صف بکشند
 * (یا پیش از آن تمام شوند) صبر می‌کند و سپس قفل را رها می‌کند تا همه با هم ادامه دهند. با `staggered` هر عملیات پس از
 * صف کشیدن عملیات پیشین شروع می‌شود، پس ترتیب صف (و ترتیب ادامه پس از رها شدن قفل) همان ترتیب فهرست است.
 */
export async function raceBehindRowLock<T>(
  table: LockedTable, ids: number[], ops: Array<() => Promise<T>>, options: { staggered?: boolean } = {}
): Promise<PromiseSettledResult<T>[]> {
  const holder = await pool.connect();
  let open = false;
  try {
    await holder.query('BEGIN');
    open = true;
    await holder.query(`SELECT id FROM ${table} WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids]);
    const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let done = 0;
    const running: Array<Promise<T>> = [];
    for (const op of ops) {
      const run = op().finally(() => { done++; });
      run.catch(() => undefined); // نتیجه را allSettled می‌خواند؛ رد زودهنگام در حالت staggered «بی‌گرداننده» نشود
      running.push(run);
      if (options.staggered) await untilQueued(pid, running.length, () => done);
    }
    const all = Promise.allSettled(running);
    await untilQueued(pid, ops.length, () => done);
    await holder.query('COMMIT');
    open = false;
    return await all;
  } finally {
    if (open) await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
}

/** خلاصه نتیجه عملیات‌های هم‌زمان: بن‌بست‌ها و خطاهای دیگر با برچسب هر عملیات */
export function outcomeProblems(labels: string[], outcomes: PromiseSettledResult<unknown>[], allowed: (label: string, message: string) => boolean): string[] {
  const problems: string[] = [];
  const deadlocks = outcomes.filter(o => o.status === 'rejected' && isDeadlock(o.reason)).length;
  if (deadlocks > 0) problems.push(`${deadlocks} عملیات از ${outcomes.length} با بن‌بست (40P01) شکست خورد`);
  outcomes.forEach((o, i) => {
    if (o.status !== 'rejected' || isDeadlock(o.reason)) return;
    const message = getErrorMessage(o.reason);
    if (!allowed(labels[i], message)) problems.push(`${labels[i]} رد شد: ${message.slice(0, 160)}`);
  });
  return problems;
}

export async function accountIdByCode(code: string): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, code), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error(`حساب ${code} در کدینگ آزمون نیست`);
  return row.id;
}
