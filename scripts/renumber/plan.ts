
/**
 * v9.0.52 (TD-473) — the renumbering plan of `npm run release:renumber` (scripts/release-renumber.ts), in memory.
 *
 * Only text the branch itself added (lines not in <ref>, found with a line diff) is renumbered:
 *  - versions: active changelog entries that are not in <ref> move, in order, to the free versions after the
 *    highest version of <ref>; every added line in the changed files follows (CHANGELOG.md, TECH_DEBT rows,
 *    AGENTS.md, roadmap, audit report; in other files only comment lines). The active changelog and the active CHANGELOG.md section are
 *    sorted newest first, and package.json, package-lock.json, k8s and README get the top version;
 *  - migrations: journal entries whose tag is not in <ref> move after the migrations of <ref> (file renamed, idx,
 *    tag, strictly increasing `when`) and added lines follow (the tag and the bare four-digit number);
 *  - audit report: a package section the branch added («## N.») whose number <ref> already uses takes the next free
 *    number, with its subsections, and added «STABILITY_AUDIT_V9.md` §N» references follow;
 *  - TECH_DEBT.md counters are recounted from both tables.
 */

export interface RenumberInput {
  /** file content at <ref>, or null when the file does not exist there */
  base(rel: string): string | null;
  /** file content in the working tree, or null when missing */
  current(rel: string): string | null;
  /** paths that differ from <ref> (tracked changes and untracked files) */
  changed: string[];
  activeFile: string;
}

export interface RenumberResult {
  writes: Map<string, string>;
  renames: Array<[string, string]>;
  versions: Array<[string, string]>;
  migrations: Array<[string, string]>;
  sections: Array<[number, number]>;
  top: string;
}

const JOURNAL = 'drizzle/meta/_journal.json';
const AUDIT = 'docs/audit/STABILITY_AUDIT_V9.md';
const FA = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (n: number) => String(n).replace(/\d/g, d => FA[Number(d)]);
const fromFa = (s: string) => Number(s.replace(/[۰-۹]/g, d => String(FA.indexOf(d))));
/** files rewritten as a whole, never by added-line replacement */
const GENERIC_SKIP = new Set(['package-lock.json', 'package.json', JOURNAL]);

/** Indexes of `cur` lines that are not part of a longest common subsequence with `base` (lines the branch added). */
export function addedLineIndexes(base: string[], cur: string[]): Set<number> {
  let start = 0;
  while (start < base.length && start < cur.length && base[start] === cur[start]) start++;
  let endB = base.length;
  let endC = cur.length;
  while (endB > start && endC > start && base[endB - 1] === cur[endC - 1]) { endB--; endC--; }
  const added = new Set<number>();
  const n = endB - start;
  const m = endC - start;
  if (n === 0 || m === 0 || n * m > 30_000_000) {
    const pool = new Map<string, number>();
    for (let i = start; i < endB; i++) pool.set(base[i], (pool.get(base[i]) ?? 0) + 1);
    for (let j = start; j < endC; j++) {
      const left = pool.get(cur[j]) ?? 0;
      if (left > 0) pool.set(cur[j], left - 1);
      else added.add(j);
    }
    return added;
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = base[start + i] === cur[start + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[start + i] === cur[start + j]) { i++; j++; } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { i++; } else { added.add(start + j); j++; }
  }
  for (; j < m; j++) added.add(start + j);
  return added;
}

type Version = [number, number, number];
const parseVersion = (v: string): Version => {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid version "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const compareVersions = (a: string, b: string) => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

interface ChangelogFile { head: string; entries: string[]; tail: string }

/** Splits the active changelog into its entry blocks («  {» … «  }»), each without its trailing comma. */
export function splitChangelog(src: string, file: string): ChangelogFile {
  const open = src.match(/export const v\d+Updates: AIUpdateLog\[\] = \[\n/);
  const close = src.lastIndexOf('\n];');
  if (!open || open.index === undefined || close < 0) throw new Error(`${file}: changelog array not found`);
  const bodyStart = open.index + open[0].length;
  const lines = src.slice(bodyStart, close + 1).split('\n').filter((l, k, all) => !(k === all.length - 1 && l === ''));
  const entries: string[] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    if (block === null) {
      if (line !== '  {') throw new Error(`${file}: unexpected line outside an entry: ${line.slice(0, 80)}`);
      block = [line];
    } else if (/^ {2}\},?$/.test(line)) {
      block.push('  }');
      entries.push(block.join('\n'));
      block = null;
    } else {
      if (line.includes('<<<<<<<') || line.includes('>>>>>>>')) throw new Error(`${file}: unresolved merge conflict`);
      block.push(line);
    }
  }
  if (block !== null) throw new Error(`${file}: last entry is not closed`);
  return { head: src.slice(0, bodyStart), entries, tail: src.slice(close + 1) };
}

const joinChangelog = (f: ChangelogFile) => `${f.head}${f.entries.map((e, k) => (k < f.entries.length - 1 ? `${e},` : e)).join('\n')}\n${f.tail}`;

function entryVersion(entry: string, file: string): string {
  const m = entry.match(/^ {4}version: '(v\d+\.\d+\.\d+)',$/m);
  if (!m) throw new Error(`${file}: entry without a version line`);
  return m[1];
}

/** Old → new version of every branch entry (entries not in <ref>), in ascending order after the top of <ref>. */
export function planVersions(baseSrc: string, curSrc: string, file: string): Map<string, string> {
  const base = splitChangelog(baseSrc, file).entries;
  const cur = splitChangelog(curSrc, file).entries;
  const curSet = new Set(cur);
  const missing = base.filter(e => !curSet.has(e));
  if (missing.length > 0) {
    throw new Error(`${file}: ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} of the base (e.g. ${entryVersion(missing[0], file)}) are missing or changed here; merge the base branch first`);
  }
  const baseSet = new Set(base);
  const own = cur.filter(e => !baseSet.has(e)).map(e => entryVersion(e, file));
  if (new Set(own).size !== own.length) throw new Error(`${file}: the branch has the same version twice`);
  own.sort(compareVersions);
  const top = base.map(e => entryVersion(e, file)).sort(compareVersions).pop() ?? 'v0.0.0';
  const [major, minor, patch] = parseVersion(top);
  return new Map(own.map((v, k) => [v, `v${major}.${minor}.${patch + 1 + k}`]));
}

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }
interface Journal { version: string; dialect: string; entries: JournalEntry[] }

/** Moves the branch's migrations after those of <ref>: old tag → new tag and the rewritten journal. */
export function planMigrations(baseSrc: string, curSrc: string): { tags: Map<string, string>; journal: string } {
  let cur: Journal;
  try { cur = JSON.parse(curSrc) as Journal; } catch { throw new Error(`${JOURNAL} is not valid JSON (resolve the merge conflict by keeping both sides)`); }
  const base = JSON.parse(baseSrc) as Journal;
  const curTags = new Set(cur.entries.map(e => e.tag));
  const lost = base.entries.filter(e => !curTags.has(e.tag));
  if (lost.length > 0) throw new Error(`${JOURNAL}: migration ${lost[0].tag} of the base is missing here; merge the base branch first`);
  const baseTags = new Set(base.entries.map(e => e.tag));
  const own = cur.entries.filter(e => !baseTags.has(e.tag)).sort((a, b) => a.idx - b.idx);
  const tags = new Map<string, string>();
  const entries = base.entries.map(e => ({ ...cur.entries.find(c => c.tag === e.tag)! }));
  let lastWhen = Math.max(0, ...entries.map(e => e.when));
  let lastIdx = Math.max(-1, ...entries.map(e => e.idx));
  for (const e of own) {
    const idx = ++lastIdx;
    const tag = `${String(idx).padStart(4, '0')}_${e.tag.replace(/^\d+_/, '')}`;
    const when = e.when > lastWhen ? e.when : lastWhen + 10_000_000;
    lastWhen = when;
    if (tag !== e.tag) tags.set(e.tag, tag);
    entries.push({ ...e, idx, tag, when });
  }
  const journal = `${JSON.stringify({ ...cur, entries }, null, 2)}\n`;
  return { tags, journal: journal === curSrc ? curSrc : journal };
}

/** Package sections the branch added to the audit report whose number <ref> already uses (old → new). */
export function planSections(baseSrc: string | null, curSrc: string | null): Map<number, number> {
  const map = new Map<number, number>();
  if (!curSrc) return map;
  const heading = /^## ([۰-۹0-9]+)\. /;
  const baseLines = (baseSrc ?? '').split('\n');
  const used = new Set(baseLines.map(l => l.match(heading)?.[1]).filter((x): x is string => !!x).map(fromFa));
  const cur = curSrc.split('\n');
  const added = addedLineIndexes(baseLines, cur);
  for (const k of [...added].sort((a, b) => a - b)) {
    const m = cur[k].match(heading);
    if (!m) continue;
    const n = fromFa(m[1]);
    if (!used.has(n) && !map.has(n)) { used.add(n); continue; }
    const next = Math.max(0, ...used) + 1;
    used.add(next);
    map.set(n, next);
  }
  return map;
}

interface LineMaps { versions: Map<string, string>; numbers: Map<string, string>; sections: Map<number, number> }

function rewriteLine(line: string, file: string, maps: LineMaps): string {
  let out = line.replace(/\bv\d+\.\d+\.\d+(?![\d])/g, v => maps.versions.get(v) ?? v);
  // one pass over four-digit numbers also renames tags («0060_x» → «0061_x») without shifting a number twice
  if (maps.numbers.size > 0) out = out.replace(/(?<![\d.])\d{4}(?![\d])/g, n => maps.numbers.get(n) ?? n);
  if (maps.sections.size > 0) {
    const sec = (d: string) => { const to = maps.sections.get(fromFa(d)); return to === undefined ? d : toFa(to); };
    if (file === AUDIT) out = out.replace(/^(#{2,3} )([۰-۹]+)(?=\.)/, (_, h: string, d: string) => h + sec(d));
    out = out.replace(/(STABILITY_AUDIT_V9\.md`? §)([۰-۹]+)/g, (_, h: string, d: string) => h + sec(d));
  }
  return out;
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|--)/;

/**
 * Applies the maps to the lines of `cur` the branch added (relative to `base`): every added line of a Markdown file,
 * only comment lines elsewhere (a version or number in code or test data is never touched).
 */
export function rewriteAddedLines(base: string | null, cur: string, file: string, maps: LineMaps): string {
  const curLines = cur.split('\n');
  const added = addedLineIndexes((base ?? '').split('\n'), curLines);
  if (base === null) curLines.forEach((_, k) => added.add(k));
  const doc = file.endsWith('.md');
  return curLines.map((l, k) => (added.has(k) && (doc || COMMENT_LINE.test(l)) ? rewriteLine(l, file, maps) : l)).join('\n');
}

/** Sorts the blocks of the active series section of CHANGELOG.md newest first. */
export function sortChangelogMd(src: string, series: number): string {
  const header = src.indexOf(`## Version ${series}.x Series (Active`);
  if (header < 0) return src;
  const bodyStart = src.indexOf('\n', header) + 1;
  const end = src.indexOf('\n---', bodyStart);
  const body = src.slice(bodyStart, end < 0 ? src.length : end + 1);
  const first = body.indexOf('\n### v');
  if (first < 0) return src;
  const blocks = body.slice(first + 1).split(/\n(?=### v)/).map(b => b.replace(/\n+$/, ''));
  const versionOf = (b: string) => b.match(/^### (v\d+\.\d+\.\d+)/)?.[1] ?? 'v0.0.0';
  blocks.sort((a, b) => compareVersions(versionOf(b), versionOf(a)));
  return src.slice(0, bodyStart) + body.slice(0, first + 1) + blocks.join('\n\n') + '\n' + src.slice(bodyStart + body.length);
}

function setVersionLocations(input: RenumberInput, writes: Map<string, string>, top: string): void {
  const plain = top.slice(1);
  const get = (rel: string) => writes.get(rel) ?? input.current(rel);
  const pkg = get('package.json');
  if (pkg) writes.set('package.json', pkg.replace(/^(\s*"version": ")[^"]+(")/m, `$1${plain}$2`));
  const lock = get('package-lock.json');
  if (lock) {
    let n = 0;
    writes.set('package-lock.json', lock.replace(/"version": "[^"]+"/g, m => (n++ < 2 ? `"version": "${plain}"` : m)));
  }
  const k8s = get('deploy/k8s/erp-deployment.yaml');
  if (k8s) {
    writes.set('deploy/k8s/erp-deployment.yaml', k8s.replace(/erp:v\d+\.\d+\.\d+/g, `erp:${top}`)
      .replace(/(name:\s*APP_VERSION\s*\n\s*value:\s*")[^"]+(")/, `$1${plain}$2`));
  }
  const readme = get('README.md');
  if (readme) writes.set('README.md', readme.replace(/نسخه مستقر: `v\d+\.\d+\.\d+`/, `نسخه مستقر: \`${top}\``));
}

function recountTechDebt(input: RenumberInput, writes: Map<string, string>): void {
  const get = (rel: string) => writes.get(rel) ?? input.current(rel);
  const debt = get('TECH_DEBT.md');
  const archive = get('TECH_DEBT_ARCHIVE.md');
  if (!debt || !archive) return;
  const rows = (s: string) => s.split('\n').filter(l => /^\| TD-\d+ \|/.test(l)).length;
  writes.set('TECH_DEBT.md', debt
    .replace(/- \*\*فعال:\*\* [۰-۹0-9]+ ردیف/, `- **فعال:** ${toFa(rows(debt))} ردیف`)
    .replace(/- \*\*آرشیو شده \(resolved\):\*\* [۰-۹0-9]+ ردیف/, `- **آرشیو شده (resolved):** ${toFa(rows(archive))} ردیف`));
}

/** The whole renumbering in memory; nothing is written when it throws. */
export function planRenumber(input: RenumberInput): RenumberResult {
  const series = Number(input.activeFile.match(/(\d+)\.ts$/)?.[1]);
  const curActive = input.current(input.activeFile);
  const baseActive = input.base(input.activeFile);
  if (!curActive || !baseActive) throw new Error(`${input.activeFile} not found in the working tree or the base`);
  for (const rel of input.changed) {
    if (/^(<{7}|>{7}) /m.test(input.current(rel) ?? '')) throw new Error(`${rel}: unresolved merge conflict markers`);
  }
  const versions = planVersions(baseActive, curActive, input.activeFile);
  const baseJournal = input.base(JOURNAL);
  const curJournal = input.current(JOURNAL);
  const mig = baseJournal && curJournal ? planMigrations(baseJournal, curJournal) : { tags: new Map<string, string>(), journal: curJournal ?? '' };
  const numbers = new Map([...mig.tags].map(([a, b]) => [a.slice(0, 4), b.slice(0, 4)]));
  const sections = planSections(input.base(AUDIT), input.current(AUDIT));
  const maps: LineMaps = { versions, numbers, sections };

  const writes = new Map<string, string>();
  const renames: Array<[string, string]> = [];
  for (const [from, to] of mig.tags) {
    if (input.current(`drizzle/${from}.sql`) !== null) renames.push([`drizzle/${from}.sql`, `drizzle/${to}.sql`]);
  }
  if (curJournal && mig.journal !== curJournal) writes.set(JOURNAL, mig.journal);

  for (const rel of input.changed) {
    if (GENERIC_SKIP.has(rel) || rel === input.activeFile) continue;
    const cur = input.current(rel);
    if (cur === null || cur.includes('\u0000')) continue;
    const next = rewriteAddedLines(input.base(rel), cur, rel, maps);
    const target = renames.find(([from]) => from === rel)?.[1] ?? rel;
    if (next !== cur || target !== rel) writes.set(target, next);
  }

  const active = splitChangelog(curActive, input.activeFile);
  const baseEntries = new Set(splitChangelog(baseActive, input.activeFile).entries);
  active.entries = active.entries
    .map(e => (baseEntries.has(e) ? e : e.replace(/^( {4}version: ')(v\d+\.\d+\.\d+)(',)$/m, (_, a: string, v: string, b: string) => a + (versions.get(v) ?? v) + b)))
    .sort((a, b) => compareVersions(entryVersion(b, input.activeFile), entryVersion(a, input.activeFile)));
  const activeOut = joinChangelog(active);
  if (activeOut !== curActive) writes.set(input.activeFile, activeOut);
  const top = entryVersion(active.entries[0], input.activeFile);

  const md = writes.get('CHANGELOG.md') ?? input.current('CHANGELOG.md');
  if (md) {
    const sorted = sortChangelogMd(md, series);
    if (sorted !== input.current('CHANGELOG.md')) writes.set('CHANGELOG.md', sorted);
  }
  setVersionLocations(input, writes, top);
  recountTechDebt(input, writes);
  for (const [rel, content] of [...writes]) if (content === input.current(rel)) writes.delete(rel);

  return { writes, renames, versions: [...versions].filter(([a, b]) => a !== b), migrations: [...mig.tags], sections: [...sections], top };
}
