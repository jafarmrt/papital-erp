/**
 * v9.0.394 (TD-590, B01-10): finds the places in a migration that name a schema object without its schema and so act on
 * whatever the search path finds first. An isolated test schema runs the migrations with the search path
 * `"<test schema>", public`, so such a statement reached the object of the same name in `public`.
 *
 * - `drop`: `DROP INDEX | TABLE | FUNCTION | VIEW | MATERIALIZED VIEW | SEQUENCE | TYPE ... IF EXISTS <name>` with a name
 *   that has no schema. A table-scoped drop (`DROP TRIGGER ... ON t`, `ALTER TABLE t DROP CONSTRAINT`) acts on the
 *   table the migration just found in its own schema and is not counted. The migration names the current schema
 *   instead: `EXECUTE format('DROP INDEX IF EXISTS %I.<name>', current_schema())`.
 * - `catalog` (v9.0.395, TD-610, B01-30): an existence check on a catalog (`pg_constraint`, `pg_indexes`, `pg_class`,
 *   `pg_trigger`, `pg_proc`, `pg_type`, `pg_tables`, `pg_views`, `pg_sequences`, `information_schema.*`) that does not
 *   restrict the schema. The catalogs hold every schema, so a constraint, index or trigger of the same name in `public`
 *   or in another test schema made the migration skip it: a test schema built beside a migrated one lacked 30
 *   constraints and indexes, among them `chk_iws_current_stock_non_negative`. The check restricts its own schema
 *   column (`connamespace = current_schema()::regnamespace`, `schemaname = current_schema()`, ...) or the table
 *   (`conrelid = '<table>'::regclass`, `tgrelid = '<table>'::regclass`).
 * - `regclass` (v9.0.395, TD-610): `to_regclass('<bare name>') IS [NOT] NULL` looks the name up along the search path and
 *   finds the index in `public`; the check names the current schema
 *   (`to_regclass(format('%I.%I', current_schema(), '<name>'))`).
 */

export type UnqualifiedLookupKind = 'drop' | 'catalog' | 'regclass';

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

/** What restricts each catalog to one schema (its schema column, or the table it belongs to) */
const CATALOG_QUALIFIERS: ReadonlyArray<[catalog: RegExp, qualifier: RegExp]> = [
  [/pg_constraint/i, /\b(connamespace|conrelid)\b/i],
  [/pg_indexes/i, /\bschemaname\b/i],
  [/pg_class/i, /\brelnamespace\b/i],
  [/pg_trigger/i, /\btgrelid\b/i],
  [/pg_proc/i, /\bpronamespace\b/i],
  [/pg_type/i, /\btypnamespace\b/i],
  [/pg_(tables|views|sequences|matviews)/i, /\bschemaname\b/i],
  [/information_schema\.\w+/i, /\b(table|constraint|sequence|routine|trigger|specific)_schema\b/i],
];

const CATALOG_LOOKUP = /\bFROM\s+((?:pg_catalog\.)?pg_(?:constraint|indexes|class|trigger|proc|type|tables|views|sequences|matviews)\b|information_schema\.\w+)/gi;

/** The lookup's own condition: from the catalog name to the end of its IF / LOOP condition or statement */
function lookupWindow(sql: string, from: number): string {
  const rest = sql.slice(from);
  const end = rest.search(/\bTHEN\b|\bLOOP\b|;/i);
  return end < 0 ? rest : rest.slice(0, end);
}

const REGCLASS_EXISTENCE = /\bto_regclass\(\s*'([^'.]+)'\s*\)\s+IS\s+(?:NOT\s+)?NULL/gi;

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
  for (const m of sql.matchAll(CATALOG_LOOKUP)) {
    const catalog = m[1];
    const qualifier = CATALOG_QUALIFIERS.find(([c]) => c.test(catalog))?.[1];
    const window = lookupWindow(sql, m.index ?? 0);
    if (qualifier && qualifier.test(window)) continue;
    found.push({ kind: 'catalog', line: lineOf(sql, m.index ?? 0), object: catalog, text: window.replace(/\s+/g, ' ').trim().slice(0, 160) });
  }
  for (const m of sql.matchAll(REGCLASS_EXISTENCE)) {
    found.push({ kind: 'regclass', line: lineOf(sql, m.index ?? 0), object: m[1], text: m[0].replace(/\s+/g, ' ') });
  }
  return found.sort((a, b) => a.line - b.line);
}
