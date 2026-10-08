/**
 * v9.0.394 (TD-590, B01-10): finds the places in a migration that name a schema object without its schema and so act on
 * whatever the search path finds first. An isolated test schema runs the migrations with the search path
 * `"<test schema>", public`, so such a statement reached the object of the same name in `public`.
 *
 * - `drop`: `DROP INDEX | TABLE | FUNCTION | VIEW | MATERIALIZED VIEW | SEQUENCE | TYPE ... IF EXISTS <name>` with a name
 *   that has no schema. A table-scoped drop (`DROP TRIGGER ... ON t`, `ALTER TABLE t DROP CONSTRAINT`) acts on the
 *   table the migration just found in its own schema and is not counted. The migration names the current schema
 *   instead: `EXECUTE format('DROP INDEX IF EXISTS %I.<name>', current_schema())`.
 */

export type UnqualifiedLookupKind = 'drop';

export interface UnqualifiedLookup {
  kind: UnqualifiedLookupKind;
  /** 1-based line of the statement */
  line: number;
  /** The object name as written */
  object: string;
  /** The matched text */
  text: string;
}

/** SQL without `--` comments, keeping line breaks so line numbers stay */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function lineOf(sql: string, index: number): number {
  return sql.slice(0, index).split('\n').length;
}

const DROP_IF_EXISTS = /\bDROP\s+(?:MATERIALIZED\s+VIEW|INDEX(?:\s+CONCURRENTLY)?|TABLE|FUNCTION|VIEW|SEQUENCE|TYPE)\s+IF\s+EXISTS\s+([%\w."]+)/gi;

/** Statements of one migration that act on an object by a name without its schema */
export function unqualifiedMigrationLookups(source: string): UnqualifiedLookup[] {
  const sql = withoutComments(source);
  const found: UnqualifiedLookup[] = [];
  for (const m of sql.matchAll(DROP_IF_EXISTS)) {
    const object = m[1];
    if (object.includes('.')) continue;
    found.push({ kind: 'drop', line: lineOf(sql, m.index ?? 0), object, text: m[0].replace(/\s+/g, ' ') });
  }
  return found.sort((a, b) => a.line - b.line);
}
