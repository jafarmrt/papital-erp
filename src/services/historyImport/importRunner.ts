import { orm, type DbExecutor } from '../../db/drizzle.js';
import { AppError } from '../../errors/customErrors.js';
import { withDryRunNumbering } from '../../lib/dryRunNumbering.js';
import { logger } from '../../middleware/logger.js';

/**
 * v11 history import: the one way an Excel import touches the books. Everything runs in one transaction; each row in a
 * savepoint of it, so a refused row is undone alone and the next rows are still tried (the preview lists every problem at
 * once). A preview (`commit: false`) and a post with any refused row roll the whole transaction back, so a preview keeps
 * nothing and a post keeps all rows or none. Inside a preview the voucher and
 * treasury numbers are placeholders (`withDryRunNumbering`), so a preview leaves no gap in their sequences.
 */

export type RowAttempt = <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; message: string }>;

class ImportRollback extends Error {
  constructor() {
    super('history import rolled back');
  }
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
 * `commit` is set and it did.
 */
export async function runImportRows(
  options: { commit: boolean },
  body: (tx: DbExecutor, attempt: RowAttempt) => Promise<boolean>,
): Promise<void> {
  const run = () => orm.transaction(async (tx) => {
    const attempt: RowAttempt = async (fn) => {
      try {
        const value = await tx.transaction(sp => fn(sp));
        return { ok: true, value };
      } catch (err) {
        return { ok: false, message: rowFailureMessage(err) };
      }
    };
    const allOk = await body(tx, attempt);
    if (!options.commit || !allOk) throw new ImportRollback();
  });
  try {
    await (options.commit ? run() : withDryRunNumbering(run));
  } catch (err) {
    if (!(err instanceof ImportRollback)) throw err;
  }
}
