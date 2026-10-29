import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { AppError } from '../../errors/customErrors.js';
import { withDryRunNumbering } from '../../lib/dryRunNumbering.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';
import { logger } from '../../middleware/logger.js';

/**
 * v11 history import: the one way an Excel import touches the books. Everything runs in one transaction; each row in a
 * savepoint of it, so a refused row is undone alone and the next rows are still tried (the preview lists every problem at
 * once). A preview (`commit: false`) and a post with any refused row roll the whole transaction back, so a preview keeps
 * nothing and a post keeps all rows or none. Inside a preview the voucher and
 * treasury numbers are placeholders (`withDryRunNumbering`), so a preview leaves no gap in their sequences, and a post is
 * tried as a preview first.
 */

export type RowAttempt = <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; message: string }>;

class ImportRollback extends Error {
  constructor(readonly allOk: boolean) {
    super('history import rolled back');
  }
}

const HISTORY_IMPORT_LOCK = 'papital.history_import';

/** One history import step at a time (an import, a preview, taking back old openings): a second one waits for the first. */
export async function lockHistoryImport(tx: DbExecutor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${HISTORY_IMPORT_LOCK}))`);
}

export const UNEXPECTED_ROW_MESSAGE = 'این ردیف با خطای پیش‌بینی‌نشده‌ای روبه‌رو شد و ثبت نمی‌شود؛ آن را با دست ثبت کنید یا به پشتیبانی خبر دهید.';

/** The message of a refused row: a business refusal says why in Persian; anything else is logged and named as unexpected. */
export function rowFailureMessage(err: unknown): string {
  if (err instanceof AppError && err.statusCode < 500) return err.message;
  logger.error('history import: unexpected row failure', { error: err instanceof Error ? err.message : String(err) });
  return UNEXPECTED_ROW_MESSAGE;
}

/**
 * Runs `body` in one transaction. `body` returns whether every row went through; the transaction commits only when
 * `commit` is set and it did. A post first runs as a preview: only when every row goes through with placeholder numbers
 * does it run again with real ones and commit, so a refused post takes no voucher or treasury number either (a rolled-back
 * `nextval` is not given back). `body` must be safe to run twice (it reads the books again each time).
 */
export async function runImportRows(
  options: { commit: boolean },
  body: (tx: DbExecutor, attempt: RowAttempt) => Promise<boolean>,
): Promise<void> {
  // the preview pass never completes the request's Idempotency-Key; the post pass completes it in its own commit
  const inTransaction = (commit: boolean, fn: (tx: DbExecutor) => Promise<void>) => (commit ? idempotentTransaction(fn) : orm.transaction(fn));
  const run = (commit: boolean) => inTransaction(commit, async (tx) => {
    // one import at a time: a second one (a resend, another month) waits and then reads what the first one posted
    await lockHistoryImport(tx);
    const attempt: RowAttempt = async (fn) => {
      try {
        const value = await tx.transaction(sp => fn(sp));
        return { ok: true, value };
      } catch (err) {
        return { ok: false, message: rowFailureMessage(err) };
      }
    };
    const allOk = await body(tx, attempt);
    if (!commit || !allOk) throw new ImportRollback(allOk);
  });
  try {
    await withDryRunNumbering(() => run(false));
  } catch (err) {
    if (!(err instanceof ImportRollback)) throw err;
    if (!options.commit || !err.allOk) return;
  }
  try {
    await run(true);
  } catch (err) {
    if (!(err instanceof ImportRollback)) throw err;
  }
}
