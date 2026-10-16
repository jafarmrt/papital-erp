import ts from 'typescript';

/**
 * TD-1266 (10.0 closing test finding): a catalog read in TypeScript code (a test, a health check, a tool) restricts its own
 * schema, as a migration's check does (TD-610, `migrationSchemaQualification.ts`). The catalogs hold every schema of the
 * database, so a test that looked up `uq_items_code_active` or `chk_documents_status` by name alone counted the same name in
 * a stale `test_*` schema left in the local test database and failed (TD-653 and TD-786 tests in the 10.0 closing run).
 *
 * A SQL text (string or template literal) that reads `pg_constraint`, `pg_indexes`, `pg_class`, `pg_trigger`, `pg_proc`,
 * `pg_type`, `pg_tables`, `pg_views`, `pg_sequences`, `pg_matviews` or `information_schema.*` passes when the same text
 * names the schema: `current_schema()`, a `regnamespace` or `regclass` cast or `to_regclass(...)` (which resolve along the
 * search path to the one table the code means), or a schema column (`schemaname`, `table_schema`, `nspname`,
 * `relnamespace`, `connamespace`, ...).
 */

export interface UnscopedCatalogRead {
  /** 1-based line of the literal */
  line: number;
  catalog: string;
  text: string;
}

const CATALOG_READ = /\b(?:FROM|JOIN)\s+((?:pg_catalog\.)?pg_(?:constraint|indexes|class|trigger|proc|type|tables|views|sequences|matviews)\b|information_schema\.\w+)/gi;
const SCHEMA_SCOPE = /current_schema|regnamespace|regclass|\bschemaname\b|\b(?:table|constraint|sequence|routine|trigger|specific|udt)_schema\b|\bnspname\b|\b(?:rel|con|pro|typ)namespace\b/i;

/** The SQL text of a string or template literal, with `${…}` for each substitution */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => '${…}' + span.literal.text).join('');
  return null;
}

/** The catalog reads of one TypeScript source whose SQL text does not restrict the schema */
export function unscopedCatalogReads(fileName: string, source: string): UnscopedCatalogRead[] {
  if (!/pg_|information_schema/.test(source)) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: UnscopedCatalogRead[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text === null) {
      ts.forEachChild(node, visit);
      return;
    }
    if (SCHEMA_SCOPE.test(text)) return;
    for (const m of text.matchAll(CATALOG_READ)) {
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        catalog: m[1],
        text: text.replace(/\s+/g, ' ').trim().slice(0, 160),
      });
    }
  };
  visit(file);
  return found;
}

/**
 * OT-B-09: `to_regclass('<name>')` with a bare name resolves along the search path, so in an isolated test schema
 * (`search_path "test_x", public`) an index missing there was found in `public`. A lookup in the services names the
 * current schema as the migrations do (TD-610): `to_regclass(format('%I.%I', current_schema(), <name>))`.
 */
const BARE_REGCLASS = /to_regclass\(\s*(?!format\(\s*'%I\.%I'\s*,\s*current_schema\(\))/gi;

/** The `to_regclass(...)` lookups of one TypeScript source that do not name the current schema */
export function unqualifiedRegclassLookups(fileName: string, source: string): UnscopedCatalogRead[] {
  if (!source.includes('to_regclass')) return [];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: UnscopedCatalogRead[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    // a template's substitutions may hold SQL of their own (`sql.join(... sql\`to_regclass(...)\` ...)`)
    ts.forEachChild(node, visit);
    if (text === null) return;
    for (const m of text.matchAll(BARE_REGCLASS)) {
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        catalog: 'to_regclass',
        text: text.slice(m.index ?? 0).replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    }
  };
  visit(file);
  return found;
}
