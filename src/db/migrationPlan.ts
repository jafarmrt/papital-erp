/**
 * v8.0.81 (TD-364): پیش از اجرای مهاجرت‌ها، دفتر مهاجرت کد (`drizzle/meta/_journal.json`) با دفتر پایگاه‌داده
 * (`__drizzle_migrations`) مقایسه می‌شود.
 *
 * مهاجرت‌گر Drizzle فقط مهاجرتی را اجرا می‌کند که `when` آن از `created_at` آخرین مهاجرت اجراشده بزرگ‌تر باشد و
 * نام یا درهم‌سازی را نمی‌سنجد. پس مهاجرت تازه‌ای که `when` کوچک‌تری بگیرد (مثلاً با ساعت `drizzle-kit generate`،
 * که از `when` ساختگیِ آینده‌ی دفتر عقب است، یا ادغام دو شاخه) روی پایگاه‌داده تازه آزمون‌ها اجرا و روی پایگاه‌داده
 * پروداکشن بی‌صدا رد می‌شد. این ماژول خالص است (بی پایگاه‌داده) تا با Vitest آزموده شود.
 */

export interface MigrationJournalEntry {
  idx: number;
  tag: string;
  when: number;
  /** sha256 محتوای فایل، همان چیزی که Drizzle در `__drizzle_migrations.hash` می‌نویسد */
  hash: string;
}

export interface AppliedMigrationRow {
  hash: string;
  createdAt: number;
}

export interface MigrationPlan {
  /** مهاجرت‌هایی که این اجرا اعمال می‌کند */
  pending: string[];
  /** خطاهایی که اجرا را متوقف می‌کنند */
  errors: string[];
  /** ناهمخوانی‌هایی که فقط گزارش می‌شوند */
  warnings: string[];
}

/** دفتر مهاجرت کد: `when` اکیداً صعودی، شماره‌ها پشت سر هم و پیشوند نام فایل برابر شماره */
export function validateMigrationJournal(entries: MigrationJournalEntry[]): string[] {
  const errors: string[] = [];
  entries.forEach((e, i) => {
    if (e.idx !== i) errors.push(`journal entry ${i} has idx ${e.idx}`);
    const prefix = e.tag.match(/^(\d{4})_/)?.[1];
    if (prefix === undefined || Number(prefix) !== e.idx) errors.push(`journal entry ${e.idx}: tag ${e.tag} does not start with ${String(e.idx).padStart(4, '0')}_`);
    if (i > 0 && !(e.when > entries[i - 1].when)) {
      errors.push(`migration ${e.tag}: "when" ${e.when} is not greater than ${entries[i - 1].tag} (${entries[i - 1].when}); the migrator would skip it on every database that already applied ${entries[i - 1].tag}`);
    }
  });
  return errors;
}

/**
 * `previousHashes`: برای مهاجرت‌هایی که پس از انتشار عمداً عوض شده‌اند (`src/db/migrationAmendments.ts`)، درهم‌سازی
 * متن‌های قبلی؛ پایگاه‌داده‌ای که یکی از آن‌ها را اجرا کرده هشدار «فایل عوض شده» نمی‌گیرد.
 */
export function planMigrations(
  entries: MigrationJournalEntry[],
  applied: AppliedMigrationRow[],
  previousHashes: ReadonlyMap<string, readonly string[]> = new Map(),
): MigrationPlan {
  const errors = validateMigrationJournal(entries);
  const warnings: string[] = [];
  if (applied.length === 0) {
    return { pending: entries.map(e => e.tag), errors, warnings };
  }
  const lastApplied = Math.max(...applied.map(r => r.createdAt));
  const appliedByWhen = new Map<number, AppliedMigrationRow>();
  for (const row of applied) appliedByWhen.set(row.createdAt, row);
  const knownWhen = new Set(entries.map(e => e.when));
  const newestKnown = entries.length > 0 ? entries[entries.length - 1].when : 0;

  for (const e of entries) {
    if (e.when > lastApplied) continue;
    const row = appliedByWhen.get(e.when);
    if (!row) {
      errors.push(`migration ${e.tag} was never applied to this database but is older than its last applied migration; the migrator would skip it silently`);
    } else if (row.hash !== e.hash && !(previousHashes.get(e.tag) ?? []).includes(row.hash)) {
      warnings.push(`migration ${e.tag} changed after it was applied to this database (hash differs); the database keeps the version that ran`);
    }
  }
  const unknown = applied.filter(r => !knownWhen.has(r.createdAt));
  if (lastApplied > newestKnown) {
    errors.push(`the database has ${unknown.filter(r => r.createdAt > newestKnown).length} applied migration(s) newer than this build knows; it belongs to a newer version of the application (restore the backup taken before that update, or deploy that version)`);
  }
  const unknownOlder = unknown.filter(r => r.createdAt <= newestKnown);
  if (unknownOlder.length > 0) {
    warnings.push(`${unknownOlder.length} applied migration(s) in the database are not in this build's journal (created_at ${unknownOlder.map(r => r.createdAt).join(', ')})`);
  }
  return { pending: entries.filter(e => e.when > lastApplied).map(e => e.tag), errors, warnings };
}
