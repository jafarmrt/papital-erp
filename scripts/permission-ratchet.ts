import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { PERMISSION_KEYS, SYSTEM_ADMIN_ROLE } from '../src/lib/permissions/permissionCatalog';

/**
 * v9.0.83 (TD-881; permission model §4.5): static ratchets over every production source file in `src`
 * (tests and changelog data excluded), read with the TypeScript parser so comments never count.
 *
 *   npm run ratchet:permissions              check against permission-ratchet-baseline.json
 *   npm run ratchet:permissions -- --update  write the current (lower) counts; the baseline may only shrink
 *
 * 1. Role codes: string literals equal to a role code, per file. Only `SYSTEM_ADMIN_ROLE` in the permission catalog is
 *    allowed; every other occurrence is debt (TD-516 and the model PRs) and no file may gain one.
 * 2. Permission catalog: every literal shaped like a permission key (`<catalog group>.<action>`) is a catalog key, and
 *    every catalog key is checked somewhere in server code. Known exceptions live in the baseline and may only shrink.
 */

export const BASELINE_FILE = 'permission-ratchet-baseline.json';

/**
 * Role codes the code base has used (seed roles, role templates, workflow equivalence, notifications). The words
 * `warehouse`, `accounting`, `sales` and `production` are left out: they are also query keys, voucher types and
 * NODE_ENV values, and the workflow table that uses them as role codes also uses counted codes.
 */
export const ROLE_CODES: readonly string[] = [
  'admin', 'manager', 'viewer', 'cfo_accountant', 'warehouse_keeper', 'accountant', 'production_manager', 'treasurer',
  'sales_manager', 'inventory_auditor', 'daily_logger', 'procurement_officer', 'sales_agent', 'workshop_operator', 'super_admin',
];

/** The one file allowed to spell the system admin role */
export const CATALOG_FILE = 'src/lib/permissions/permissionCatalog.ts';

/** Literals shaped like permission keys that are something else: domain event types and table.column references */
export const NOT_PERMISSION_LITERALS: readonly string[] = [
  'inventory.stock_in', 'inventory.stock_out', 'inventory.stock_alert', 'inventory.transfer',
  'workflow.state_changed', 'workflow.signature_added', 'workflow.task_assigned', 'workflow.delegated',
  'customers.id', 'personnel.id', 'documents.id', 'users.password',
];

/** Server code: a key appearing here (outside the catalog itself and the seed data) is checked by the server */
const SERVER_PATH = /^src\/(routes|services|middleware|lib|db|server\.ts|app\.ts)/;
const NOT_A_CHECK = new Set([CATALOG_FILE, 'src/db/seed.ts']);

export interface SourceLiteral {
  file: string;
  text: string;
  /** `SYSTEM_ADMIN_ROLE = 'admin'` in the catalog file */
  isSystemAdminConstant: boolean;
}

export interface PermissionBaseline {
  roleCodeLiteralsByFile: Record<string, number>;
  uncataloguedPermissionKeys: string[];
  uncheckedCatalogKeys: string[];
}

export function literalsOfSource(file: string, source: string): SourceLiteral[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const out: SourceLiteral[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isSystemAdminConstant = file === CATALOG_FILE && ts.isVariableDeclaration(parent)
        && ts.isIdentifier(parent.name) && parent.name.text === 'SYSTEM_ADMIN_ROLE' && node.text === SYSTEM_ADMIN_ROLE;
      out.push({ file, text: node.text, isSystemAdminConstant });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function productionSourceFiles(root = process.cwd()): string[] {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (child === 'src/tests' || child === 'src/data/changelogs') continue;
        walk(child);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(child);
      }
    }
  };
  walk('src');
  return files.sort();
}

export function scanLiterals(root = process.cwd()): SourceLiteral[] {
  return productionSourceFiles(root).flatMap(file => literalsOfSource(file, fs.readFileSync(path.join(root, file), 'utf8')));
}

export function countRoleCodeLiterals(literals: readonly SourceLiteral[]): Record<string, number> {
  const codes = new Set(ROLE_CODES);
  const counts: Record<string, number> = {};
  for (const l of literals) {
    if (!codes.has(l.text) || l.isSystemAdminConstant) continue;
    counts[l.file] = (counts[l.file] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const PERMISSION_SHAPE = /^([a-z_]+)\.([a-z_]+)$/;

/** Permission-shaped literals outside the catalog, and catalog keys no server code checks */
export function catalogUsage(literals: readonly SourceLiteral[], catalogKeys: readonly string[] = PERMISSION_KEYS): { uncatalogued: string[]; unchecked: string[] } {
  const keys = new Set(catalogKeys);
  const groups = new Set([...catalogKeys.map(k => k.split('.')[0]), 'payroll']);
  const notPermissions = new Set(NOT_PERMISSION_LITERALS);
  const uncatalogued = new Set<string>();
  const checked = new Set<string>();
  for (const l of literals) {
    const m = PERMISSION_SHAPE.exec(l.text);
    if (!m || !groups.has(m[1]) || notPermissions.has(l.text)) continue;
    if (!keys.has(l.text)) uncatalogued.add(l.text);
    else if (SERVER_PATH.test(l.file) && !NOT_A_CHECK.has(l.file)) checked.add(l.text);
  }
  return {
    uncatalogued: [...uncatalogued].sort(),
    unchecked: catalogKeys.filter(k => !checked.has(k)).sort(),
  };
}

export interface RatchetReport {
  errors: string[];
  stale: string[];
}

/** Grown counts and new exceptions are errors; shrunk counts and gone exceptions are a stale baseline to lower */
export function compareWithBaseline(current: PermissionBaseline, baseline: PermissionBaseline): RatchetReport {
  const errors: string[] = [];
  const stale: string[] = [];
  const files = new Set([...Object.keys(current.roleCodeLiteralsByFile), ...Object.keys(baseline.roleCodeLiteralsByFile)]);
  for (const file of [...files].sort()) {
    const c = current.roleCodeLiteralsByFile[file] ?? 0;
    const b = baseline.roleCodeLiteralsByFile[file] ?? 0;
    if (c > b) errors.push(`${file}: role code literals ${b} -> ${c}; ask a permission key instead (only SYSTEM_ADMIN_ROLE names a role)`);
    else if (c < b) stale.push(`${file}: role code literals ${b} -> ${c}`);
  }
  const lists: Array<[keyof PermissionBaseline, string]> = [
    ['uncataloguedPermissionKeys', 'is checked but missing from the permission catalog'],
    ['uncheckedCatalogKeys', 'is in the permission catalog but no server code checks it'],
  ];
  for (const [name, problem] of lists) {
    const now = current[name] as string[];
    const before = new Set(baseline[name] as string[]);
    for (const k of now) if (!before.has(k)) errors.push(`${k} ${problem}`);
    for (const k of before) if (!now.includes(k)) stale.push(`${k}: the exception is no longer needed (remove it from ${name})`);
  }
  return { errors, stale };
}

export function currentState(root = process.cwd()): PermissionBaseline {
  const literals = scanLiterals(root);
  const usage = catalogUsage(literals);
  return {
    roleCodeLiteralsByFile: countRoleCodeLiterals(literals),
    uncataloguedPermissionKeys: usage.uncatalogued,
    uncheckedCatalogKeys: usage.unchecked,
  };
}

function main(): void {
  const update = process.argv.includes('--update');
  const baselinePath = path.resolve(process.cwd(), BASELINE_FILE);
  const current = currentState();
  const baseline: PermissionBaseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const { errors, stale } = compareWithBaseline(current, baseline);
  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL ${e}`);
    console.error('The permission ratchet baseline may only shrink; fix the new occurrences instead of raising it.');
    process.exit(1);
  }
  const total = Object.values(current.roleCodeLiteralsByFile).reduce((a, b) => a + b, 0);
  if (update) {
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(`Permission ratchet baseline updated: ${total} role code literals in ${Object.keys(current.roleCodeLiteralsByFile).length} files`);
    return;
  }
  if (stale.length > 0) {
    for (const s of stale) console.error(`LOWER ${s}`);
    console.error('Debt went down; run `npm run ratchet:permissions -- --update` and commit permission-ratchet-baseline.json.');
    process.exit(1);
  }
  console.log(`Permission ratchet OK: ${total} role code literals in ${Object.keys(current.roleCodeLiteralsByFile).length} files`);
}

if (process.argv[1]?.endsWith('permission-ratchet.ts') || process.argv[1]?.endsWith('permission-ratchet.js')) {
  main();
}
