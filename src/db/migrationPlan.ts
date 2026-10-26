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

/**
 * v11 (phase 4.1): migrations folded into a baseline file. The baseline's journal `when` equals the newest folded
 * migration's, so the Drizzle migrator skips it on a database that ran them all.
 */
export interface SquashedMigrationHistory {
  /** the journal tag of the baseline file that replaces them */
  baselineTag: string;
  /** the last application version that carried the folded migrations, named in the refusal */
  lastVersion: string;
  /** tag, journal `when`, then the released sha256 and the earlier hashes of an amended text */
  migrations: ReadonlyArray<readonly [tag: string, when: number, hashes: readonly string[]]>;
}

/**
 * v11 (phase 4.1): turns the rows of the folded migrations into one row of the baseline. A database that ran every
 * folded migration has the baseline; one that ran only some of them (an install older than `lastVersion`) is refused,
 * since this build no longer carries the migrations it lacks and the baseline would run on its existing tables. The
 * baseline's own row (a database installed from it) shares the newest folded `when`: it is the row at that `when` with
 * the baseline's hash, or with another hash that is not the newest folded migration's when no other folded migration ran
 * (a baseline amended after release, or its text read with other line endings, still marks the database as installed
 * from it).
 */
export function foldSquashedHistory(
  entries: MigrationJournalEntry[],
  applied: AppliedMigrationRow[],
  history: SquashedMigrationHistory,
): { applied: AppliedMigrationRow[]; errors: string[]; warnings: string[] } {
  const baseline = entries.find(e => e.tag === history.baselineTag);
  const folded = new Map(history.migrations.map(([tag, when, hashes]) => [when, { tag, hashes }]));
  const ranFolded = applied.some(r => folded.has(r.createdAt) && r.createdAt !== baseline?.when);
  const newestFoldedHashes = baseline ? folded.get(baseline.when)?.hashes ?? [] : [];
  const isBaselineRow = (r: AppliedMigrationRow) => baseline !== undefined && r.createdAt === baseline.when
    && (r.hash === baseline.hash || (!ranFolded && !newestFoldedHashes.includes(r.hash)));
  const old = applied.filter(r => folded.has(r.createdAt) && !isBaselineRow(r));
  if (old.length === 0 || !baseline) return { applied, errors: [], warnings: [] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const present = new Set(old.map(r => r.createdAt));
  const missing = history.migrations.filter(([, when]) => !present.has(when));
  if (missing.length > 0) {
    errors.push(`this database ran ${old.length} of the ${history.migrations.length} migrations that ${history.baselineTag} replaces (the first missing one is ${missing[0][0]}): it belongs to a version older than ${history.lastVersion}, and this build no longer carries those migrations. Update to the latest ${history.lastVersion}.x first, then to this version`);
  }
  for (const r of old) {
    const m = folded.get(r.createdAt)!;
    if (!m.hashes.includes(r.hash)) warnings.push(`migration ${m.tag} changed after it was applied to this database (hash differs); the database keeps the version that ran`);
  }
  const rest = applied.filter(r => !folded.has(r.createdAt) || isBaselineRow(r));
  return { applied: [...rest, { hash: baseline.hash, createdAt: baseline.when }], errors, warnings };
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
 * `squashed` (v11، فاز ۴.۱): مهاجرت‌هایی که در فایل پایه جمع شده‌اند (`foldSquashedHistory`).
 */
export function planMigrations(
  entries: MigrationJournalEntry[],
  appliedRows: AppliedMigrationRow[],
  previousHashes: ReadonlyMap<string, readonly string[]> = new Map(),
  squashed?: SquashedMigrationHistory,
): MigrationPlan {
  const fold = squashed ? foldSquashedHistory(entries, appliedRows, squashed) : { applied: appliedRows, errors: [], warnings: [] };
  const applied = fold.applied;
  const errors = [...validateMigrationJournal(entries), ...fold.errors];
  const warnings: string[] = [...fold.warnings];
  if (fold.errors.length > 0) return { pending: [], errors, warnings };
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
