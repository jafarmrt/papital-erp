/**
 * v9.0.109 (TD-473) — automatic resolution of the merge conflicts every parallel release produces
 * (v9/PHASE4_LANES.md §7.6), used by `npm run release:renumber` before renumbering:
 *  - the active changelog and the active CHANGELOG.md section: both sides' entries are kept (sorted later); a branch
 *    entry with the version and title of a base entry replaces it when the base side left that entry unchanged
 *    against the common ancestor (an edit of an older entry, v10.2.28), and is left to the operator otherwise;
 *  - the migration journal: the base's entries plus this branch's own entries (renumbered later);
 *  - TECH_DEBT.md / docs/rules/DEBT_LESSONS.md: both sides of each conflict are kept (rows), a row both sides hold once,
 *    and a row both sides changed differently is left to the operator;
 *    the counters and the «last review» line keep this branch's side (the counters are recounted later, and a row
 *    the merged archive holds is dropped from TECH_DEBT.md then: TD-981, renumber/plan.ts);
 *  - package.json, package-lock.json, README.md: a conflict whose lines are all version lines keeps the
 *    base's side (the version is set later; v10.2.28: the base's side, so text the base changed on a version line,
 *    such as the paths on the README status line, is not dropped).
 * Any other conflict is left to the operator.
 */

import { CLOSED_DEBT_FILE } from '../governance/releaseGuards';

export interface ConflictStages {
  /** stage 2 («ours», the branch) */
  ours: string;
  /** stage 3 («theirs», the merged base) */
  theirs: string;
  /** stage 1 (the common ancestor), when git has one */
  base?: string;
}

const JOURNAL = 'drizzle/meta/_journal.json';
const VERSION_FILES = new Set(['package.json', 'package-lock.json', 'README.md']);
const UNION_FILES = new Set(['TECH_DEBT.md', CLOSED_DEBT_FILE]);
const VERSION_LINE = /"version": "[^"]*"|نسخه مستقر: `v\d+\.\d+\.\d+`/;
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
  // v10.2.28: a branch block with the version and title of a base block is an edit of that entry, not a new one;
  // it replaces the base block only while the base side left that entry as the common ancestor had it, otherwise
  // both sides edited it and the operator decides (#346 review L2)
  const key = (b: string) => `${b.match(/version: '([^']+)'/)?.[1]}\n${b.match(/title: '([^']*)'/)?.[1]}`;
  const ancestor = new Map((s.base === undefined ? null : entriesOf(s.base))?.blocks.map(b => [key(b), b]) ?? []);
  // a branch block the common ancestor holds unchanged is not the branch's: the base side's edit of it stays
  const unchanged = (b: string) => ancestor.get(key(b)) === b;
  const edited = new Map(ours.blocks.filter(b => !known.has(b) && !unchanged(b)).map(b => [key(b), b]));
  const theirKeys = new Set(theirs.blocks.map(key));
  if (theirs.blocks.some(b => edited.has(key(b)) && ancestor.get(key(b)) !== b)) return null;
  const blocks = [
    ...ours.blocks.filter(b => !known.has(b) && !theirKeys.has(key(b)) && !unchanged(b)),
    ...theirs.blocks.map(b => edited.get(key(b)) ?? b),
  ];
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
  // v10.2.31 (#349 review): as in the changelog, a branch section the common ancestor holds unchanged is not the
  // branch's (the base's edit of it stays), and a branch edit of a section the base also changed is the operator's
  const ancestorBlocks = s.base === undefined ? null : activeMdBlocks(s.base, series)?.blocks ?? null;
  const ancestor = new Set(ancestorBlocks ?? []);
  const header = (b: string) => b.split('\n', 1)[0];
  const ancestorByHeader = new Map((ancestorBlocks ?? []).map(b => [header(b), b]));
  const theirsByHeader = new Map(theirs.blocks.map(b => [header(b), b]));
  const changed = ours.blocks.filter(b => !known.has(b) && !ancestor.has(b));
  const edits = new Map<string, string>();
  for (const b of changed) {
    const base = theirsByHeader.get(header(b));
    if (base === undefined) continue;
    if (ancestorByHeader.get(header(b)) !== base) return null;
    edits.set(header(b), b);
  }
  // each edited section replaces the base's text of it in place; the new sections still go in at the top
  let out = s.theirs;
  for (const [h, b] of edits) {
    const was = theirsByHeader.get(h)!;
    if (out.indexOf(was, theirs.at) < 0) return null;
    out = `${out.slice(0, out.indexOf(was, theirs.at))}${b}${out.slice(out.indexOf(was, theirs.at) + was.length)}`;
  }
  // a section the branch deleted (the ancestor held it and the base left it unchanged) stays deleted
  const oursSet = new Set(ours.blocks);
  for (const b of ancestorBlocks ?? []) {
    if (oursSet.has(b) || !known.has(b) || edits.has(header(b))) continue;
    const at = out.indexOf(`${b}\n\n`, theirs.at);
    if (at < 0) return null;
    out = `${out.slice(0, at)}${out.slice(at + b.length + 2)}`;
  }
  const extra = changed.filter(b => !edits.has(header(b)));
  return extra.length === 0 ? out : `${out.slice(0, theirs.at)}${extra.map(b => `${b}\n\n`).join('')}${out.slice(theirs.at)}`;
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

const DEBT_ROW = /^\| TD-\d+ \|/;

const rowIds = (lines: string[]) => new Map(lines.map(l => [l.match(/^\| (TD-\d+) \|/)?.[1], l] as const).filter(([id]) => id));

function unionRows(merged: string): string | null {
  // v10.0.22 (TD-981): a row both sides of a hunk hold is kept once; one row both sides edited differently is left
  // to the operator (keeping both would list the id twice)
  const resolved = resolveHunks(merged, h => {
    const ours = rowIds(h.ours);
    for (const [id, line] of rowIds(h.theirs)) if (ours.has(id) && ours.get(id) !== line) return null;
    return [...h.ours, ...h.theirs.filter(l => !(DEBT_ROW.test(l) && h.ours.includes(l)))];
  });
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
    return resolveHunks(merged, h => ([...h.ours, ...h.theirs].every(l => VERSION_LINE.test(l)) ? h.theirs : null));
  }
  return null;
}
