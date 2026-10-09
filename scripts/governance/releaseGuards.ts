/**
 * Release governance gates run by `npm run check:version` (scripts/check-version-sync.ts), so every
 * `npm run release:renumber` merge checks them too. Terminal output is English (AGENTS.md, owner rule t9).
 *
 * v10.0.22 (TD-981): a debt row is never both active (TECH_DEBT.md) and archived (TECH_DEBT_ARCHIVE.md), and no id
 * is listed twice in one of them; parallel merges used to bring archived rows back unnoticed.
 * v10.0.24 (OT-A-03): every `npm run <script>` the governance documents, CI and the shell scripts name exists in
 * package.json; a master merge once dropped `ratchet:permissions` and nothing noticed.
 */
import fs from 'fs';
import path from 'path';

const debtIds = (src: string) => src.split('\n').map(l => l.match(/^\| (TD-\d+) \|/)?.[1]).filter((id): id is string => !!id);

function duplicates(ids: string[]): Array<[string, number]> {
  const count = new Map<string, number>();
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1);
}

export function findDebtRegistryViolations(debt: string, archive: string): string[] {
  const active = debtIds(debt);
  const archived = debtIds(archive);
  const archivedSet = new Set(archived);
  return [
    ...[...new Set(active)].filter(id => archivedSet.has(id)).map(id => `${id} is both active (TECH_DEBT.md) and archived (TECH_DEBT_ARCHIVE.md)`),
    ...duplicates(active).map(([id, n]) => `${id} appears ${n} times in TECH_DEBT.md`),
    ...duplicates(archived).map(([id, n]) => `${id} appears ${n} times in TECH_DEBT_ARCHIVE.md`),
  ];
}

/** Scripts named only to forbid them (AGENTS.md §23: `db:push` is banned). */
const FORBIDDEN_SCRIPTS = new Set(['db:push']);

/** Documents that name npm scripts: path relative to `root` → content. */
export function npmScriptDocs(root: string): Map<string, string> {
  const docs = new Map<string, string>();
  const add = (rel: string) => {
    const file = path.join(root, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) docs.set(rel, fs.readFileSync(file, 'utf8'));
  };
  const addDir = (dir: string, ext: RegExp) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs).sort()) {
      const rel = path.posix.join(dir, name);
      if (fs.statSync(path.join(root, rel)).isDirectory()) addDir(rel, ext);
      else if (ext.test(name)) add(rel);
    }
  };
  for (const rel of ['AGENTS.md', 'ARCHITECTURE_RULES.md', 'README.md', 'install.sh', 'update.sh']) add(rel);
  addDir('docs', /\.md$/);
  addDir('.github/workflows', /\.ya?ml$/);
  addDir('.claude/hooks', /\.sh$/);
  addDir('scripts', /\.sh$/);
  return docs;
}

export function findMissingNpmScripts(docs: Map<string, string>, scripts: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const [rel, text] of docs) {
    const names = new Set([...text.matchAll(/npm run (?:-s |--silent )?([a-z][a-z0-9:_-]*)/g)].map(m => m[1]));
    for (const name of names) {
      if (!FORBIDDEN_SCRIPTS.has(name) && !Object.prototype.hasOwnProperty.call(scripts, name)) {
        missing.push(`${rel} names \`npm run ${name}\`, which package.json does not define`);
      }
    }
  }
  return missing;
}
