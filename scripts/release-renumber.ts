import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { resolveReleaseConflict } from './renumber/conflicts';
import { planRenumber, type RenumberInput } from './renumber/plan';

/**
 * v9.0.54 (TD-473) — merge-time renumbering for parallel change lanes (v9/PHASE4_LANES.md §7.7–§7.8):
 *
 *   git fetch origin master
 *   npm run release:renumber -- origin/master [--dry-run] [--no-check]
 *
 * 1. merges <ref> without committing (skipped when it is already merged);
 * 2. resolves and stages the conflicts of the release files (renumber/conflicts.ts); any other conflict stops the
 *    run: resolve it by hand and run the command again;
 * 3. moves the branch's own versions, migrations and audit report sections after those of <ref> (renumber/plan.ts),
 *    writes and stages the result;
 * 4. runs `npm run check:version` and the migration plan test. The operator reviews `git diff --cached` and commits.
 * Terminal output is English (AGENTS.md, owner rule t9).
 */

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

const gitOk = (args: string[]) => spawnSync('git', args, { stdio: 'ignore' }).status === 0;
const isMerged = (ref: string) => gitOk(['merge-base', '--is-ancestor', ref, 'HEAD'])
  || (gitOk(['rev-parse', '-q', '--verify', 'MERGE_HEAD']) && gitOk(['merge-base', '--is-ancestor', ref, 'MERGE_HEAD']));

function resolveReleaseConflicts(root: string, activeFile: string): void {
  const unmerged = git(['diff', '--name-only', '-z', '--diff-filter=U']).split('\0').filter(Boolean);
  if (unmerged.length === 0) return;
  const resolved = new Map<string, string>();
  const manual: string[] = [];
  for (const rel of unmerged) {
    let content: string | null = null;
    try {
      const stages = { ours: git(['show', `:2:${rel}`]), theirs: git(['show', `:3:${rel}`]) };
      content = resolveReleaseConflict(rel, fs.readFileSync(path.join(root, rel), 'utf8'), stages, activeFile);
    } catch {
      content = null;
    }
    if (content === null) manual.push(rel);
    else resolved.set(rel, content);
  }
  for (const [rel, content] of resolved) fs.writeFileSync(path.join(root, rel), content);
  if (resolved.size > 0) git(['add', '--', ...resolved.keys()]);
  for (const rel of resolved.keys()) console.log(`  resolved conflict ${rel}`);
  if (manual.length > 0) {
    throw new Error(`Resolve these conflicts by hand (keep both sides of append-only lists), stage them and run again:\n  ${manual.join('\n  ')}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ref = args.find(a => !a.startsWith('--')) ?? 'origin/master';
  const dryRun = args.includes('--dry-run');
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('Run from the repository root');
  if (!gitOk(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) throw new Error(`Unknown ref "${ref}" (git fetch origin master first)`);
  // read before merging: package.json and the changelog index may be conflicted afterwards
  const { ACTIVE_CHANGELOG } = await import('../src/data/changelogs/index.js');

  if (!isMerged(ref)) {
    if (dryRun) throw new Error(`${ref} is not merged yet; a dry run needs it merged`);
    console.log(`Merging ${ref} without committing`);
    spawnSync('git', ['merge', '--no-ff', '--no-commit', ref], { stdio: 'inherit' });
    if (!isMerged(ref)) throw new Error(`git merge ${ref} did not start; commit or stash local changes and try again`);
  }
  resolveReleaseConflicts(root, ACTIVE_CHANGELOG.file);

  const split = (s: string) => s.split('\0').filter(Boolean);
  const changed = [...new Set([...split(git(['diff', '--name-only', '-z', ref])), ...split(git(['ls-files', '--others', '--exclude-standard', '-z']))])]
    .filter(rel => fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isFile());
  const input: RenumberInput = {
    base: rel => { try { return git(['show', `${ref}:${rel}`]); } catch { return null; } },
    current: rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
    changed,
    activeFile: ACTIVE_CHANGELOG.file,
  };
  const plan = planRenumber(input);

  console.log(`Base ${ref}; top version after renumbering: ${plan.top}`);
  for (const [a, b] of plan.versions) console.log(`  version   ${a} -> ${b}`);
  for (const [a, b] of plan.migrations) console.log(`  migration ${a} -> ${b}`);
  for (const [a, b] of plan.sections) console.log(`  audit section ${a} -> ${b}`);
  if (plan.versions.length + plan.migrations.length + plan.sections.length === 0) console.log('  nothing to renumber');
  for (const rel of [...plan.writes.keys()].sort()) console.log(`  write ${rel}`);
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return;
  }

  for (const [from, to] of plan.renames) {
    if (gitOk(['ls-files', '--error-unmatch', from])) git(['mv', from, to]);
    else fs.renameSync(path.join(root, from), path.join(root, to));
  }
  for (const [rel, content] of plan.writes) fs.writeFileSync(path.join(root, rel), content);
  if (plan.writes.size > 0) git(['add', '--', ...plan.writes.keys()]);
  if (!args.includes('--no-check')) {
    const checks: Array<[string, string[]]> = [
      ['npm', ['run', '--silent', 'check:version']],
      ['npx', ['vitest', 'run', 'src/tests/vitest/migrationPlan.test.ts']],
    ];
    for (const [cmd, cmdArgs] of checks) {
      if (spawnSync(cmd, cmdArgs, { stdio: 'inherit' }).status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed`);
    }
  }
  console.log('Done: review git diff --cached, then git commit.');
}

if (process.argv[1]?.endsWith('release-renumber.ts') || process.argv[1]?.endsWith('release-renumber.js')) {
  main().catch((err: unknown) => {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
