import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { productionSourceFiles } from '../permission-ratchet';

/**
 * Series 10 roadmap §4, phase-2 decision t3 A (OBS-R2-02): the package boundary of server code, read from
 * scripts/ratchets/PACKAGE_MAP.txt without moving any file. Counted per importing file, against the
 * `packageBoundary` part of scripts/ratchets/architecture-baseline.json; it may only shrink.
 *
 * Direction (v9/reviews/ARCHITECTURE.md §5.1): transactional domains (7 to 13, 15) may import workflow (14), the cores
 * (3 accounting, 4 treasury, 5 items, 6 warehouse) and infrastructure (1, 2, 16); workflow may import the cores and
 * infrastructure; the cores only infrastructure. Every other import of another package is counted: a core importing a
 * consumer, workflow importing a domain listener, two domains of one layer importing each other (infrastructure packages
 * may import each other). The composition roots (`app.ts`, `server.ts`, the workflow domain actions) are left out. The shared kernel
 * (money, numeric input, the domain event bus and outbox, idempotency, storage) counts as infrastructure.
 * A server file that no rule maps is refused (target: 0 unmapped files).
 * Type-only imports do not count; static, dynamic `import()` and re-exports do.
 */

export const MAP_FILE = 'scripts/ratchets/PACKAGE_MAP.txt';

/** Server code: the import graph that runs in the API process. */
const SERVER = /^src\/(routes|services|middleware|db|lib|utils|errors|server\.ts|app\.ts)/;

/** Shared kernel files counted as infrastructure whatever package owns them (ARCHITECTURE.md §5.1). */
const SHARED_KERNEL = [
  'src/lib/money.ts', 'src/lib/financialDecimal.ts', 'src/lib/currencyScale.ts', 'src/lib/numericInput.ts',
  'src/middleware/idempotency.ts', 'src/services/events/domainEventBus.ts', 'src/services/events/domainEvents.ts',
  'src/services/events/outboxService.ts', 'src/lib/storage.ts',
];

/** Rank of each package; an import is allowed only towards a lower rank. */
export function packageRank(pkg: string): number {
  if (['1', '2', '16', 'G'].includes(pkg)) return 0;
  if (['3', '4', '5', '6'].includes(pkg)) return 1;
  if (pkg === '14') return 2;
  return 3;
}

/** Infrastructure packages may import each other; anything else only a lower rank. */
export const importAllowed = (from: string, to: string) => packageRank(to) < packageRank(from) || (packageRank(from) === 0 && packageRank(to) === 0);

/** Composition roots wire every package together by design (routers, domain workflow actions). */
const COMPOSITION_ROOTS = new Set(['src/app.ts', 'src/server.ts', 'src/services/system/workflowDomainActions.ts']);

export interface MapRule { pkg: string; re: RegExp }

const globToRegExp = (glob: string) => new RegExp(`^${glob.split(/(\*\*\/?|\*|\?)/).map(part => {
  if (part === '**/' ) return '(?:.*/)?';
  if (part === '**') return '.*';
  if (part === '*') return '[^/]*';
  if (part === '?') return '[^/]';
  return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}).join('')}$`);

export function parsePackageMap(text: string): MapRule[] {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const [pkg, glob] = l.split(/\s+/);
    return { pkg, re: globToRegExp(glob) };
  });
}

export const packageOf = (rules: MapRule[], file: string) => rules.find(r => r.re.test(file))?.pkg ?? null;

/** Relative module specifiers of the runtime imports of one file (type-only imports left out). */
export function importSpecifiers(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly = c?.isTypeOnly || (!!c && !c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings)
        && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(e => e.isTypeOnly));
      if (!typeOnly) out.push(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
      out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.filter(s => s.startsWith('.'));
}

/** Repository path of a relative specifier, or null when it is not a source file of the repository. */
function resolveSpecifier(from: string, spec: string, exists: (rel: string) => boolean): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.(js|ts|tsx|mjs)$/, '');
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (exists(cand)) return cand;
  return null;
}

export interface BoundaryState {
  /** importing file → number of imports against the direction */
  packageBoundary: Record<string, number>;
  /** server files no rule of the map covers */
  unmappedServerFiles: string[];
}

export function boundaryState(root = process.cwd()): BoundaryState {
  const rules = parsePackageMap(fs.readFileSync(path.join(root, MAP_FILE), 'utf8'));
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  const kernel = new Set(SHARED_KERNEL);
  const packageBoundary: Record<string, number> = {};
  const unmappedServerFiles: string[] = [];
  for (const file of productionSourceFiles(root).filter(f => SERVER.test(f))) {
    const from = packageOf(rules, file);
    if (from === null) { unmappedServerFiles.push(file); continue; }
    if (COMPOSITION_ROOTS.has(file)) continue;
    let count = 0;
    for (const spec of importSpecifiers(file, fs.readFileSync(path.join(root, file), 'utf8'))) {
      const target = resolveSpecifier(file, spec, exists);
      if (target === null || kernel.has(target)) continue;
      const to = packageOf(rules, target);
      if (to === null || to === from || to === 'T') continue;
      if (!importAllowed(from, to)) count++;
    }
    if (count > 0) packageBoundary[file] = count;
  }
  return { packageBoundary, unmappedServerFiles };
}
