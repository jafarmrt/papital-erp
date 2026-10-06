/**
 * v9.0.52 (TD-473) — automatic resolution of the merge conflicts every parallel release produces
 * (v9/PHASE4_LANES.md §7.6), used by `npm run release:renumber` before renumbering:
 *  - the active changelog and the active CHANGELOG.md section: both sides' entries are kept (sorted later);
 *  - the migration journal: the base's entries plus this branch's own entries (renumbered later);
 *  - TECH_DEBT.md / TECH_DEBT_ARCHIVE.md: both sides of each conflict are kept (rows); the counters and the
 *    «last review» line keep this branch's side (the counters are recounted later);
 *  - package.json, package-lock.json, k8s, README.md: a conflict whose lines are all version lines keeps this
 *    branch's side (the version is set later).
 * Any other conflict is left to the operator.
 */

export interface ConflictStages {
  /** stage 2 («ours», the branch) */
  ours: string;
  /** stage 3 («theirs», the merged base) */
  theirs: string;
}

const JOURNAL = 'drizzle/meta/_journal.json';
const VERSION_FILES = new Set(['package.json', 'package-lock.json', 'deploy/k8s/erp-deployment.yaml', 'README.md']);
const UNION_FILES = new Set(['TECH_DEBT.md', 'TECH_DEBT_ARCHIVE.md']);
const VERSION_LINE = /"version": "[^"]*"|erp:v\d+\.\d+\.\d+|^\s*value: "\d+\.\d+\.\d+"|نسخه مستقر: `v\d+\.\d+\.\d+`/;
const SINGLE_LINES = [/^- \*\*فعال:\*\* /, /^- \*\*آرشیو شده \(resolved\):\*\* /, /^\*آخرین بازبینی: /];

interface Hunk { ours: string[]; theirs: string[] }

/** Replaces every conflict hunk (merge or diff3 style) of a merged file with `pick(hunk)`; null when one is refused. */
export function resolveHunks(merged: string, pick: (h: Hunk) => string[] | null): string | null {
  const out: string[] = [];
  let hunk: Hunk | null = null;
  let side: 'ours' | 'base' | 'theirs' = 'ours';
  for (const line of merged.split('\n')) {
    if (hunk === null) {
      if (line.startsWith('<<<<<<< ')) { hunk = { ours: [], theirs: [] }; side = 'ours'; } else out.push(line);
    } else if (line.startsWith('||||||| ')) side = 'base';
    else if (line === '=======') side = 'theirs';
    else if (line.startsWith('>>>>>>> ')) {
      const picked = pick(hunk);
      if (picked === null) return null;
      out.push(...picked);
      hunk = null;
    } else if (side !== 'base') hunk[side].push(line);
  }
  return hunk === null ? out.join('\n') : null;
}

const entriesOf = (src: string) => {
  const open = src.match(/export const v\d+Updates: AIUpdateLog\[\] = \[\n/);
  const close = src.lastIndexOf('\n];');
  if (!open || open.index === undefined || close < 0) return null;
  const start = open.index + open[0].length;
  const blocks = src.slice(start, close + 1).split(/\n(?= {2}\{\n)/).map(b => b.replace(/,?\n?$/, '').replace(/\},$/, '}'));
  return { head: src.slice(0, start), blocks: blocks.filter(b => b.trim()), tail: src.slice(close + 1) };
};

function unionChangelog(s: ConflictStages): string | null {
  const ours = entriesOf(s.ours);
  const theirs = entriesOf(s.theirs);
  if (!ours || !theirs) return null;
  const known = new Set(theirs.blocks);
  const blocks = [...ours.blocks.filter(b => !known.has(b)), ...theirs.blocks];
  return `${theirs.head}${blocks.map((b, k) => (k < blocks.length - 1 ? `${b},` : b)).join('\n')}\n${theirs.tail}`;
}

function activeMdBlocks(src: string, series: number): { at: number; blocks: string[] } | null {
  const header = src.indexOf(`## Version ${series}.x Series (Active`);
  if (header < 0) return null;
  const bodyStart = src.indexOf('\n', header) + 1;
  const end = src.indexOf('\n---', bodyStart);
  const body = src.slice(bodyStart, end < 0 ? src.length : end);
  const first = body.indexOf('### v');
  if (first < 0) return { at: bodyStart, blocks: [] };
  return { at: bodyStart + first, blocks: body.slice(first).split(/\n(?=### v)/).map(b => b.replace(/\n+$/, '')) };
}

function unionChangelogMd(s: ConflictStages, series: number): string | null {
  const ours = activeMdBlocks(s.ours, series);
  const theirs = activeMdBlocks(s.theirs, series);
  if (!ours || !theirs) return null;
  const known = new Set(theirs.blocks);
  const extra = ours.blocks.filter(b => !known.has(b));
  return extra.length === 0 ? s.theirs : `${s.theirs.slice(0, theirs.at)}${extra.map(b => `${b}\n\n`).join('')}${s.theirs.slice(theirs.at)}`;
}

interface JournalEntry { idx: number; tag: string }

function unionJournal(s: ConflictStages): string | null {
  try {
    const ours = JSON.parse(s.ours) as { entries: JournalEntry[] };
    const theirs = JSON.parse(s.theirs) as { entries: JournalEntry[] };
    const known = new Set(theirs.entries.map(e => e.tag));
    const entries = [...theirs.entries, ...ours.entries.filter(e => !known.has(e.tag))];
    return `${JSON.stringify({ ...theirs, entries }, null, 2)}\n`;
  } catch {
    return null;
  }
}

function unionRows(merged: string): string | null {
  const resolved = resolveHunks(merged, h => [...h.ours, ...h.theirs]);
  if (resolved === null) return null;
  const seen = new Set<number>();
  return resolved.split('\n').filter(l => {
    const k = SINGLE_LINES.findIndex(re => re.test(l));
    if (k < 0) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join('\n');
}

/**
 * Resolved content of one conflicted file, or null when it is not one of the release files above
 * (or its conflict is more than a version line).
 */
export function resolveReleaseConflict(rel: string, merged: string, stages: ConflictStages, activeFile: string): string | null {
  const series = Number(activeFile.match(/(\d+)\.ts$/)?.[1]);
  if (rel === activeFile) return unionChangelog(stages);
  if (rel === 'CHANGELOG.md') return unionChangelogMd(stages, series);
  if (rel === JOURNAL) return unionJournal(stages);
  if (UNION_FILES.has(rel)) return unionRows(merged);
  if (VERSION_FILES.has(rel)) {
    return resolveHunks(merged, h => ([...h.ours, ...h.theirs].every(l => VERSION_LINE.test(l)) ? h.ours : null));
  }
  return null;
}
