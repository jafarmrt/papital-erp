/**
 * Release governance gates run by `npm run check:version` (scripts/check-version-sync.ts), so every
 * `npm run release:renumber` merge checks them too. Terminal output is English (AGENTS.md, owner rule t9).
 *
 * v10.0.22 (TD-981): a debt row is never both active (TECH_DEBT.md) and closed (DEBT_LESSONS.md / the frozen archive), and no id
 * is listed twice in one of them; parallel merges used to bring archived rows back unnoticed.
 * v10.0.24 (OT-A-03): every `npm run <script>` the governance documents, CI and the shell scripts name exists in
 * package.json; a master merge once dropped `ratchet:permissions` and nothing noticed.
 */
import fs from 'fs';
import path from 'path';
import { CLOSED_DEBT_FILE, FROZEN_DEBT_ROWS } from '../renumber/debtFiles';

export { CLOSED_DEBT_FILE, FROZEN_DEBT_ARCHIVE, FROZEN_DEBT_ROWS } from '../renumber/debtFiles';

const debtIds = (src: string) => src.split('\n').map(l => l.match(/^\| (TD-\d+) \|/)?.[1]).filter((id): id is string => !!id);

function duplicates(ids: string[]): Array<[string, number]> {
  const count = new Map<string, number>();
  for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1);
}

/** v11.0.4: the frozen archive keeps exactly its rows and gets no section of series 11 or later. */
export function findFrozenArchiveViolations(frozen: string): string[] {
  const rows = debtIds(frozen).length;
  const out: string[] = [];
  if (rows !== FROZEN_DEBT_ROWS) out.push(`the frozen debt archive holds ${rows} rows instead of ${FROZEN_DEBT_ROWS}; a row closed since series 11 belongs in docs/rules/DEBT_LESSONS.md`);
  if (/^## .*نسخه (۱[۱-۹]|[۲-۹][۰-۹]) —/m.test(frozen)) out.push('the frozen debt archive has a section of series 11 or later; move it to docs/rules/DEBT_LESSONS.md');
  return out;
}

/** v11 (1.3): the next version of `prev`: the next patch, or at the end of a phase the next minor */
export function isNextVersion(prev: string, version: string): boolean {
  const p = prev.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  const v = version.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!p || !v || p[1] !== v[1]) return false;
  const [pm, pp, vm, vp] = [p[2], p[3], v[2], v[3]].map(Number);
  return (vm === pm && vp === pp + 1) || (vm === pm + 1 && vp === 0);
}

/**
 * v11 (1.3, product-owner decision): a version is cut per server update, not per change. The active CHANGELOG.md
 * section starts with «### Unreleased» (the changes since the last cut), and the newest version follows the one
 * before it: the next patch, or the next minor with patch 0 at the end of a roadmap phase.
 */
export function findReleaseLayoutViolations(changelogMd: string, series: number, versions: string[]): string[] {
  const out: string[] = [];
  const header = changelogMd.indexOf(`## Version ${series}.x Series (Active`);
  const end = changelogMd.indexOf('\n---', header);
  const body = header < 0 ? '' : changelogMd.slice(header, end < 0 ? undefined : end);
  const lines = body.split('\n');
  if (lines[1] !== '' || lines[2] !== '### Unreleased') out.push(`CHANGELOG.md: the active series ${series} section must start with "### Unreleased"`);
  if (lines.filter(l => l === '### Unreleased').length > 1) out.push(`CHANGELOG.md: the active series ${series} section has "### Unreleased" more than once`);
  const next = lines.findIndex((l, k) => k > 2 && /^(### |## |---$)/.test(l));
  const stray = lines.slice(3, next < 0 ? undefined : next).find(l => l.trim() !== '' && !l.startsWith('- '));
  if (stray !== undefined) out.push(`CHANGELOG.md: a line under "### Unreleased" must start with "- ": ${stray.slice(0, 60)}`);
  if (versions.length >= 2 && !isNextVersion(versions[1], versions[0])) out.push(`${versions[0]} does not follow ${versions[1]}: a release takes the next patch, or the next minor with patch 0 at the end of a phase`);
  return out;
}

export function findDebtRegistryViolations(debt: string, archive: string): string[] {
  const active = debtIds(debt);
  const archived = debtIds(archive);
  const archivedSet = new Set(archived);
  return [
    ...[...new Set(active)].filter(id => archivedSet.has(id)).map(id => `${id} is both active (TECH_DEBT.md) and closed (${CLOSED_DEBT_FILE} or the frozen archive)`),
    ...duplicates(active).map(([id, n]) => `${id} appears ${n} times in TECH_DEBT.md`),
    ...duplicates(archived).map(([id, n]) => `${id} appears ${n} times among the closed rows`),
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
  for (const rel of ['AGENTS.md', 'README.md', 'install.sh', 'update.sh']) add(rel);
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
